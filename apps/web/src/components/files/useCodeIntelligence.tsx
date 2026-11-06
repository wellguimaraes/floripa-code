import type {
  CodeIntelligenceHoverContents,
  CodeIntelligenceLocation,
  EnvironmentId,
} from "@t3tools/contracts";
import type { FileOptions } from "@pierre/diffs/react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Popover, PopoverPopup } from "~/components/ui/popover";
import { projectEnvironment } from "~/state/projects";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { isTerminalLinkActivation } from "~/terminal-links";

import {
  definitionOutcome,
  formatLocation,
  isLookupToken,
  tokenPosition,
  unavailableMessage,
} from "./codeIntelligence.logic";

/** Long enough that passing the pointer over code asks nothing. */
const HOVER_DELAY_MS = 400;
/** A quick answer never flashes a waiting state. */
const PENDING_DELAY_MS = 400;
/** Time to move the pointer from a token into its hover card. */
const HOVER_CLOSE_DELAY_MS = 200;
const CODE_LINK_ATTRIBUTE = "data-code-link";
/** Underlines a symbol while Cmd/Ctrl is held over it, like an editor's link. */
export const CODE_LINK_UNSAFE_CSS = `[${CODE_LINK_ATTRIBUTE}]{text-decoration:underline;text-underline-offset:2px;cursor:pointer}`;

export type CodeIntelligenceTokenOptions = Pick<
  FileOptions<unknown, undefined>,
  "onTokenClick" | "onTokenEnter" | "onTokenLeave"
>;

type PopoverContent =
  | {
      readonly kind: "pending";
      readonly source: "hover" | "definition";
      readonly anchor: HTMLElement;
    }
  | {
      readonly kind: "hover";
      readonly anchor: HTMLElement;
      readonly contents: CodeIntelligenceHoverContents;
    }
  | {
      readonly kind: "pick";
      readonly anchor: HTMLElement;
      readonly locations: ReadonlyArray<CodeIntelligenceLocation>;
    }
  | { readonly kind: "message"; readonly anchor: HTMLElement; readonly text: string };

/** What the popover shows, for the file it was opened in. */
type PopoverState = PopoverContent & { readonly fileKey: string };

interface Target {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string | null;
  /** Off for attachments and connections that cannot read files. */
  readonly enabled: boolean;
  /** Unsaved edits: the language server only sees the file on disk. */
  readonly dirty: boolean;
  readonly onOpenLocation: (path: string, line: number) => void;
}

/**
 * Go-to-definition (Cmd/Ctrl+click) and hover for the file surface. Returns
 * the token handlers for Pierre's `File` and the one popover they drive.
 */
export function useCodeIntelligence(target: Target): {
  readonly tokenOptions: CodeIntelligenceTokenOptions;
  readonly popover: ReactNode;
} {
  const runDefinition = useAtomQueryRunner(projectEnvironment.codeDefinition, {
    reportFailure: false,
  });
  const runHover = useAtomQueryRunner(projectEnvironment.codeHover, { reportFailure: false });
  const fileKey = JSON.stringify([target.environmentId, target.cwd, target.relativePath]);
  const [shownPopover, setShownPopover] = useState<PopoverState | null>(null);
  // Switching files leaves the last file's popover behind instead of resetting state.
  const popover = shownPopover?.fileKey === fileKey ? shownPopover : null;
  // Pierre calls the token handlers outside React; they read the latest values here.
  const latest = useRef({ target, fileKey, popover, runDefinition, runHover });
  useLayoutEffect(() => {
    latest.current = { target, fileKey, popover, runDefinition, runHover };
  });
  const timers = useRef({
    hover: undefined as ReturnType<typeof setTimeout> | undefined,
    pending: undefined as ReturnType<typeof setTimeout> | undefined,
    close: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const requests = useRef({ hover: 0, definition: 0 });
  /** Set once the server says it cannot help with a file, so hovering it stops asking. */
  const unavailable = useRef<{ readonly fileKey: string; readonly text: string } | null>(null);
  const unavailableText = useCallback(
    () =>
      unavailable.current?.fileKey === latest.current.fileKey ? unavailable.current.text : null,
    [],
  );
  /** Shows popover content for the current file. */
  const setPopover = useCallback((content: PopoverContent | null) => {
    setShownPopover(content === null ? null : { ...content, fileKey: latest.current.fileKey });
  }, []);
  const linkElement = useRef<HTMLElement | null>(null);

  const clearTimers = useCallback(() => {
    clearTimeout(timers.current.hover);
    clearTimeout(timers.current.pending);
    clearTimeout(timers.current.close);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const showPendingSoon = useCallback(
    (source: "hover" | "definition", anchor: HTMLElement, request: number) => {
      clearTimeout(timers.current.pending);
      timers.current.pending = setTimeout(() => {
        if (requests.current[source] === request) setPopover({ kind: "pending", source, anchor });
      }, PENDING_DELAY_MS);
    },
    [setPopover],
  );

  const closeHoverSoon = useCallback(() => {
    clearTimeout(timers.current.close);
    timers.current.close = setTimeout(() => {
      setShownPopover((shown) =>
        shown?.kind === "hover" || (shown?.kind === "pending" && shown.source === "hover")
          ? null
          : shown,
      );
    }, HOVER_CLOSE_DELAY_MS);
  }, []);

  const tokenOptions = useMemo<CodeIntelligenceTokenOptions>(
    () => ({
      onTokenEnter: (token, event) => {
        const { target: current, popover: shown, runHover: hover } = latest.current;
        if (!current.enabled || current.relativePath === null || !isLookupToken(token.tokenText)) {
          return;
        }
        // Another symbol keeps the card until its own answer replaces it.
        clearTimeout(timers.current.close);
        if (isTerminalLinkActivation(event)) {
          linkElement.current?.removeAttribute(CODE_LINK_ATTRIBUTE);
          token.tokenElement.setAttribute(CODE_LINK_ATTRIBUTE, "");
          linkElement.current = token.tokenElement;
        }
        // An open picker or message stays until it is dismissed.
        if (current.dirty || unavailableText() !== null) return;
        if (shown?.kind === "pick" || shown?.kind === "message") return;
        if (shown?.kind === "pending" && shown.source === "definition") return;
        clearTimeout(timers.current.hover);
        const request = ++requests.current.hover;
        const { cwd, relativePath, environmentId } = current;
        const requestFileKey = latest.current.fileKey;
        timers.current.hover = setTimeout(() => {
          showPendingSoon("hover", token.tokenElement, request);
          void hover({
            environmentId,
            input: { cwd, relativePath, ...tokenPosition(token) },
          }).then((result) => {
            if (requests.current.hover !== request || latest.current.fileKey !== requestFileKey) {
              return;
            }
            clearTimeout(timers.current.pending);
            // A hover is a passing glance: failures stay quiet.
            if (result._tag !== "Success") return setPopover(null);
            if (result.value.status === "unavailable") {
              unavailable.current = {
                fileKey: requestFileKey,
                text: unavailableMessage(result.value),
              };
              return setPopover(null);
            }
            const { contents } = result.value;
            setPopover(
              contents === null ? null : { kind: "hover", anchor: token.tokenElement, contents },
            );
          });
        }, HOVER_DELAY_MS);
      },
      onTokenLeave: () => {
        linkElement.current?.removeAttribute(CODE_LINK_ATTRIBUTE);
        linkElement.current = null;
        clearTimeout(timers.current.hover);
        requests.current.hover += 1;
        closeHoverSoon();
      },
      onTokenClick: (token, event) => {
        const { target: current, runDefinition: definition } = latest.current;
        if (!current.enabled || current.relativePath === null || !isTerminalLinkActivation(event)) {
          return;
        }
        if (!isLookupToken(token.tokenText)) return;
        event.preventDefault();
        clearTimers();
        requests.current.hover += 1;
        const anchor = token.tokenElement;
        if (current.dirty) {
          return setPopover({
            kind: "message",
            anchor,
            text: "Unsaved changes. Definitions are available once the file saves.",
          });
        }
        const unavailableReason = unavailableText();
        if (unavailableReason !== null) {
          return setPopover({ kind: "message", anchor, text: unavailableReason });
        }
        const request = ++requests.current.definition;
        const { cwd, relativePath, environmentId, onOpenLocation } = current;
        const requestFileKey = latest.current.fileKey;
        setPopover(null);
        showPendingSoon("definition", anchor, request);
        void definition({
          environmentId,
          input: { cwd, relativePath, ...tokenPosition(token) },
        }).then((result) => {
          if (
            requests.current.definition !== request ||
            latest.current.fileKey !== requestFileKey
          ) {
            return;
          }
          clearTimeout(timers.current.pending);
          if (result._tag !== "Success") {
            if (isAtomCommandInterrupted(result)) return setPopover(null);
            const error = squashAtomCommandFailure(result);
            return setPopover({
              kind: "message",
              anchor,
              text:
                error instanceof Error ? error.message : "The language server could not answer.",
            });
          }
          if (result.value.status === "unavailable") {
            unavailable.current = {
              fileKey: requestFileKey,
              text: unavailableMessage(result.value),
            };
          }
          const outcome = definitionOutcome(result.value);
          if (outcome.kind === "open") {
            setPopover(null);
            onOpenLocation(outcome.location.path, outcome.location.line);
          } else if (outcome.kind === "pick") {
            setPopover({ kind: "pick", anchor, locations: outcome.locations });
          } else {
            setPopover({ kind: "message", anchor, text: outcome.text });
          }
        });
      },
    }),
    // The handlers read everything else through refs, so Pierre keeps one set.
    [clearTimers, closeHoverSoon, setPopover, showPendingSoon, unavailableText],
  );

  const popoverNode =
    popover === null ? null : (
      <Popover
        open
        onOpenChange={(open) => {
          if (!open) setPopover(null);
        }}
      >
        <PopoverPopup
          anchor={popover.anchor}
          side="bottom"
          align="start"
          padding="compact"
          width={popover.kind === "hover" ? "lg" : "auto"}
          // Only the picker takes focus; a hover card must leave the editor's caret alone.
          initialFocus={popover.kind === "pick"}
          finalFocus={popover.kind === "pick"}
          onPointerEnter={() => clearTimeout(timers.current.close)}
          onPointerLeave={closeHoverSoon}
        >
          <CodeIntelligencePopoverBody
            state={popover}
            cwd={target.cwd}
            environmentId={target.environmentId}
            onPick={(location) => {
              setPopover(null);
              target.onOpenLocation(location.path, location.line);
            }}
          />
        </PopoverPopup>
      </Popover>
    );

  return { tokenOptions, popover: popoverNode };
}

function CodeIntelligencePopoverBody(props: {
  readonly state: PopoverState;
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly onPick: (location: CodeIntelligenceLocation) => void;
}) {
  const { state } = props;
  switch (state.kind) {
    case "pending":
      return <p className="text-muted-foreground text-xs">Waiting for the language server…</p>;
    case "message":
      return <p className="max-w-96 text-muted-foreground text-xs select-text">{state.text}</p>;
    case "hover":
      return state.contents.kind === "markdown" ? (
        <ChatMarkdown
          text={state.contents.value}
          cwd={props.cwd}
          environmentId={props.environmentId}
          className="text-xs"
        />
      ) : (
        <pre className="font-mono text-xs whitespace-pre-wrap">{state.contents.value}</pre>
      );
    case "pick":
      return (
        <div className="flex max-w-[min(36rem,80vw)] flex-col py-0.5" role="listbox">
          <p className="px-1 pb-1 text-muted-foreground text-xs">
            {state.locations.length} definitions
          </p>
          {state.locations.map((location) => (
            <button
              key={`${location.path}:${location.line}:${location.character}`}
              type="button"
              role="option"
              aria-selected={false}
              className="truncate rounded-md px-1.5 py-1 text-left font-mono text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => props.onPick(location)}
            >
              {formatLocation(location)}
            </button>
          ))}
        </div>
      );
  }
}

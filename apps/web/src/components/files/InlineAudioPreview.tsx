import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { LoaderCircleIcon, PauseIcon, PlayIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";

import { ContextChip, ContextChipAction, ContextChipLabel } from "../ContextChip";
import { middleTruncateAttachmentName } from "../composerInlineChip";

function audioTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/**
 * A play/pause chip for audio an agent shares in a message. The signed URL and the audio element
 * are only created once the chip scrolls into view; the chip name opens the full viewer.
 */
export function InlineAudioPreview(props: {
  readonly name: string;
  readonly environmentId?: EnvironmentId | undefined;
  readonly resource?: AssetResource | undefined;
  readonly src?: string | undefined;
  readonly copyMarkdown?: string | undefined;
  readonly onOpen?: (() => void) | undefined;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [visible, setVisible] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const asset = useAssetUrlState(
    visible ? (props.environmentId ?? null) : null,
    visible ? (props.resource ?? null) : null,
  );
  const src = visible ? (asset._tag === "Success" ? asset.url : props.src) : undefined;
  const failed = asset._tag === "Failure" || (src !== undefined && failedSrc === src);
  const loading = !failed && !ready;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const Icon = failed
    ? TriangleAlertIcon
    : loading
      ? LoaderCircleIcon
      : playing
        ? PauseIcon
        : PlayIcon;
  const action = failed ? "Retry" : loading ? "Loading" : playing ? "Pause" : "Play";
  const open = props.onOpen;

  return (
    <span ref={container} data-markdown-copy={props.copyMarkdown}>
      <ContextChip
        kind="file"
        {...(failed ? { state: "invalid" as const } : {})}
        className="relative isolate overflow-hidden"
        title={failed ? "Audio unavailable. Open the file or retry playback." : props.name}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 -z-10 bg-(--context-chip-accent)/17"
          style={{ width: `${duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0}%` }}
        />
        <ContextChipAction
          className="ml-0 [&_svg]:size-[1.17em]"
          aria-label={`${action} ${props.name}`}
          disabled={loading}
          onClick={() => {
            const element = audio.current;
            if (failed || !element) {
              setFailedSrc(null);
              return;
            }
            if (!element.paused) element.pause();
            else
              void element.play().catch((error: unknown) => {
                if (!(error instanceof DOMException && error.name === "AbortError"))
                  setFailedSrc(src ?? null);
              });
          }}
        >
          <Icon aria-hidden />
        </ContextChipAction>
        <ContextChipLabel className="max-w-72">
          {open ? (
            <button
              type="button"
              className="block max-w-full cursor-pointer truncate rounded-sm text-left focus-visible:outline-2 focus-visible:outline-foreground"
              onClick={open}
              aria-label={`Preview ${props.name}`}
            >
              {middleTruncateAttachmentName(props.name)}
            </button>
          ) : (
            middleTruncateAttachmentName(props.name)
          )}
        </ContextChipLabel>
        <span className="shrink-0 text-3xs text-current">
          {failed
            ? "Unavailable"
            : loading
              ? "..."
              : duration > 0
                ? elapsed > 0 || playing
                  ? `${audioTime(elapsed)} / ${audioTime(duration)}`
                  : audioTime(duration)
                : audioTime(elapsed)}
        </span>
        {src && !failed ? (
          <audio
            ref={audio}
            hidden
            preload="metadata"
            src={src}
            aria-label={props.name}
            onLoadedMetadata={(event) => {
              setReady(true);
              const value = event.currentTarget.duration;
              setDuration(Number.isFinite(value) ? value : 0);
            }}
            onCanPlay={() => setReady(true)}
            onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => setFailedSrc(src)}
          />
        ) : null}
      </ContextChip>
    </span>
  );
}

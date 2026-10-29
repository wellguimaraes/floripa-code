import * as Schema from "effect/Schema";
import { deriveProjectIdentity } from "../../projectIdentity";
import { ProjectMonogram } from "../ProjectMonogram";
import {
  PROJECT_SEARCH_ENTRIES_MAX_LIMIT,
  ProjectMonogramText,
  type AssetResource,
  type EnvironmentId,
  type ProjectIconColor,
  type ProjectIconOverride,
} from "@t3tools/contracts";
import { ImageIcon } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { useMemo, useRef, useState } from "react";
import {
  filterProjectIconNames,
  firstEmoji,
  PROJECT_EMOJIS,
  PROJECT_ICON_COLORS,
  projectIconColorClassName,
  projectImageIconPaths,
  isNamedLogoOrIcon,
  squareImageIconPaths,
} from "../../projectIconOptions";
import { cn } from "~/lib/utils";
import { useAssetUrlEntries } from "../../assets/assetUrls";
import { useProjectFilePickerQuery } from "../files/projectFilesQueryState";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const DEFAULT_ICON: IconName = "folder-code";
const PROJECT_IMAGE_LIMIT = 60;

/** What the dialog saves: an image from the project, or one of the drawn kinds. */
export type ProjectIconChoice =
  | { readonly faviconPath: string; readonly projectIcon: null }
  | { readonly faviconPath: null; readonly projectIcon: ProjectIconOverride };
type IconMode = ProjectIconOverride["kind"] | "project";
const isMonogramText = Schema.is(ProjectMonogramText);

function iconLabel(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

interface ProjectIconPickerProps {
  readonly current: ProjectIconOverride | null;
  /** The project image chosen as its icon, if any. */
  readonly currentFaviconPath: string | null;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  readonly onSelect: (icon: ProjectIconChoice) => void;
}

export function ProjectIconPickerDialog({
  open,
  onOpenChange,
  ...picker
}: ProjectIconPickerProps & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="w-full sm:w-[32rem]">
        <ProjectIconPicker {...picker} onClose={() => onOpenChange(false)} />
      </DialogPopup>
    </Dialog>
  );
}

/**
 * The icon picker's fields and its Cancel and Save buttons, inside a dialog's popup. It starts
 * from the current icon, so mount it each time it opens.
 */
function ProjectIconPicker({
  current,
  currentFaviconPath,
  environmentId,
  cwd,
  projectName,
  onSelect,
  onClose,
}: ProjectIconPickerProps & {
  readonly onClose: () => void;
}) {
  const automatic = deriveProjectIdentity(projectName);
  const initialMode: IconMode = current?.kind ?? (currentFaviconPath ? "project" : "lucide");
  const [mode, setMode] = useState<IconMode>(initialMode);
  const [imagePath, setImagePath] = useState<string | null>(currentFaviconPath);
  const [iconName, setIconName] = useState<IconName>(
    current?.kind === "lucide" ? (current.name as IconName) : DEFAULT_ICON,
  );
  const [color, setColor] = useState<ProjectIconColor>(
    current && current.kind !== "emoji" ? current.color : automatic.color,
  );
  const [letters, setLetters] = useState(
    current?.kind === "monogram" ? current.text : automatic.monogram,
  );
  const [emoji, setEmoji] = useState(current?.kind === "emoji" ? current.emoji : "💻");
  const [query, setQuery] = useState("");
  const [customEmoji, setCustomEmoji] = useState("");
  // The current icon or emoji scrolls into view as the picker opens, once, so it can be seen.
  const revealed = useRef(false);
  const reveal = (node: HTMLButtonElement | null) => {
    if (node === null || revealed.current) return;
    revealed.current = true;
    node.scrollIntoView({ block: "center" });
  };

  const icons = useMemo(() => filterProjectIconNames(query), [query]);
  const selectedColorClassName = projectIconColorClassName(color);
  const monogram = letters.normalize("NFKC").trim().toUpperCase();
  const validMonogram = isMonogramText(monogram);
  const canSave = mode === "monogram" ? validMonogram : mode === "project" ? !!imagePath : true;
  const save = () => {
    if (!canSave) return;
    if (mode === "project") {
      if (imagePath) onSelect({ faviconPath: imagePath, projectIcon: null });
    } else {
      onSelect({
        faviconPath: null,
        projectIcon:
          mode === "monogram"
            ? { kind: "monogram", text: monogram, color }
            : mode === "lucide"
              ? { kind: "lucide", name: iconName, color }
              : { kind: "emoji", emoji },
      });
    }
    onClose();
  };

  const fields = (
    <>
      <ToggleGroup
        aria-label="Icon type"
        variant="segmented"
        value={[mode]}
        onValueChange={(next) => {
          const value = next[0];
          if (
            value === "lucide" ||
            value === "emoji" ||
            value === "monogram" ||
            value === "project"
          ) {
            setMode(value);
          }
        }}
      >
        <Toggle value="lucide">Icons</Toggle>
        <Toggle value="emoji">Emoji</Toggle>
        <Toggle value="monogram">Monogram</Toggle>
        <Toggle value="project">Project</Toggle>
      </ToggleGroup>

      {mode === "lucide" || mode === "monogram" ? (
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Color</div>
          {/* One row: swatches spread across it, and shrink rather than wrap when it's narrow. */}
          <div className="flex justify-between" role="group" aria-label="Icon color">
            {PROJECT_ICON_COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={color === option.value}
                className={cn(
                  "flex aspect-square max-w-6 min-w-0 flex-1 items-center justify-center rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  color === option.value && "border-foreground/64",
                )}
                onClick={() => setColor(option.value)}
              >
                <span
                  className={cn(
                    "aspect-square w-4 max-w-[66%] rounded-full",
                    option.swatchClassName,
                  )}
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "lucide" ? (
        <>
          <Input
            type="search"
            value={query}
            aria-label="Search Lucide icons"
            placeholder="Search all Lucide icons"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <ScrollArea scrollFade className="max-h-64">
            <div className="grid grid-cols-8 gap-1 p-0.5 sm:grid-cols-10">
              {icons.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-label={iconLabel(name)}
                  aria-pressed={iconName === name}
                  ref={current?.kind === "lucide" && current.name === name ? reveal : undefined}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-md border border-transparent outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    iconName === name && "border-border bg-accent",
                    selectedColorClassName,
                  )}
                  onClick={() => setIconName(name)}
                >
                  <DynamicIcon name={name} className="size-5" />
                </button>
              ))}
            </div>
          </ScrollArea>
          {icons.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No icons found.</p>
          ) : null}
        </>
      ) : mode === "project" ? (
        <ProjectImageGrid
          environmentId={environmentId}
          cwd={cwd}
          selected={imagePath}
          onSelect={setImagePath}
        />
      ) : mode === "monogram" ? (
        <div className="flex items-center gap-4 py-2">
          <ProjectMonogram
            text={validMonogram ? monogram : automatic.monogram}
            color={color}
            className="size-12"
          />
          <div className="flex-1 space-y-2">
            <label htmlFor="project-monogram" className="text-sm font-medium">
              Letters
            </label>
            <Input
              id="project-monogram"
              value={letters}
              onChange={(event) => setLetters(event.currentTarget.value)}
              aria-describedby="project-monogram-hint"
              aria-invalid={!validMonogram}
              autoComplete="off"
            />
            <p id="project-monogram-hint" className="text-xs text-muted-foreground">
              One or two letters or numbers.
            </p>
          </div>
        </div>
      ) : (
        <>
          <ScrollArea scrollFade className="max-h-64">
            <div className="grid grid-cols-8 gap-1 p-0.5 sm:grid-cols-10">
              {PROJECT_EMOJIS.map((option) => (
                <button
                  key={option.emoji}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={emoji === option.emoji}
                  ref={
                    current?.kind === "emoji" && current.emoji === option.emoji ? reveal : undefined
                  }
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-md border border-transparent text-xl outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    emoji === option.emoji && "border-border bg-accent",
                  )}
                  onClick={() => setEmoji(option.emoji)}
                >
                  {option.emoji}
                </button>
              ))}
            </div>
          </ScrollArea>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Or paste any emoji</div>
            <Input
              value={customEmoji}
              aria-label="Custom emoji"
              placeholder="Paste an emoji"
              onChange={(event) => {
                const value = event.currentTarget.value;
                setCustomEmoji(value);
                const nextEmoji = firstEmoji(value);
                if (nextEmoji) setEmoji(nextEmoji);
              }}
            />
          </div>
        </>
      )}
    </>
  );
  const actions = (
    <>
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
      <Button onClick={save} disabled={!canSave}>
        Save icon
      </Button>
    </>
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose project icon</DialogTitle>
        <DialogDescription>
          Choose an icon, emoji, monogram, or an image from the project.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex min-h-0 flex-col">{fields}</DialogPanel>
      <DialogFooter>{actions}</DialogFooter>
    </>
  );
}

/** The project's own images, mounted only on its tab so the file index is asked for on demand. */
function ProjectImageGrid({
  environmentId,
  cwd,
  selected,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly selected: string | null;
  readonly onSelect: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  // Paths are cheap and many get left out (docs, tests, odd shapes), so the search asks for
  // as many as the server allows.
  const result = useProjectFilePickerQuery(
    environmentId,
    cwd,
    query,
    PROJECT_SEARCH_ENTRIES_MAX_LIMIT,
    {
      imageOnly: true,
    },
  );
  // Twice the tiles we show, so dropping wide or tall images still leaves a full grid.
  const candidates = useMemo(
    () =>
      projectImageIconPaths(
        result.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
        result.matchedQuery,
        PROJECT_IMAGE_LIMIT * 2,
      ),
    [result.entries, result.matchedQuery],
  );
  // Each tile shows the file itself. A project-favicon URL would not do: the server serves the
  // project's saved icon for it whatever path is asked for, so every tile looked the same.
  const resources = useMemo(
    () => candidates.map((path): AssetResource => ({ _tag: "draft-workspace-file", cwd, path })),
    [cwd, candidates],
  );
  const assets = useAssetUrlEntries(environmentId, resources);
  // An icon is square, unless it says otherwise in its name. Raster sizes come from the file
  // header; others are checked on load.
  const [wideOnLoad, setWideOnLoad] = useState<ReadonlySet<string>>(() => new Set());
  const square = useMemo(
    () =>
      squareImageIconPaths(
        candidates,
        assets.map((asset) => (asset === undefined ? undefined : (asset?.imageDimensions ?? null))),
        PROJECT_IMAGE_LIMIT,
      ),
    [assets, candidates],
  );
  const urlByPath = useMemo(
    () => new Map(candidates.map((path, index) => [path, assets[index]?.url ?? null])),
    [assets, candidates],
  );
  const paths = square.paths.filter((path) => !wideOnLoad.has(path));
  return (
    <>
      <Input
        type="search"
        value={query}
        aria-label="Search project images"
        placeholder="Search project images"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {paths.length > 0 ? (
        <ScrollArea scrollFade className="max-h-64">
          <div className="grid grid-cols-6 gap-1 p-0.5 sm:grid-cols-8">
            {paths.map((path) => (
              <Tooltip key={path}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={path}
                      aria-pressed={selected === path}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md border border-transparent outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        selected === path && "border-border bg-accent",
                      )}
                      onClick={() => onSelect(path)}
                    />
                  }
                >
                  {/* No URL without file read access, and browsers cannot draw .icns. */}
                  {urlByPath.get(path) ? (
                    <img
                      src={urlByPath.get(path)!}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className="size-7 object-contain"
                      onLoad={(event) => {
                        const { naturalWidth, naturalHeight } = event.currentTarget;
                        if (naturalWidth === naturalHeight || isNamedLogoOrIcon(path)) return;
                        setWideOnLoad((current) => new Set(current).add(path));
                      }}
                    />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground" />
                  )}
                </TooltipTrigger>
                <TooltipPopup>{path}</TooltipPopup>
              </Tooltip>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          {result.isPending || square.pending ? <Spinner size="sm" tone="muted" /> : null}
          {result.error ??
            (result.isPending || square.pending
              ? "Looking for images…"
              : query.trim()
                ? "No matching images."
                : "No images in this project.")}
        </p>
      )}
    </>
  );
}

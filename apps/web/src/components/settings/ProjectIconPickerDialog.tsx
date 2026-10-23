import * as Schema from "effect/Schema";
import { deriveProjectIdentity } from "../../projectIdentity";
import { ProjectMonogram } from "../ProjectMonogram";
import {
  ProjectMonogramText,
  type EnvironmentId,
  type ProjectIconColor,
  type ProjectIconOverride,
} from "@t3tools/contracts";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterProjectIconNames,
  firstEmoji,
  PROJECT_EMOJIS,
  PROJECT_ICON_COLORS,
  projectIconColorClassName,
  projectImageIconPaths,
} from "../../projectIconOptions";
import { cn } from "~/lib/utils";
import { useProjectFilePickerQuery } from "../files/projectFilesQueryState";
import { ProjectFavicon } from "../ProjectFavicon";
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

export function ProjectIconPickerDialog({
  current,
  currentFaviconPath,
  environmentId,
  cwd,
  projectName,
  open,
  onOpenChange,
  onSelect,
}: {
  readonly current: ProjectIconOverride | null;
  /** The project image chosen as its icon, if any. */
  readonly currentFaviconPath: string | null;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (icon: ProjectIconChoice) => void;
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
  const previousOpenRef = useRef(false);

  useEffect(() => {
    if (open && !previousOpenRef.current) {
      setMode(initialMode);
      setImagePath(currentFaviconPath);
      setIconName(current?.kind === "lucide" ? (current.name as IconName) : DEFAULT_ICON);
      setColor(current && current.kind !== "emoji" ? current.color : automatic.color);
      setLetters(current?.kind === "monogram" ? current.text : automatic.monogram);
      setEmoji(current?.kind === "emoji" ? current.emoji : "💻");
      setQuery("");
      setCustomEmoji("");
    }
    previousOpenRef.current = open;
  }, [current, currentFaviconPath, initialMode, open, automatic.color, automatic.monogram]);

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
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="w-full sm:w-[32rem]">
        <DialogHeader>
          <DialogTitle>Choose project icon</DialogTitle>
          <DialogDescription>
            Choose an icon, emoji, monogram, or an image from the project.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col">
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
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Icon color">
                {PROJECT_ICON_COLORS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={color === option.value}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      color === option.value && "border-foreground/64",
                    )}
                    onClick={() => setColor(option.value)}
                  >
                    <span className={cn("size-4 rounded-full", option.swatchClassName)} />
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
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Or paste any emoji
                </div>
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
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            Save icon
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
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
  const result = useProjectFilePickerQuery(environmentId, cwd, query, PROJECT_IMAGE_LIMIT * 2, {
    imageOnly: true,
  });
  const paths = useMemo(
    () =>
      projectImageIconPaths(
        result.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
        result.matchedQuery,
        PROJECT_IMAGE_LIMIT,
      ),
    [result.entries, result.matchedQuery],
  );
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
                  <ProjectFavicon
                    project={{
                      environmentId,
                      workspaceRoot: cwd,
                      title: "",
                      faviconPath: path,
                      projectIcon: null,
                    }}
                    className="size-7"
                  />
                </TooltipTrigger>
                <TooltipPopup>{path}</TooltipPopup>
              </Tooltip>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          {result.isPending ? <Spinner size="sm" tone="muted" /> : null}
          {result.error ??
            (result.isPending
              ? "Looking for images…"
              : query.trim()
                ? "No matching images."
                : "No images in this project.")}
        </p>
      )}
    </>
  );
}

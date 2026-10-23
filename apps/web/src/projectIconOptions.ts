import { iconNames, type IconName } from "lucide-react/dynamic";
export { PROJECT_ICON_COLORS, projectIconColorClassName } from "./projectIconColors";

const POPULAR_PROJECT_ICONS = [
  "folder-code",
  "code-2",
  "terminal",
  "globe-2",
  "server",
  "database",
  "bot",
  "sparkles",
  "smartphone",
  "monitor",
  "cloud-cog",
  "package",
  "book-open",
  "flask-conical",
  "shield-check",
  "rocket",
  "gamepad-2",
  "music",
  "image",
  "shopping-bag",
  "git-branch",
  "workflow",
  "wrench",
  "layers-3",
] as const satisfies ReadonlyArray<IconName>;

export const PROJECT_EMOJIS: ReadonlyArray<{ readonly emoji: string; readonly label: string }> = [
  { emoji: "💻", label: "Computer" },
  { emoji: "🛠️", label: "Tools" },
  { emoji: "🚀", label: "Rocket" },
  { emoji: "🤖", label: "Robot" },
  { emoji: "✨", label: "Sparkles" },
  { emoji: "⚡", label: "Lightning" },
  { emoji: "🌐", label: "Web" },
  { emoji: "📱", label: "Mobile" },
  { emoji: "🖥️", label: "Desktop" },
  { emoji: "⌨️", label: "Keyboard" },
  { emoji: "⚙️", label: "Gear" },
  { emoji: "🗄️", label: "Database" },
  { emoji: "☁️", label: "Cloud" },
  { emoji: "📦", label: "Package" },
  { emoji: "📚", label: "Books" },
  { emoji: "🧪", label: "Test tube" },
  { emoji: "🔒", label: "Lock" },
  { emoji: "🎮", label: "Game" },
  { emoji: "🎵", label: "Music" },
  { emoji: "🎬", label: "Movie" },
  { emoji: "🖼️", label: "Picture" },
  { emoji: "🛍️", label: "Shopping" },
  { emoji: "🔥", label: "Fire" },
  { emoji: "💡", label: "Idea" },
  { emoji: "🧩", label: "Puzzle" },
  { emoji: "📊", label: "Chart" },
  { emoji: "🧠", label: "Brain" },
  { emoji: "🦄", label: "Unicorn" },
  { emoji: "🐙", label: "Octopus" },
  { emoji: "🌱", label: "Seedling" },
];

export function filterProjectIconNames(query: string): ReadonlyArray<IconName> {
  const normalized = query.trim().toLowerCase().replaceAll(/\s+/g, "-");
  if (!normalized) return POPULAR_PROJECT_ICONS;
  return iconNames.filter((name) => name.includes(normalized)).slice(0, 60);
}

export function firstEmoji(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed);
  const segment = segments[Symbol.iterator]().next().value?.segment;
  const isFlag = /^\p{Regional_Indicator}{2}$/u.test(segment ?? "");
  const isKeycap = /^[#*0-9]\uFE0F?\u20E3$/u.test(segment ?? "");
  if (!segment || (!/\p{Extended_Pictographic}/u.test(segment) && !isFlag && !isKeycap)) {
    return null;
  }
  return segment;
}

const ICON_LIKE_IMAGE = /(favicon|app-?icon|apple-touch|icon|logo)[^/]*$/i;

/**
 * The project's images to offer as icons: with no search, files named like an
 * icon or logo lead, in the server's order otherwise. Capped, since each one
 * shown asks the server for its URL.
 */
export function projectImageIconPaths(
  paths: ReadonlyArray<string>,
  query: string,
  limit: number,
): ReadonlyArray<string> {
  const offered = paths.filter((path) => !isDocumentImage(path));
  if (query.trim().length > 0) return offered.slice(0, limit);
  const iconLike = offered.filter((path) => ICON_LIKE_IMAGE.test(path));
  const rest = offered.filter((path) => !ICON_LIKE_IMAGE.test(path));
  return [...iconLike, ...rest].slice(0, limit);
}

const DOCUMENT_IMAGE_WORDS = new Set([
  "pdf",
  "doc",
  "docs",
  "documentation",
  "screenshot",
  "screenshots",
  "snapshot",
  "snapshots",
  "test",
  "tests",
  "fixture",
  "fixtures",
  "diagram",
  "diagrams",
]);

/**
 * An image that illustrates a document, test or screenshot rather than the project, by a word
 * anywhere in its path. Whole words, so `docker-logo.png` is not a doc.
 */
export function isDocumentImage(path: string): boolean {
  return path
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => DOCUMENT_IMAGE_WORDS.has(word));
}

/** A file named as a logo or icon is one, whatever its shape. */
export function isNamedLogoOrIcon(path: string): boolean {
  return /logo|icon/i.test(path.slice(path.lastIndexOf("/") + 1));
}

/**
 * The image tiles to show: square images, and any named as a logo or icon, in order, up to `limit`. `sizes` lines up
 * with `paths`: undefined while a size is still being read, null when it can't be read
 * (vectors, icons, no file access), which keeps the image. Waits on a pending size so
 * tiles don't appear and then vanish.
 */
export function squareImageIconPaths(
  paths: ReadonlyArray<string>,
  sizes: ReadonlyArray<{ readonly width: number; readonly height: number } | null | undefined>,
  limit: number,
): { readonly paths: ReadonlyArray<string>; readonly pending: boolean } {
  const kept: string[] = [];
  for (const [index, path] of paths.entries()) {
    if (kept.length === limit) break;
    if (isNamedLogoOrIcon(path)) {
      kept.push(path);
      continue;
    }
    const size = sizes[index];
    if (size === undefined) return { paths: kept, pending: true };
    if (size === null || size.width === size.height) kept.push(path);
  }
  return { paths: kept, pending: false };
}

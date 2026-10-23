import { useAtomValue } from "@effect/atom-react";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";
import type { IconNode } from "lucide-react";
import { dynamicIconImports } from "lucide-react/dynamic";
import { useEffect, useMemo, useState } from "react";

import { projectIconColorValue } from "../../projectIconColors";
import { deriveProjectIdentity } from "../../projectIdentity";
import { projectFaviconUrlAtom } from "../../state/assets";
import type { ProjectFaviconProject } from "../ProjectFavicon";

/**
 * What an island's sign paints for its project's icon: a picture, a monogram in its colour
 * (drawn like `ProjectMonogram`), or an emoji, which brings its own colours.
 */
export type SignIcon =
  | { readonly kind: "image"; readonly image: HTMLImageElement }
  | { readonly kind: "monogram"; readonly text: string; readonly color: string }
  | { readonly kind: "emoji"; readonly text: string };

/**
 * The project's icon as the sidebar shows it, ready to paint onto a sign board.
 * Lucide icons and monograms take the colour picked for them; the automatic monogram takes the
 * project's identity colour, as in the sidebar. Until a picture loads, or if it fails, the sign
 * shows that monogram. `ink` stands in for a colour the stylesheet can't give yet.
 */
export function useSignIcon(project: ProjectFaviconProject, ink: string): SignIcon {
  const override = project.projectIcon;
  const favicon = useAtomValue(
    projectFaviconUrlAtom({
      environmentId: project.environmentId,
      cwd: project.workspaceRoot,
      faviconPath: project.faviconPath,
    }),
  );
  const pickedColor =
    override?.kind === "lucide" || override?.kind === "monogram" ? override.color : null;
  const glyphInk = useMemo(
    () => (pickedColor === null ? ink : (projectIconColorValue(pickedColor) ?? ink)),
    [ink, pickedColor],
  );
  const lucide = useLucideSvgUrl(override?.kind === "lucide" ? override.name : null, glyphInk);
  const source =
    override?.kind === "lucide"
      ? lucide
      : override == null && favicon !== null && !isProjectFaviconFallbackUrl(favicon)
        ? favicon
        : null;
  const image = useLoadedImage(source);
  const emoji = override?.kind === "emoji" ? override.emoji : null;
  const identity = deriveProjectIdentity(project.title);
  const text = override?.kind === "monogram" ? override.text : identity.monogram;
  const identityColor = useMemo(
    () => projectIconColorValue(identity.color) ?? ink,
    [identity.color, ink],
  );
  const monogramColor = override?.kind === "monogram" ? glyphInk : identityColor;
  return useMemo(
    () =>
      image
        ? { kind: "image", image }
        : emoji !== null
          ? { kind: "emoji", text: emoji }
          : { kind: "monogram", text, color: monogramColor },
    [emoji, image, monogramColor, text],
  );
}

function useLucideSvgUrl(name: string | null, ink: string): string | null {
  const [loaded, setLoaded] = useState<{ readonly name: string; readonly node: IconNode } | null>(
    null,
  );
  useEffect(() => {
    const load =
      name === null ? undefined : dynamicIconImports[name as keyof typeof dynamicIconImports];
    if (name === null || load === undefined) return;
    let live = true;
    void load().then((module) => {
      if (live) setLoaded({ name, node: module.__iconNode });
    });
    return () => {
      live = false;
    };
  }, [name]);
  const node = loaded?.name === name ? loaded.node : null;
  return useMemo(() => (node === null ? null : lucideSvgUrl(node, ink)), [node, ink]);
}

function lucideSvgUrl(node: IconNode, ink: string): string {
  const children = node
    .map(
      ([tag, attributes]) =>
        `<${tag} ${Object.entries(attributes)
          .filter(([key]) => key !== "key")
          .map(([key, value]) => `${key}="${value}"`)
          .join(" ")}/>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function useLoadedImage(source: string | null): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{
    readonly source: string;
    readonly image: HTMLImageElement;
  } | null>(null);
  useEffect(() => {
    if (source === null) return;
    const image = new Image();
    // A cross-origin picture without CORS would taint the board and break its texture.
    image.crossOrigin = "anonymous";
    image.src = source;
    let live = true;
    image
      .decode()
      .then(() => {
        if (live) setLoaded({ source, image });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [source]);
  return loaded?.source === source ? loaded.image : null;
}

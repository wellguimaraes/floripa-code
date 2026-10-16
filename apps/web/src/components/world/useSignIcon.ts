import { useAtomValue } from "@effect/atom-react";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";
import type { IconNode } from "lucide-react";
import { dynamicIconImports } from "lucide-react/dynamic";
import { useEffect, useMemo, useState } from "react";

import { deriveProjectIdentity } from "../../projectIdentity";
import { projectFaviconUrlAtom } from "../../state/assets";
import type { ProjectFaviconProject } from "../ProjectFavicon";

/** What an island's sign paints for its project's icon: a picture, or a glyph in the sign's ink. */
export type SignIcon =
  | { readonly kind: "image"; readonly image: HTMLImageElement }
  | { readonly kind: "text"; readonly text: string };

/**
 * The project's icon as the sidebar shows it, ready to paint onto a sign board.
 * Lucide icons are stroked in `ink` so they read on the icon's tile; until a
 * picture loads, or if it fails, the sign shows the project's monogram.
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
  const lucide = useLucideSvgUrl(override?.kind === "lucide" ? override.name : null, ink);
  const source =
    override?.kind === "lucide"
      ? lucide
      : override == null && favicon !== null && !isProjectFaviconFallbackUrl(favicon)
        ? favicon
        : null;
  const image = useLoadedImage(source);
  const text =
    override?.kind === "emoji"
      ? override.emoji
      : override?.kind === "monogram"
        ? override.text
        : deriveProjectIdentity(project.title).monogram;
  return useMemo(() => (image ? { kind: "image", image } : { kind: "text", text }), [image, text]);
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

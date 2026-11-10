import { Suspense, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { MermaidDiagram } from "../chat/MermaidDiagram";
import { FileSurfaceLoading } from "./fileSurfaceChrome";

// Mermaid lays out DOM before sanitizing its SVG. Refuse resource and config
// syntax before that pass so a standalone file cannot initiate requests. Node
// metadata is YAML, whose escaped or aliased image keys cannot be checked lexically.
const UNSAFE_MERMAID_SOURCE =
  /%%\s*\{|^\s*---|<\/?[A-Za-z]|<[!?]|@\s*\{|\b(?:img|image)\s*:|url\s*\(|@import|(?:https?|data|blob|file):/im;

export default function MermaidViewer(props: { readonly text: string }) {
  const { resolvedTheme } = useTheme();
  const [expanded, setExpanded] = useState<string | null>(null);
  if (UNSAFE_MERMAID_SOURCE.test(props.text)) {
    return (
      <div role="alert" className="p-6 text-xs text-muted-foreground">
        This diagram contains resource URLs, markup, node metadata, or custom configuration. Show
        Mermaid source to inspect it safely.
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <Suspense fallback={<FileSurfaceLoading />}>
        <MermaidDiagram source={props.text} theme={resolvedTheme} onExpand={setExpanded} />
      </Suspense>
      {expanded ? (
        <ExpandedImageDialog
          preview={{ images: [{ src: expanded, name: "Mermaid diagram" }], index: 0 }}
          onClose={() => setExpanded(null)}
        />
      ) : null}
    </div>
  );
}

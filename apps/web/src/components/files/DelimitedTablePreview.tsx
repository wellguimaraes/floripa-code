import { lazy, Suspense, type ComponentProps } from "react";
import { FileSurfaceLoading } from "./fileSurfaceChrome";

const LargeTextViewer = lazy(() => import("./LargeTextViewer"));

/**
 * A virtualized viewer for large text. Pass `text` for content already in memory, or `src` and
 * `sizeBytes` to page through a remote file by byte range. A delimiter renders a table; null
 * renders numbered lines.
 */
export function LargeTextPreview(props: ComponentProps<typeof LargeTextViewer>) {
  return (
    <Suspense fallback={<FileSurfaceLoading />}>
      <LargeTextViewer key={props.name} {...props} />
    </Suspense>
  );
}

/** A virtualized table for CSV and TSV text; the source view keeps every byte. */
export function DelimitedTablePreview(props: {
  readonly name: string;
  readonly text: string;
  readonly delimiter: "," | "\t";
}) {
  return <LargeTextPreview {...props} />;
}

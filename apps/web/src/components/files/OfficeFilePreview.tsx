import { lazy, Suspense } from "react";

import { FileSurfaceLoading } from "./fileSurfaceChrome";
import type { OfficeKind } from "./officePreviewProtocol";

// Each renderer is a large engine, so none loads until a matching file is opened.
const OfficeViewer = lazy(() => import("./OfficeViewer"));

export function OfficeFilePreview(props: {
  readonly src: string;
  readonly name: string;
  readonly kind: OfficeKind;
  readonly sizeBytes?: number;
}) {
  return (
    <Suspense fallback={<FileSurfaceLoading />}>
      <OfficeViewer key={JSON.stringify([props.src, props.kind, props.sizeBytes])} {...props} />
    </Suspense>
  );
}

import { lazy, Suspense } from "react";

import { FileSurfaceLoading } from "./fileSurfaceChrome";
import type { OpenXmlKind } from "./officePreviewProtocol";

// Each renderer is a large engine, so none loads until a matching file is opened.
const OpenXmlOfficeViewer = lazy(() => import("./OpenXmlOfficeViewer"));

export function OfficeFilePreview(props: {
  readonly src: string;
  readonly name: string;
  readonly kind: OpenXmlKind;
  readonly sizeBytes?: number;
}) {
  return (
    <Suspense fallback={<FileSurfaceLoading />}>
      <OpenXmlOfficeViewer key={JSON.stringify([props.src, props.kind])} {...props} />
    </Suspense>
  );
}

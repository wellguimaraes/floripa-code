import {
  useEffect,
  useEffectEvent,
  useState,
  type ComponentProps,
  type SyntheticEvent,
} from "react";

import { isHeicImageFile } from "../../lib/imageCompression";

type AttachmentImageProps = ComponentProps<"img"> & {
  name: string;
  mimeType?: string | undefined;
  /** Reports the URL actually displayed, which is a decoded copy for HEIC and TIFF. */
  onResolvedSrc?: (src: string) => void;
};

// Keep import expressions outside hooks until React Compiler supports them.
const loadImageDecoder = () => import("../files/decodeImagePreview");

/** Browsers cannot show HEIC or TIFF, so those decode in a worker once the native load fails. */
export function AttachmentImage({ name, mimeType, ...props }: AttachmentImageProps) {
  const fallback =
    isHeicImageFile({ name, type: mimeType ?? "" }) ||
    /\.tiff?$/i.test(name) ||
    /^image\/tiff$/i.test(mimeType ?? "");
  return fallback ? (
    <DecodedImage key={props.src} {...props} name={name} mimeType={mimeType} />
  ) : (
    <PlainImage {...props} />
  );
}

// A natively decodable image is its own displayed URL, so there is nothing to report.
function PlainImage({
  onResolvedSrc: _onResolvedSrc,
  ...props
}: Omit<AttachmentImageProps, "name" | "mimeType">) {
  return <img {...props} />;
}

function DecodedImage({
  name,
  mimeType,
  src,
  onError,
  onResolvedSrc,
  ...props
}: AttachmentImageProps) {
  const [decodeError, setDecodeError] = useState<SyntheticEvent<HTMLImageElement> | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const reportError = useEffectEvent((event: SyntheticEvent<HTMLImageElement>) => onError?.(event));
  const displayed = previewUrl ?? src;
  useEffect(() => {
    if (!decodeError || !src) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void loadImageDecoder()
      .then(async ({ decodeImagePreview }) => {
        if (controller.signal.aborted) return;
        const blob = await decodeImagePreview(
          src,
          /\.hei[cf]$/i.test(name) || /^image\/hei[cf]$/i.test(mimeType ?? ""),
          controller.signal,
        );
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        onResolvedSrc?.(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) reportError(decodeError);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [decodeError, name, src, mimeType, onResolvedSrc]);
  return <img {...props} src={displayed} onError={decodeError ? onError : setDecodeError} />;
}

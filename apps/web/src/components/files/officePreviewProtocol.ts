export const OFFICE_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;
export const OFFICE_PREVIEW_MAX_ROWS = 250_000;
export const OFFICE_PREVIEW_MAX_COLUMNS = 1024;

/** The Office Open XML formats the Office worker prepares for a layout engine. */
export type OpenXmlKind = "docx" | "xlsx" | "pptx";

export type OfficeWorkerRequest = {
  readonly type: "open";
  readonly kind: OpenXmlKind;
  readonly bytes: ArrayBuffer;
};

export type OfficeWorkerResult =
  | { readonly type: "error"; readonly message: string }
  | {
      readonly type: OpenXmlKind;
      readonly bytes: ArrayBuffer;
      readonly truncated: boolean;
    };

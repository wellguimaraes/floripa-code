interface CodeViewViewport {
  getScrollTop(): number;
  getHeight(): number;
  getScrollHeight(): number;
  getTopForItem(id: string): number | undefined;
}

/**
 * The first unfolded file with any of its rows on screen, in diff order. A file tree that opens
 * over a scrolled diff uses it to pick the file the reader was already reading.
 */
export function firstExpandedFileInView(
  viewport: CodeViewViewport | undefined,
  files: ReadonlyArray<{ readonly fileKey: string; readonly collapsed: boolean }>,
): string | null {
  if (!viewport) return null;
  const top = viewport.getScrollTop();
  const bottom = top + viewport.getHeight();
  for (const [index, file] of files.entries()) {
    const start = viewport.getTopForItem(file.fileKey);
    if (start === undefined) continue;
    if (start >= bottom) break;
    const next = files[index + 1];
    const end = (next && viewport.getTopForItem(next.fileKey)) ?? viewport.getScrollHeight();
    if (!file.collapsed && end > top) return file.fileKey;
  }
  return null;
}

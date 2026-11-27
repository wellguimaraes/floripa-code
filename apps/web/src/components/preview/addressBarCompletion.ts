export interface AddressBarCompletion {
  /** What the user actually typed; the rest of `text` is the suggestion. */
  typed: string;
  /** The typed prefix followed by the suggested remainder. */
  text: string;
  /** History URL to open when the user submits `text` unchanged. */
  url: string;
}

/** Forms of a history URL a user may start typing, most explicit first. */
function completionCandidates(url: string): string[] {
  const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const bare = withoutScheme.replace(/^www\./i, "");
  // A root URL reads as its host, the way browsers complete it.
  const trimRoot = (value: string) => value.replace(/^([^/?#]+)\/$/, "$1");
  return [url, trimRoot(withoutScheme), trimRoot(bare)];
}

/**
 * Inline completion for the address bar: the most recent history URL that
 * starts with what the user typed, matched with or without scheme and `www.`.
 * Entries must be ordered most recent first.
 */
export function findAddressBarCompletion(
  urls: ReadonlyArray<string>,
  typed: string,
): AddressBarCompletion | null {
  if (typed.length === 0 || /\s/.test(typed)) return null;
  const lowerTyped = typed.toLowerCase();
  for (const url of urls) {
    for (const candidate of completionCandidates(url)) {
      if (candidate.length > typed.length && candidate.toLowerCase().startsWith(lowerTyped)) {
        return { typed, text: typed + candidate.slice(typed.length), url };
      }
    }
  }
  return null;
}

import type { ServerProvider, ThreadRetitleProvider } from "@t3tools/contracts";

/** Who can decide that a thread moved to a new task, in the order users are offered them. */
export const THREAD_RETITLE_CHOICES: ReadonlyArray<{
  readonly value: ThreadRetitleProvider;
  readonly label: string;
  readonly detail: string;
}> = [
  {
    value: "openrouter",
    label: "OpenRouter",
    detail: "Fastest. A decision model on OpenRouter decides with your OpenRouter key.",
  },
  {
    value: "claudeAgent",
    label: "Claude subscription",
    detail: "Claude Haiku 5.5 decides and writes the new title.",
  },
  {
    value: "codex",
    label: "OpenAI subscription",
    detail: "GPT-6 Luna decides and writes the new title.",
  },
  {
    value: "cursor",
    label: "Cursor subscription",
    detail: "Cursor's Auto model decides and writes the new title.",
  },
];

/**
 * The choices this environment can use now: OpenRouter with a key, and each
 * subscription with a signed-in, enabled account.
 */
export function availableRetitleProviders(input: {
  readonly providers: ReadonlyArray<ServerProvider> | null | undefined;
  readonly hasOpenRouterKey: boolean;
}): ReadonlySet<ThreadRetitleProvider> {
  const available = new Set<ThreadRetitleProvider>();
  if (input.hasOpenRouterKey) available.add("openrouter");
  for (const provider of input.providers ?? []) {
    if (
      provider.enabled &&
      provider.installed &&
      provider.status !== "disabled" &&
      provider.status !== "error" &&
      provider.auth.status !== "unauthenticated"
    ) {
      for (const choice of THREAD_RETITLE_CHOICES) {
        if (choice.value === provider.driver) available.add(choice.value);
      }
    }
  }
  return available;
}

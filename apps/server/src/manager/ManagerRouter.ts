/**
 * ManagerRouter - guesses where a message sent to an island's manager belongs:
 * which checkout the work happens in, and which agent there (or a new one).
 * One call to OpenRouter's Jev decision model answers both, as probabilities,
 * so the client can ask the user to confirm a strong guess or pick from the rest.
 *
 * @module manager/ManagerRouter
 */
import {
  type ManagerCheckout,
  type ManagerRoute,
  ManagerRouteError,
  type ManagerRouteInput,
  type ThreadId,
} from "@t3tools/contracts";
import { limitTitleMessage } from "@t3tools/provider-core/server/threadTitleContext";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import { isNativeMaintenanceCommand } from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";

const DECISIONS_API = "https://openrouter.ai/api/alpha/decisions";
const JEV_MODEL = "~typesafe/jev-latest";
// Enough to tell agents apart; more history only adds noise (see the routing spike).
const RECENT_USER_MESSAGES = 3;
const USER_MESSAGE_CHARS = 300;
// Long replies lose their middle, often the option the user is answering ("Option A
// (recommended)"); much less, and two agents that both ended "Should I build it?" look alike.
const AGENT_REPLY_CHARS = 1_500;
const NEW_MESSAGE_CHARS = 2_000;
const NEW_WORKTREE = "new_worktree";
const NEW_AGENT = "new_agent";

const ChoiceAnswer = Schema.Struct({
  choice: Schema.String,
  probabilities: Schema.Record(Schema.String, Schema.Number),
});
const DecisionsResponse = Schema.Struct({
  answers: Schema.Struct({ where: ChoiceAnswer, target: ChoiceAnswer }),
});
const decodeDecisions = Schema.decodeUnknownOption(DecisionsResponse);

const failed = (detail: string) => new ManagerRouteError({ reason: "failed", detail });

/** What the manager knows about one agent on the island. */
export interface ManagerAgent {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly minutesSinceActive: number;
  /** Oldest first. */
  readonly recentUserMessages: ReadonlyArray<string>;
  readonly lastAgentReply: string | null;
}

/**
 * The decisions request for an island: its checkouts, each with the agents
 * working there, under short labels Jev answers with, and the label maps back.
 */
export function buildManagerRequest(
  agents: ReadonlyArray<ManagerAgent>,
  input: Pick<ManagerRouteInput, "mainBranch" | "worktrees" | "message">,
) {
  const branchByPath = new Map(input.worktrees.map((worktree) => [worktree.path, worktree.branch]));
  for (const agent of agents) {
    if (agent.worktreePath !== null && !branchByPath.has(agent.worktreePath))
      branchByPath.set(agent.worktreePath, agent.branch ?? "unknown");
  }
  const checkouts: ReadonlyArray<{ label: string; checkout: ManagerCheckout; branch: string }> = [
    {
      label: "main",
      checkout: { kind: "local" },
      branch: input.mainBranch ?? "the default branch",
    },
    ...[...branchByPath].map(([path, branch], index) => ({
      label: `worktree_${index + 1}`,
      checkout: { kind: "worktree" as const, path },
      branch,
    })),
  ];
  const agentLabels = new Map(agents.map((agent, index) => [`agent_${index + 1}`, agent]));
  const labelOf = new Map([...agentLabels].map(([label, agent]) => [agent.threadId, label]));
  const inCheckout = (checkout: ManagerCheckout) =>
    agents.filter((agent) =>
      checkout.kind === "local"
        ? agent.worktreePath === null
        : checkout.kind === "worktree" && agent.worktreePath === checkout.path,
    );
  const describe = (checkout: (typeof checkouts)[number]) =>
    checkout.checkout.kind === "local"
      ? `The project's main checkout, on branch ${checkout.branch}.`
      : `The worktree on branch ${checkout.branch}.`;

  const state = {
    checkouts: Object.fromEntries(
      checkouts.map((checkout) => [
        checkout.label,
        {
          branch: checkout.branch,
          agents: inCheckout(checkout.checkout).map((agent) => ({
            id: labelOf.get(agent.threadId),
            title: agent.title,
            minutes_since_active: agent.minutesSinceActive,
            recent_user_messages: agent.recentUserMessages,
            last_agent_reply: agent.lastAgentReply,
          })),
        },
      ]),
    ),
    new_message: limitTitleMessage(input.message, NEW_MESSAGE_CHARS),
  };
  const questions = {
    where: {
      type: "choice",
      instructions:
        "The user sent this message to the project's manager. The work it asks for must happen in the right checkout: the main checkout, an existing worktree whose branch holds related work, or a fresh worktree for unrelated new work. Which checkout should the message's work happen in?",
      criteria: {
        ...Object.fromEntries(checkouts.map((checkout) => [checkout.label, describe(checkout)])),
        [NEW_WORKTREE]:
          "A fresh worktree, for new work unrelated to what every existing checkout holds.",
      },
    },
    target: {
      type: "choice",
      instructions:
        "The manager forwards the message to the coding agent already working on what it is about, or starts a new agent. Which agent should receive it?",
      criteria: {
        ...Object.fromEntries(
          [...agentLabels].map(([label, agent]) => [
            label,
            `Continues the work of the agent titled "${agent.title}".`,
          ]),
        ),
        [NEW_AGENT]: "Starts a task none of the listed agents is working on.",
      },
    },
  };
  const checkoutByLabel = new Map<string, ManagerCheckout>([
    ...checkouts.map((checkout) => [checkout.label, checkout.checkout] as const),
    [NEW_WORKTREE, { kind: "new-worktree" }],
  ]);
  return { state, questions, checkoutByLabel, agentLabels };
}

const byProbability = <T extends { readonly probability: number }>(items: ReadonlyArray<T>) =>
  items.toSorted((a, b) => b.probability - a.probability);

/** Jev's answers as the client's route, dropping labels it made up. */
export function readManagerRoute(
  answers: (typeof DecisionsResponse.Type)["answers"],
  request: Pick<ReturnType<typeof buildManagerRequest>, "checkoutByLabel" | "agentLabels">,
): ManagerRoute {
  const probability = (map: Record<string, number>, label: string) => map[label] ?? 0;
  return {
    checkouts: byProbability(
      [...request.checkoutByLabel].map(([label, checkout]) => ({
        checkout,
        probability: probability(answers.where.probabilities, label),
      })),
    ),
    agents: byProbability(
      [...request.agentLabels].map(([label, agent]) => ({
        threadId: agent.threadId,
        probability: probability(answers.target.probabilities, label),
      })),
    ),
    newAgentProbability: probability(answers.target.probabilities, NEW_AGENT),
  };
}

export class ManagerRouter extends Context.Service<
  ManagerRouter,
  {
    readonly route: (input: ManagerRouteInput) => Effect.Effect<ManagerRoute, ManagerRouteError>;
  }
>()("t3/manager/ManagerRouter") {}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const client = yield* HttpClient.HttpClient;

  const readAgent = (threadId: ThreadId, now: number) =>
    threads.getThreadRecords(threadId, ["messages"]).pipe(
      Effect.map(({ thread, messages }): ManagerAgent => {
        const said = messages.filter(
          (message) => !message.streaming && !isNativeMaintenanceCommand(message),
        );
        const lastReply = said.findLast((message) => message.role === "assistant");
        return {
          threadId,
          title: thread.title,
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          minutesSinceActive: Math.max(
            0,
            Math.round((now - DateTime.toEpochMillis(thread.updatedAt)) / 60_000),
          ),
          recentUserMessages: said
            .filter((message) => message.role === "user")
            .slice(-RECENT_USER_MESSAGES)
            .map((message) => limitTitleMessage(message.text, USER_MESSAGE_CHARS)),
          lastAgentReply:
            lastReply === undefined ? null : limitTitleMessage(lastReply.text, AGENT_REPLY_CHARS),
        };
      }),
      // A thread archived or deleted since the client listed it just drops out.
      Effect.option,
    );

  const route = Effect.fn("ManagerRouter.route")(function* (input: ManagerRouteInput) {
    const { voice } = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => failed("Could not read the settings.")),
    );
    const apiKey = ServerSettings.resolveOpenRouterApiKey(voice);
    if (apiKey === "") {
      return yield* new ManagerRouteError({
        reason: "missingKey",
        detail: "Add an OpenRouter API key so the manager can route messages.",
      });
    }
    const now = yield* Clock.currentTimeMillis;
    const agents = (yield* Effect.forEach(input.threadIds, (threadId) => readAgent(threadId, now), {
      concurrency: 4,
    })).flatMap((agent) => (Option.isSome(agent) ? [agent.value] : []));
    const request = buildManagerRequest(agents, input);

    const response = yield* client
      .execute(
        HttpClientRequest.post(DECISIONS_API).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${apiKey}`),
          HttpClientRequest.bodyJsonUnsafe({
            model: JEV_MODEL,
            state: request.state,
            questions: request.questions,
          }),
        ),
      )
      .pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError(() => failed("Could not reach OpenRouter.")),
      );
    const body = yield* response.json.pipe(Effect.orElseSucceed((): unknown => null));
    if (response.status === 401 || response.status === 403) {
      return yield* new ManagerRouteError({
        reason: "rejectedKey",
        detail: "OpenRouter rejected the API key.",
      });
    }
    if (response.status >= 400) return yield* failed(`OpenRouter answered ${response.status}.`);
    const decisions = decodeDecisions(body);
    if (Option.isNone(decisions)) return yield* failed("OpenRouter sent no decision.");
    return readManagerRoute(decisions.value.answers, request);
  });

  return ManagerRouter.of({ route });
});

export const layer = Layer.effect(ManagerRouter, make);

import { ProviderInstanceId, RunId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveHandoffEndpoints,
  resolveModelSwitchChange,
  type HandoffTimelineRun,
} from "./handoff.ts";

const from = ProviderInstanceId.make("codex_personal");
const to = ProviderInstanceId.make("claudeAgent");
const item = {
  runId: RunId.make("target"),
  fromProviderInstanceIds: [from],
  toProviderInstanceId: to,
};
const run = (
  id: string,
  ordinal: number,
  instanceId: ProviderInstanceId,
  model: string,
): HandoffTimelineRun => ({
  id: RunId.make(id),
  ordinal,
  providerInstanceId: instanceId,
  modelSelection: { instanceId, model },
});

describe("handoff endpoints shared by web and mobile", () => {
  it("preserves stamped models including several models from the same provider", () => {
    const fromModelSelections = [
      { instanceId: from, model: "source-a" },
      { instanceId: from, model: "source-b" },
    ];
    expect(
      resolveHandoffEndpoints({ ...item, fromModelSelections, toModel: "destination" }, [
        run("target", 2, to, "later-model"),
      ]),
    ).toEqual({
      from: fromModelSelections,
      to: { instanceId: to, model: "destination" },
    });
  });

  it("recovers legacy models from the handoff run and latest earlier source run", () => {
    const runs = [
      run("later", 4, from, "wrong-later-model"),
      run("old", 1, from, "old-model"),
      run("target", 3, to, "destination"),
      run("source", 2, from, "source-model"),
    ];
    expect(resolveHandoffEndpoints(item, runs)).toEqual({
      from: [{ instanceId: from, model: "source-model" }],
      to: { instanceId: to, model: "destination" },
    });
  });

  it("retains provider identities when historical runs are not loaded", () => {
    expect(resolveHandoffEndpoints(item, [])).toEqual({
      from: [{ instanceId: from, model: undefined }],
      to: { instanceId: to, model: undefined },
    });
  });

  it("does not borrow a target model from another provider", () => {
    expect(
      resolveHandoffEndpoints(item, [run("target", 2, from, "wrong-model")]).to.model,
    ).toBeUndefined();
  });
});

describe("model switch change", () => {
  const selection = (model: string, options?: Record<string, string>) => ({
    instanceId: from,
    model,
    ...(options === undefined
      ? {}
      : { options: Object.entries(options).map(([id, value]) => ({ id, value })) }),
  });
  const providers = [
    {
      instanceId: from,
      models: ["gpt", "mini"].map((slug) => ({
        slug,
        capabilities: {
          optionDescriptors: [
            { id: "serviceTier", type: "select", options: [{ id: "fast", label: "Fast" }] },
            {
              id: "reasoningEffort",
              type: "select",
              options: [
                { id: "medium", label: "Medium", isDefault: true },
                { id: "high", label: "High" },
              ],
            },
          ],
        },
      })),
    },
  ] as unknown as ServerProvider[];

  it("shows only what changed, reading an unset effort as the default", () => {
    expect(
      resolveModelSwitchChange(
        { from: selection("gpt"), to: selection("gpt", { reasoningEffort: "high" }) },
        providers,
      ),
    ).toEqual({ modelChanged: false, effort: { from: "Medium", to: "High" } });
    expect(
      resolveModelSwitchChange({ from: selection("gpt"), to: selection("mini") }, providers),
    ).toEqual({ modelChanged: true, effort: null });
  });

  it("ignores changes the user cannot see", () => {
    expect(
      resolveModelSwitchChange(
        { from: selection("gpt"), to: selection("gpt", { reasoningEffort: "medium" }) },
        providers,
      ),
    ).toBeNull();
    expect(
      resolveModelSwitchChange(
        { from: selection("gpt"), to: selection("gpt", { serviceTier: "fast" }) },
        providers,
      ),
    ).toBeNull();
  });

  it("falls back to stated efforts without a catalog", () => {
    expect(
      resolveModelSwitchChange(
        {
          from: selection("gpt", { reasoningEffort: "low" }),
          to: selection("gpt", { reasoningEffort: "high" }),
        },
        [],
      ),
    ).toEqual({ modelChanged: false, effort: { from: "low", to: "high" } });
    expect(
      resolveModelSwitchChange(
        { from: selection("gpt"), to: selection("gpt", { reasoningEffort: "high" }) },
        [],
      ),
    ).toBeNull();
  });
});

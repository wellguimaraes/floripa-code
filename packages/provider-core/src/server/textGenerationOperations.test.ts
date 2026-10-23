import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { fromRunner, type Runner } from "./textGenerationOperations.ts";

const driftInput = {
  cwd: "/repo",
  title: "Fix flaky login test",
  earlierMessages: ["The login test fails on CI about half the time"],
  latestMessage: "Now add dark mode to the settings page",
  modelSelection: { instanceId: ProviderInstanceId.make("cursor"), model: "auto" },
};

/** A provider whose model always answers with `reply`. */
const answering = (reply: { movedOn: boolean; title: string }) => {
  const prompts: Array<string> = [];
  const run = ((request) => {
    prompts.push(request.prompt);
    return Effect.succeed(reply);
  }) as Runner;
  return { generation: fromRunner("Test", run), prompts };
};

describe("detectThreadTitleDrift", () => {
  it.effect("returns the new task's title when the thread moved on", () =>
    Effect.gen(function* () {
      const { generation, prompts } = answering({ movedOn: true, title: '"Settings Dark Mode"' });
      assert.deepEqual(yield* generation.detectThreadTitleDrift(driftInput), {
        title: "Settings Dark Mode",
      });
      assert.include(prompts[0], 'Thread title: "Fix flaky login test"');
      assert.include(prompts[0], "Now add dark mode to the settings page");
    }),
  );

  it.effect("keeps the title when the thread continues or the move has no usable title", () =>
    Effect.gen(function* () {
      for (const reply of [
        { movedOn: false, title: "Ignored Title" },
        { movedOn: true, title: "   " },
      ]) {
        const { generation } = answering(reply);
        assert.deepEqual(yield* generation.detectThreadTitleDrift(driftInput), { title: null });
      }
    }),
  );
});

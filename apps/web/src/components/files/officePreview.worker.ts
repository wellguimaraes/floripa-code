import { prepareOffice } from "./officeArchive";
import type { OfficeWorkerRequest, OfficeWorkerResult } from "./officePreviewProtocol";

function reply(result: OfficeWorkerResult) {
  self.postMessage(result, { transfer: "bytes" in result ? [result.bytes] : [] });
}

async function handle(input: OfficeWorkerRequest) {
  reply({ type: input.kind, ...(await prepareOffice(input.bytes, input.kind)) });
}

self.addEventListener("message", (event: MessageEvent<OfficeWorkerRequest>) => {
  void handle(event.data).catch((cause: unknown) =>
    reply({
      type: "error",
      message: cause instanceof Error ? cause.message : "Could not parse this file.",
    }),
  );
});

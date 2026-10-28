import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  seedUserInputDraftAnswers,
  type ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import type { RuntimeRequestId, ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "../../pendingUserInput";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";

type Answers = Record<string, PendingUserInputDraftAnswer>;

const NO_ANSWERS: Answers = {};

/**
 * An open question from the agent, answered from a world bubble: options are picked in the
 * question panel, and the bubble's text box gives an answer of your own. Answers are kept per
 * question until the whole request is sent; a newer request starts over.
 */
export function useBubbleQuestion(
  threadRef: ScopedThreadRef,
  request: ThreadPendingUserInput | null,
  onError: (message: string | null) => void,
) {
  const [draft, setDraft] = useState<{
    readonly requestId: RuntimeRequestId;
    readonly answers: Answers;
    readonly questionIndex: number;
  } | null>(null);
  const [respondingId, setRespondingId] = useState<RuntimeRequestId | null>(null);
  const respondToUserInput = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const dismissUserInput = useOrchestrationCommand(threadEnvironment.dismissUserInput, {
    reportFailure: false,
  });

  const current = request !== null && draft?.requestId === request.requestId ? draft : null;
  // Questions that come with a suggested answer start with it filled in.
  const answers: Answers =
    request === null
      ? NO_ANSWERS
      : seedUserInputDraftAnswers(request.questions, current?.answers ?? NO_ANSWERS);
  const questionIndex = current?.questionIndex ?? 0;
  const progress =
    request === null
      ? null
      : derivePendingUserInputProgress(request.questions, answers, questionIndex);
  const responding = request !== null && respondingId === request.requestId;
  // Asked in a run that has ended without a way to reply: only the full chat can explain it.
  const answerable = request !== null && request.responseCapability !== "not_resumable";

  const run = async (
    requestId: RuntimeRequestId,
    command: () => Promise<AtomCommandResult<unknown, unknown>>,
    failure: string,
  ) => {
    setRespondingId(requestId);
    const result = await command();
    setRespondingId(null);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      onError(error instanceof Error && error.message !== "" ? error.message : failure);
    }
  };

  // Moves to the next question, or sends every answer from the last one.
  const advanceWith = (nextAnswers: Answers) => {
    if (request === null || !answerable || responding) return;
    const next = derivePendingUserInputProgress(request.questions, nextAnswers, questionIndex);
    if (!next.canAdvance) {
      setDraft({ requestId: request.requestId, answers: nextAnswers, questionIndex });
      return;
    }
    if (!next.isLastQuestion) {
      setDraft({
        requestId: request.requestId,
        answers: nextAnswers,
        questionIndex: next.questionIndex + 1,
      });
      return;
    }
    setDraft({ requestId: request.requestId, answers: nextAnswers, questionIndex });
    const resolved = buildPendingUserInputAnswers(request.questions, nextAnswers);
    if (resolved === null) return;
    void run(
      request.requestId,
      () =>
        respondToUserInput({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, requestId: request.requestId, answers: resolved },
        }),
      "Could not send the answer.",
    );
  };

  return {
    request,
    progress,
    answers,
    questionIndex,
    responding,
    answerable,
    /** Whether the text box can carry an answer to the question on screen. */
    takesText: progress?.activeQuestion?.allowCustomAnswer !== false,
    toggleOption: (questionId: string, optionValue: string) => {
      const question = request?.questions.find((entry) => entry.id === questionId);
      if (request === null || question === undefined) return;
      setDraft({
        requestId: request.requestId,
        answers: {
          ...answers,
          [questionId]: togglePendingUserInputOptionSelection(
            question,
            answers[questionId],
            optionValue,
          ),
        },
        questionIndex,
      });
    },
    advance: () => advanceWith(answers),
    /**
     * Answers the question on screen with what was typed, or with the options picked when
     * nothing was. True when the text was taken as the answer, so the box can be emptied.
     */
    answer: (typed: string): boolean => {
      const question = progress?.activeQuestion;
      if (question == null) return false;
      const usesText = question.allowCustomAnswer !== false && typed.trim() !== "";
      advanceWith(
        usesText
          ? {
              ...answers,
              [question.id]: setPendingUserInputCustomAnswer(answers[question.id], typed, question),
            }
          : answers,
      );
      return usesText;
    },
    dismiss: (requestId: RuntimeRequestId) =>
      void run(
        requestId,
        () =>
          dismissUserInput({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, requestId },
          }),
        "Could not dismiss the question.",
      ),
  };
}

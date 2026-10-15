import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  VOICE_AUDIO_MAX_BASE64_LENGTH,
  type EnvironmentId,
  type VoiceAudioFormat,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { isElectron } from "../../env";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  addEventListener(
    type: "result",
    listener: (event: {
      results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
    }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: { error: string }) => void): void;
  addEventListener(type: "end", listener: () => void): void;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

/**
 * The browser's own speech service. Electron ships the API without Google's
 * backend behind it, so there it only ever fails with a network error.
 */
function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (isElectron) return null;
  const speech = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return speech.SpeechRecognition ?? speech.webkitSpeechRecognition ?? null;
}

function recorderSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && navigator.mediaDevices?.getUserMedia != null;
}

/** Whether this device can capture speech at all, through the server or the browser. */
export function voiceInputSupported(): boolean {
  return typeof window !== "undefined" && (recorderSupported() || speechRecognition() !== null);
}

const SPEECH_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was denied.",
  "service-not-allowed": "Voice input isn't available here.",
  network: "Voice input isn't available here.",
  "no-speech": "Didn't hear anything.",
};

/** Recorder containers OpenRouter takes, best first. */
const RECORDER_FORMATS: ReadonlyArray<readonly [mimeType: string, format: VoiceAudioFormat]> = [
  ["audio/webm;codecs=opus", "webm"],
  ["audio/ogg;codecs=opus", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/webm", "webm"],
];

// A pause this long after speech ends the take. Long enough to stop and think mid-sentence.
const SILENCE_MS = 3_500;
// Nothing said this long after the mic opens: give up.
const NO_SPEECH_MS = 8_000;
// Well under the server's size cap at the bitrate below.
const MAX_RECORDING_MS = 2 * 60_000;
// Room level is around 0.005; speech sits well above 0.02.
const SPEECH_LEVEL = 0.02;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

export type VoiceInputPhase = "idle" | "listening" | "transcribing";
/** Why voice input is asking for an OpenRouter key. */
export type VoiceKeyPrompt = "missing" | "rejected";

/**
 * Speech to text for one environment. With an OpenRouter key saved there, the
 * mic records and the server transcribes; without one, the browser's own
 * speech service is used where it works. A take ends on a pause or on `stop`;
 * a held take (push to talk) ignores pauses and ends only on `stop`.
 */
export function useVoiceInput(
  environmentId: EnvironmentId,
  handlers: {
    /** The words so far; the browser service reports them as they are heard. */
    readonly onText: (text: string) => void;
    /** The take is over with what was said, possibly nothing. */
    readonly onDone?: (text: string) => void;
    readonly onError: (message: string) => void;
  },
) {
  const hasKey = useEnvironmentSettings(
    environmentId,
    (settings) =>
      settings.voice.openRouterApiKey !== "" || settings.voice.openRouterApiKeyFromEnv === true,
  );
  const transcribe = useAtomCommand(serverEnvironment.transcribeVoice, { reportFailure: false });
  const [phase, setPhase] = useState<VoiceInputPhase>("idle");
  // Set when the environment needs an OpenRouter key before the mic can be used.
  const [keyPrompt, setKeyPrompt] = useState<VoiceKeyPrompt | null>(null);
  // A take the server could not transcribe for want of a key, retried once one is saved.
  const unsent = useRef<{ readonly recording: Blob; readonly format: VoiceAudioFormat } | null>(
    null,
  );
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  // Ends the current take: `send` false throws away what was recorded.
  const finish = useRef<((send: boolean) => void) | null>(null);
  // While set, a pause does not end the take: it is held open until `stop`.
  const held = useRef(false);

  const startBrowser = (Recognition: new () => SpeechRecognitionLike) => {
    const listener = new Recognition();
    listener.lang = navigator.language;
    listener.interimResults = true;
    // A held take keeps listening through pauses; once let go, the next pause ends it.
    listener.continuous = held.current;
    let heard = "";
    let failed = false;
    // Set when the take is thrown away: nothing heard after that is reported.
    let dropped = false;
    listener.addEventListener("result", (event) => {
      if (dropped) return;
      heard = Array.from(event.results, (result) => result[0]?.transcript ?? "").join("");
      latest.current.onText(heard);
      const last = event.results[event.results.length - 1];
      if (listener.continuous && !held.current && last?.isFinal) listener.stop();
    });
    listener.addEventListener("error", (event) => {
      if (dropped) return;
      failed = true;
      latest.current.onError(SPEECH_ERRORS[event.error] ?? "Could not hear that.");
    });
    listener.addEventListener("end", () => {
      finish.current = null;
      setPhase("idle");
      if (!failed && !dropped) latest.current.onDone?.(heard);
    });
    finish.current = (send) => {
      if (send) {
        listener.stop();
        return;
      }
      dropped = true;
      listener.abort();
    };
    setPhase("listening");
    listener.start();
  };

  const startRecording = async () => {
    // Claimed before the mic prompt, so a second press cannot open two takes.
    let cancelled = false;
    finish.current = () => {
      cancelled = true;
    };
    setPhase("listening");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      finish.current = null;
      setPhase("idle");
      if (!cancelled) latest.current.onError("Microphone access was denied.");
      return;
    }
    if (cancelled) {
      for (const track of stream.getTracks()) track.stop();
      finish.current = null;
      setPhase("idle");
      return;
    }
    const [mimeType, format] = RECORDER_FORMATS.find(([type]) =>
      MediaRecorder.isTypeSupported(type),
    ) ?? ["", "webm"];
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 32_000,
    });
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));

    // Listen for the pause that ends a take.
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let spokeAt: number | null = null;
    const watch = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const now = performance.now();
      if (Math.sqrt(sum / samples.length) > SPEECH_LEVEL) spokeAt = now;
      if (
        now - startedAt > MAX_RECORDING_MS ||
        (!held.current &&
          (spokeAt === null ? now - startedAt > NO_SPEECH_MS : now - spokeAt > SILENCE_MS))
      ) {
        finish.current?.(true);
      }
    }, 100);

    let send = true;
    finish.current = (keep) => {
      send = keep;
      finish.current = null;
      window.clearInterval(watch);
      if (recorder.state !== "inactive") recorder.stop();
    };
    recorder.addEventListener("stop", () => {
      for (const track of stream.getTracks()) track.stop();
      void audio.close();
      if (!send) {
        setPhase("idle");
        return;
      }
      if (spokeAt === null) {
        setPhase("idle");
        latest.current.onError("Didn't hear anything.");
        return;
      }
      void sendRecording(new Blob(chunks, { type: recorder.mimeType }), format);
    });
    recorder.start();
  };

  const sendRecording = async (recording: Blob, format: VoiceAudioFormat) => {
    setPhase("transcribing");
    const audio = await blobToBase64(recording);
    if (audio.length > VOICE_AUDIO_MAX_BASE64_LENGTH) {
      setPhase("idle");
      latest.current.onError("That was too long to transcribe.");
      return;
    }
    const result = await transcribe({ environmentId, input: { audio, format } });
    setPhase("idle");
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      const reason =
        error !== null && typeof error === "object" && "reason" in error ? error.reason : null;
      if (reason === "missingKey" || reason === "rejectedKey") {
        unsent.current = { recording, format };
        setKeyPrompt(reason === "missingKey" ? "missing" : "rejected");
        return;
      }
      latest.current.onError(
        error instanceof Error && error.message !== ""
          ? error.message
          : "Could not transcribe that.",
      );
      return;
    }
    latest.current.onText(result.value.text);
    latest.current.onDone?.(result.value.text);
  };

  /** `hold` keeps the take open through pauses until `stop`: push to talk. */
  const start = (options?: { readonly hold?: boolean }) => {
    if (finish.current !== null) return;
    held.current = options?.hold === true;
    if (hasKey && recorderSupported()) {
      void startRecording();
      return;
    }
    const Recognition = speechRecognition();
    if (Recognition !== null) startBrowser(Recognition);
    else if (recorderSupported()) setKeyPrompt("missing");
    else latest.current.onError("Voice input isn't available here.");
  };

  // Leaving drops whatever was being recorded.
  useEffect(() => () => finish.current?.(false), []);

  return {
    phase,
    start,
    /** End the take now and use what was said. */
    stop: () => finish.current?.(true),
    /** End the take now and throw away what was said. */
    cancel: () => finish.current?.(false),
    /** A held take goes back to ending on the next pause. */
    endOnPause: () => {
      held.current = false;
    },
    keyPrompt,
    /** The prompt was closed without a key: the unsent take is dropped. */
    dismissKeyPrompt: () => {
      unsent.current = null;
      setKeyPrompt(null);
    },
    /** A key was saved: transcribe the take that was waiting, or start listening. */
    keySaved: () => {
      setKeyPrompt(null);
      const waiting = unsent.current;
      unsent.current = null;
      if (waiting !== null) void sendRecording(waiting.recording, waiting.format);
      else if (finish.current === null) {
        held.current = false;
        void startRecording();
      }
    },
  };
}

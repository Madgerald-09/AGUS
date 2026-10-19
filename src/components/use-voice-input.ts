"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
type SpeechRecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
};
type SpeechRecognitionErrorEvent = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
// Shared with the retired dashboard; capture only ever edits the caller's draft.
export function useVoiceInput(options: {
  text: string;
  onText: (text: string) => void;
  aiEnabled: boolean;
  disabled: boolean;
  focus: () => void;
}) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const [voiceStatus, setVoiceStatus] = useState("");
  const [listening, setListening] = useState(false);
  const [requestingVoice, setRequestingVoice] = useState(false);
  const [transcribingVoice, setTranscribingVoice] = useState(false);
  const [audioLevel, setAudioLevel] = useState<number | null>(null);
  // Completion/error guidance is transient; active capture retains its status.
  useEffect(() => {
    if (!voiceStatus || listening || requestingVoice || transcribingVoice)
      return;
    const timer = setTimeout(() => setVoiceStatus(""), 5000);
    return () => clearTimeout(timer);
  }, [voiceStatus, listening, requestingVoice, transcribingVoice]);
  const speechRecognition = useRef<SpeechRecognitionLike | null>(null);
  const voiceRecorder = useRef<MediaRecorder | null>(null);
  const voiceStream = useRef<MediaStream | null>(null);
  const voiceAudioContext = useRef<AudioContext | null>(null);
  const voiceChunks = useRef<Blob[]>([]);
  const voiceMonitor = useRef<number | null>(null);
  const voiceStartedAt = useRef(0);
  const lastVoiceActivity = useRef(0);
  const heardVoice = useRef(false);
  const voiceSession = useRef(0);
  const voiceEpoch = useRef(0);
  const transcriptionRequest = useRef<AbortController | null>(null);
  const captureTimeout = useRef<number | null>(null);
  const recordingText = useRef("");
  function releaseVoiceCapture() {
    if (captureTimeout.current !== null)
      window.clearTimeout(captureTimeout.current);
    captureTimeout.current = null;
    if (voiceMonitor.current !== null) {
      window.clearInterval(voiceMonitor.current);
      voiceMonitor.current = null;
    }
    voiceStream.current?.getTracks().forEach((track) => track.stop());
    voiceStream.current = null;
    setAudioLevel(null);
    const context = voiceAudioContext.current;
    voiceAudioContext.current = null;
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
  }
  function appendTranscript(transcript: string) {
    const current = recordingText.current;
    const separator = current && !/\s$/.test(current) ? " " : "";
    const combined = `${current}${separator}${transcript}`;
    latest.current.onText(combined.slice(0, 4000));
    latest.current.focus();
  }
  async function transcribeVoice(recording: Blob, epoch: number) {
    if (epoch !== voiceEpoch.current) return;
    const controller = new AbortController();
    transcriptionRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45000);
    setTranscribingVoice(true);
    setVoiceStatus("Transcribing your recording…");
    try {
      const form = new FormData();
      form.append("audio", recording, "voice-recording");
      const response = await fetch("/api/voice", {
        method: "POST",
        body: form,
        cache: "no-store",
        signal: controller.signal,
      });
      const result: unknown = await response.json().catch(() => null);
      if (epoch !== voiceEpoch.current) return;
      if (
        !response.ok ||
        !result ||
        typeof result !== "object" ||
        !("transcript" in result) ||
        typeof result.transcript !== "string"
      )
        throw new Error(
          result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "Voice transcription failed. Try again or type your request.",
        );
      const transcript = result.transcript.trim();
      if (!transcript)
        throw new Error(
          "No clear speech was detected. Try recording again in a quieter place.",
        );
      appendTranscript(transcript);
      setVoiceStatus("Transcript ready. Review it before sending.");
    } catch (e) {
      if (epoch !== voiceEpoch.current) return;
      setVoiceStatus(
        e instanceof Error
          ? e.message
          : "Voice transcription failed. Try again or type your request.",
      );
    } finally {
      clearTimeout(timeout);
      if (transcriptionRequest.current === controller)
        transcriptionRequest.current = null;
      if (epoch === voiceEpoch.current) setTranscribingVoice(false);
    }
  }
  // Discard callbacks when leaving an authenticated payment workspace. A normal
  // Stop still accepts the final transcript for explicit review before Send.
  const discardVoiceCapture = useCallback(() => {
    voiceEpoch.current += 1;
    transcriptionRequest.current?.abort();
    transcriptionRequest.current = null;
    voiceSession.current += 1;
    const recognition = speechRecognition.current;
    speechRecognition.current = null;
    if (recognition) {
      recognition.onstart = recognition.onend = null;
      recognition.onresult = recognition.onerror = null;
      try {
        recognition.stop();
      } catch {
        /* Already ended or not started. */
      }
    }
    const recorder = voiceRecorder.current;
    voiceRecorder.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
      try {
        recorder.stop();
      } catch {
        /* The browser already released it. */
      }
    }
    releaseVoiceCapture();
    setListening(false);
    setRequestingVoice(false);
    setTranscribingVoice(false);
    setVoiceStatus("");
  }, []);
  function stopVoiceCapture() {
    voiceSession.current += 1;
    const recognition = speechRecognition.current;
    if (recognition) {
      setVoiceStatus("Finishing your transcript…");
      try {
        recognition.stop();
      } catch {
        discardVoiceCapture();
        setVoiceStatus(
          "Recording stopped. Your original message is preserved.",
        );
      }
      return;
    }
    const recorder = voiceRecorder.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        discardVoiceCapture();
        setVoiceStatus(
          "Recording stopped. Your original message is preserved.",
        );
      }
    }
  }
  async function toggleVoiceInput() {
    if (latest.current.disabled) return;
    if (listening) {
      stopVoiceCapture();
      return;
    }
    // API refs close the interval before React commits a disabled button.
    if (
      speechRecognition.current ||
      voiceRecorder.current ||
      transcriptionRequest.current ||
      requestingVoice ||
      transcribingVoice
    )
      return;
    if (!window.isSecureContext) {
      setVoiceStatus(
        "Voice recording requires HTTPS or localhost. Open the secure app URL and try again.",
      );
      return;
    }
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    const epoch = ++voiceEpoch.current;
    recordingText.current = latest.current.text;
    setAudioLevel(null);
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        speechRecognition.current = recognition;
        setVoiceStatus("Starting voice input…");
        setRequestingVoice(true);
        recognition.lang = navigator.language || "en-US";
        recognition.continuous = true;
        recognition.interimResults = true;
        let recognitionFailed = false;
        let hasTranscript = false;
        let finalTranscript = "";
        recognition.onstart = () => {
          if (
            epoch !== voiceEpoch.current ||
            speechRecognition.current !== recognition
          )
            return;
          setRequestingVoice(false);
          setListening(true);
          setVoiceStatus(
            "Listening… your words will appear in the message as you speak.",
          );
        };
        recognition.onresult = (event) => {
          if (
            epoch !== voiceEpoch.current ||
            speechRecognition.current !== recognition ||
            recognitionFailed ||
            latest.current.disabled
          )
            return;
          const transcript = Array.from(event.results)
            .map((result) => result[0].transcript.trim())
            .filter(Boolean)
            .join(" ");
          if (!transcript) return;
          hasTranscript = true;
          finalTranscript = transcript;
        };
        recognition.onerror = (event) => {
          if (
            epoch !== voiceEpoch.current ||
            speechRecognition.current !== recognition
          )
            return;
          recognitionFailed = true;
          speechRecognition.current = null;
          try {
            recognition.stop();
          } catch {
            /* Browser already stopped. */
          }
          setListening(false);
          setRequestingVoice(false);
          const messages: Record<string, string> = {
            "not-allowed":
              "Microphone access was denied. Allow microphone access and try again.",
            "service-not-allowed":
              "The browser speech service is unavailable. Try Chrome, Edge or Safari.",
            "audio-capture":
              "No microphone was found. Connect one or type your request.",
            "no-speech":
              "No speech was detected. Try again or type your request.",
            network:
              "The browser speech service could not be reached. Check your connection and try again.",
            aborted: "Voice input was stopped.",
          };
          setVoiceStatus(
            messages[event.error] ??
              "Voice input failed. Try again or type your request.",
          );
        };
        recognition.onend = () => {
          if (
            epoch !== voiceEpoch.current ||
            speechRecognition.current !== recognition
          )
            return;
          speechRecognition.current = null;
          if (!recognitionFailed && finalTranscript)
            appendTranscript(finalTranscript);
          setListening(false);
          setRequestingVoice(false);
          if (!recognitionFailed)
            setVoiceStatus(
              hasTranscript
                ? "Transcript ready in the message. Review it before sending."
                : "No speech was detected. Try again or type your request.",
            );
        };
        recognition.start();
        return;
      } catch {
        speechRecognition.current = null;
        setListening(false);
        setRequestingVoice(false);
        setVoiceStatus(
          "Could not start voice input. Check microphone permission and try again.",
        );
        return;
      }
    }
    if (!latest.current.aiEnabled) {
      setVoiceStatus(
        "Live voice input is not supported in this browser. Try Chrome, Edge or Safari, or type your request.",
      );
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceStatus(
        "Voice recording is not supported in this browser. Try a recent version of Chrome, Edge, Firefox, or Safari.",
      );
      return;
    }
    setVoiceStatus("Requesting microphone access…");
    setRequestingVoice(true);
    const session = ++voiceSession.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (
        session !== voiceSession.current ||
        epoch !== voiceEpoch.current ||
        latest.current.disabled
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      voiceStream.current = stream;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      voiceRecorder.current = recorder;
      voiceChunks.current = [];
      voiceStartedAt.current = Date.now();
      lastVoiceActivity.current = voiceStartedAt.current;
      heardVoice.current = false;
      let recordingFailed = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) voiceChunks.current.push(event.data);
      };
      recorder.onerror = () => {
        if (epoch !== voiceEpoch.current) return;
        recordingFailed = true;
        voiceRecorder.current = null;
        releaseVoiceCapture();
        setListening(false);
        setVoiceStatus(
          "The recording stopped unexpectedly. Try again or type your request.",
        );
      };
      recorder.onstop = () => {
        if (epoch !== voiceEpoch.current) return;
        voiceRecorder.current = null;
        releaseVoiceCapture();
        setListening(false);
        const chunks = voiceChunks.current;
        voiceChunks.current = [];
        if (recordingFailed || epoch !== voiceEpoch.current) return;
        const recording = new Blob(chunks, {
          type: recorder.mimeType || chunks[0]?.type || "audio/webm",
        });
        if (!recording.size) {
          setVoiceStatus(
            "No audio was captured. Check your microphone and try again.",
          );
          return;
        }
        void transcribeVoice(recording, epoch);
      };
      recorder.start(250);
      setListening(true);
      setRequestingVoice(false);
      captureTimeout.current = window.setTimeout(stopVoiceCapture, 60000);
      setVoiceStatus("Listening. Speak now; recording stops after a pause.");
      // Visualize only the stream already used by MediaRecorder. Browser speech
      // recognition exposes no stream and uses the honest status pulse instead.
      // Audio monitoring is optional: its failure never stops transcription.
      let monitoringContext: AudioContext | undefined;
      try {
        if (typeof AudioContext === "undefined") throw new Error("No analyser");
        const context = new AudioContext();
        monitoringContext = context;
        voiceAudioContext.current = context;
        await context.resume();
        if (
          epoch !== voiceEpoch.current ||
          voiceRecorder.current !== recorder ||
          recorder.state === "inactive"
        ) {
          if (context.state !== "closed") await context.close();
          return;
        }
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        voiceMonitor.current = window.setInterval(() => {
          if (
            epoch !== voiceEpoch.current ||
            voiceRecorder.current !== recorder
          )
            return;
          try {
            analyser.getByteTimeDomainData(samples);
          } catch {
            if (voiceMonitor.current !== null)
              window.clearInterval(voiceMonitor.current);
            voiceMonitor.current = null;
            setAudioLevel(null);
            if (context.state !== "closed")
              void context.close().catch(() => {});
            if (voiceAudioContext.current === context)
              voiceAudioContext.current = null;
            return;
          }
          let energy = 0;
          for (const sample of samples) {
            const amplitude = (sample - 128) / 128;
            energy += amplitude * amplitude;
          }
          const level = Math.sqrt(energy / samples.length);
          setAudioLevel(Math.min(1, level * 5));
          if (level > 0.035) {
            heardVoice.current = true;
            lastVoiceActivity.current = Date.now();
          } else if (
            heardVoice.current &&
            Date.now() - lastVoiceActivity.current > 1400
          ) {
            stopVoiceCapture();
          }
        }, 100);
      } catch {
        const context = monitoringContext;
        if (voiceAudioContext.current === context)
          voiceAudioContext.current = null;
        if (context && context.state !== "closed")
          void context.close().catch(() => {});
        if (epoch === voiceEpoch.current) setAudioLevel(null);
      }
    } catch (e) {
      if (epoch !== voiceEpoch.current) return;
      voiceRecorder.current = null;
      releaseVoiceCapture();
      setListening(false);
      const name = e instanceof Error ? e.name : "";
      setVoiceStatus(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access was denied. Allow microphone access or type your request."
          : name === "NotFoundError"
            ? "No microphone was found. Connect one or type your request."
            : "Could not start voice recording. Check your microphone and try again.",
      );
    } finally {
      if (epoch === voiceEpoch.current) setRequestingVoice(false);
    }
  }
  useEffect(() => {
    const leave = () => discardVoiceCapture();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      discardVoiceCapture();
    };
  }, [discardVoiceCapture]);
  return {
    setVoiceStatus,
    setRequestingVoice,
    voiceStatus,
    audioLevel,
    listening,
    requestingVoice,
    transcribingVoice,
    toggleVoiceInput,
    stopVoiceCapture,
    discardVoiceCapture,
  };
}

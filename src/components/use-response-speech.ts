"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useResponseSpeech() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const active = useRef<string | null>(null);
  const generation = useRef(0);
  const stop = useCallback(() => {
    ++generation.current;
    active.current = null;
    window.speechSynthesis?.cancel();
    setPlaying(null);
  }, []);
  const speak = (id: string, text: string) => {
    const wasPlaying = active.current === id;
    stop();
    setError("");
    if (wasPlaying) return;
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setError("Spoken replies are unavailable in this browser.");
      return;
    }
    const token = generation.current;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-NG";
    utterance.onend = () => {
      if (token === generation.current) stop();
    };
    utterance.onerror = () => {
      if (token !== generation.current) return;
      stop();
      setError("This reply could not be played. Its text is still available.");
    };
    active.current = id;
    setPlaying(id);
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      stop();
      setError("This reply could not be played. Its text is still available.");
    }
  };
  useEffect(() => {
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [stop]);
  return { playing, error, speak, stop };
}

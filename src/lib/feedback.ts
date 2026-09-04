"use client";

// Haptics and understated sounds. Sounds are synthesized with WebAudio so the
// app ships no audio assets and nothing resembles a slot machine.

export type SoundName = "deal" | "flop" | "turn" | "river" | "level" | "break" | "warning" | "fold" | "tick";

let ctx: AudioContext | null = null;
let unlocked = false;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** Call from a user gesture once so iOS allows later playback. */
export function unlockAudio(): void {
  const c = audio();
  if (!c || unlocked) return;
  void c.resume().then(() => {
    unlocked = true;
  });
}

function tone(freq: number, duration: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number } = {}): void {
  const c = audio();
  if (!c || c.state !== "running") return;
  const osc = c.createOscillator();
  const g = c.createGain();
  const start = c.currentTime + (opts.delay ?? 0);
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, start);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, start + duration);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.08, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function playSound(name: SoundName): void {
  switch (name) {
    case "deal":
      tone(660, 0.08, { type: "triangle", gain: 0.05 });
      tone(880, 0.1, { type: "triangle", gain: 0.04, delay: 0.09 });
      break;
    case "flop":
      tone(520, 0.09, { type: "triangle", gain: 0.05 });
      tone(520, 0.09, { type: "triangle", gain: 0.05, delay: 0.1 });
      tone(520, 0.12, { type: "triangle", gain: 0.05, delay: 0.2 });
      break;
    case "turn":
    case "river":
      tone(560, 0.12, { type: "triangle", gain: 0.05 });
      break;
    case "level":
      tone(440, 0.18, { gain: 0.07 });
      tone(660, 0.22, { gain: 0.07, delay: 0.2 });
      break;
    case "break":
      tone(392, 0.25, { gain: 0.06 });
      tone(330, 0.3, { gain: 0.06, delay: 0.25 });
      break;
    case "warning":
      tone(740, 0.12, { type: "square", gain: 0.03 });
      tone(740, 0.12, { type: "square", gain: 0.03, delay: 0.18 });
      break;
    case "fold":
      tone(300, 0.1, { type: "triangle", gain: 0.04, slide: 200 });
      break;
    case "tick":
      tone(1000, 0.03, { type: "square", gain: 0.015 });
      break;
  }
}

export type HapticPattern = "tap" | "deal" | "peek" | "level" | "warning" | "fold";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 10,
  deal: [30, 40, 30],
  peek: 8,
  level: [60, 60, 60],
  warning: [40, 80, 40],
  fold: 25,
};

export function haptic(pattern: HapticPattern): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Unsupported or blocked. Silent fallback.
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

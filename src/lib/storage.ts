"use client";

import { useSyncExternalStore } from "react";

// Small, non-secret per-device preferences. The device secret itself lives in
// an httpOnly cookie and is never stored here.

const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function notify(): void {
  for (const l of listeners) l();
}

/**
 * Hydration-safe read of a stored primitive: the server value renders first,
 * the stored value takes over on the client without a state-setting effect.
 */
export function useStored<T extends string | number | boolean | null>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribe, read, () => serverValue);
}

/** True once running in the browser (false during SSR and hydration). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

const KEYS = {
  currentGame: "bp.currentGame",
  cardMode: "bp.cardMode",
  orientation: "bp.orientation",
  lockFaceUp: "bp.lockFaceUp",
  installDismissed: "bp.installDismissed",
  displayName: "bp.displayName",
  tabletopMode: "bp.tabletopMode",
} as const;

export type CardMode = "peel" | "flip";
export type Orientation = "portrait" | "landscape";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); preferences simply do not persist.
  }
  notify();
}

export const prefs = {
  getCurrentGame: (): string | null => read(KEYS.currentGame),
  setCurrentGame: (id: string | null) => write(KEYS.currentGame, id),
  getCardMode: (): CardMode => (read(KEYS.cardMode) === "flip" ? "flip" : "peel"),
  setCardMode: (m: CardMode) => write(KEYS.cardMode, m),
  getOrientation: (): Orientation => (read(KEYS.orientation) === "landscape" ? "landscape" : "portrait"),
  setOrientation: (o: Orientation) => write(KEYS.orientation, o),
  getLockFaceUp: (): boolean => read(KEYS.lockFaceUp) === "1",
  setLockFaceUp: (v: boolean) => write(KEYS.lockFaceUp, v ? "1" : "0"),
  getInstallDismissed: (): boolean => read(KEYS.installDismissed) === "1",
  setInstallDismissed: (v: boolean) => write(KEYS.installDismissed, v ? "1" : "0"),
  getDisplayName: (): string => read(KEYS.displayName) ?? "",
  setDisplayName: (n: string) => write(KEYS.displayName, n),
  getTabletopMode: (): boolean => read(KEYS.tabletopMode) === "1",
  setTabletopMode: (v: boolean) => write(KEYS.tabletopMode, v ? "1" : "0"),
};

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

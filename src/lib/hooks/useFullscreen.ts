"use client";

import { useCallback, useSyncExternalStore } from "react";

// Browser Fullscreen API for the dealer device (laptop, TV, tablet). Hides the
// browser chrome so the table fills the screen. Installed PWAs are already
// chrome-less, and iOS Safari lacks the API, so the button hides itself there.

function subscribe(cb: () => void): () => void {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
}

export function useFullscreen(): { supported: boolean; active: boolean; toggle: () => Promise<void> } {
  const supported = useSyncExternalStore(
    () => () => undefined,
    () => typeof document !== "undefined" && !!document.fullscreenEnabled,
    () => false,
  );
  const active = useSyncExternalStore(
    subscribe,
    () => !!document.fullscreenElement,
    () => false,
  );
  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // Denied or unsupported: nothing to do, the page still works.
    }
  }, []);
  return { supported, active, toggle };
}

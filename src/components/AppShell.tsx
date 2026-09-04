"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ensureDevice, type MyGame } from "@/lib/api";
import { isStandalone, useStored } from "@/lib/storage";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface ShellContextValue {
  deviceId: string | null;
  games: MyGame[];
  reloadGames: () => Promise<void>;
  installable: boolean;
  installed: boolean;
  promptInstall: () => Promise<boolean>;
}

const ShellContext = createContext<ShellContextValue>({
  deviceId: null,
  games: [],
  reloadGames: async () => undefined,
  installable: false,
  installed: false,
  promptInstall: async () => false,
});

export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [games, setGames] = useState<MyGame[]>([]);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installedNow, setInstalled] = useState(false);
  const standalone = useStored(isStandalone, false);
  const installed = installedNow || standalone;

  const reloadGames = async () => {
    try {
      const d = await ensureDevice();
      setDeviceId(d.deviceId);
      setGames(d.games);
    } catch {
      // Offline at boot: the game screens handle their own reconnect messaging.
    }
  };

  useEffect(() => {
    const kick = window.setTimeout(() => void reloadGames(), 0);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(kick);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      deviceId,
      games,
      reloadGames,
      installable: !!installEvent && !installed,
      installed,
      promptInstall: async () => {
        if (!installEvent) return false;
        await installEvent.prompt();
        const choice = await installEvent.userChoice;
        if (choice.outcome === "accepted") setInstallEvent(null);
        return choice.outcome === "accepted";
      },
    }),
    [deviceId, games, installEvent, installed],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

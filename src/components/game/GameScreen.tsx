"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/Logo";
import { DealerView } from "@/components/game/DealerView";
import { GameComplete } from "@/components/game/GameComplete";
import { LobbyView } from "@/components/game/LobbyView";
import { PlayerView } from "@/components/game/PlayerView";
import { Button, Spinner } from "@/components/ui";
import { friendlyMessage } from "@/lib/errors";
import { useGame } from "@/lib/hooks/useGame";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { prefs } from "@/lib/storage";

/** Routes a device to the right surface for its role and the game's phase. */
export function GameScreen({ id }: { id: string }) {
  const router = useRouter();
  const state = useGame(id);
  const [dealerChoice, setDealerMode] = useState(false);

  useEffect(() => {
    prefs.setCurrentGame(id);
  }, [id]);

  const snap = state.snapshot;
  useWakeLock(!!snap && snap.game.status === "active");
  // Dedicated dealers always see the dealer dashboard; player-hosts toggle.
  const dealerMode = snap?.me.role === "dealer" || dealerChoice;

  if (state.error && !snap) {
    const code = state.error.code;
    return (
      <main className="safe-top safe-bottom safe-x mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 text-center">
        <Wordmark />
        <p className="text-ivory-200">{friendlyMessage(state.error)}</p>
        {code === "NOT_IN_GAME" || code === "GAME_NOT_FOUND" ? (
          <Link href="/join">
            <Button>Join a table</Button>
          </Link>
        ) : (
          <Button variant="secondary" onClick={() => void state.refresh()}>
            Try again
          </Button>
        )}
        <button type="button" className="text-sm text-ivory-600 underline" onClick={() => router.push("/")}>
          Home
        </button>
      </main>
    );
  }

  if (!snap) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center">
        <Wordmark />
        <Spinner label="Reconnecting to table" />
      </main>
    );
  }

  if (snap.game.status === "complete") return <GameComplete state={state} />;
  if (snap.game.status === "lobby") return <LobbyView state={state} />;

  const canControl = !!snap.me.canControl;
  if (snap.me.role === "dealer" || (canControl && dealerMode)) {
    return <DealerView state={state} onSwitchToPlayer={snap.me.role === "player" ? () => setDealerMode(false) : undefined} />;
  }
  return <PlayerView state={state} onSwitchToDealer={canControl ? () => setDealerMode(true) : undefined} />;
}

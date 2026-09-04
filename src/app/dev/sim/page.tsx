"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useLayoutEffect } from "react";
import { GameScreen } from "@/components/game/GameScreen";
import { Spinner } from "@/components/ui";

// One simulated device pane (development only). Impersonates a minted fake
// device by routing every RPC through /api/dev with that device's secret.

interface DevWindow extends Window {
  __bpDev?: { deviceId: string; secret: string };
}

/**
 * Installs the impersonation before GameScreen's effects run: layout effects
 * fire before passive effects, and this sibling is rendered first.
 */
function DevIdentity({ deviceId, secret }: { deviceId: string; secret: string }) {
  useLayoutEffect(() => {
    (window as DevWindow).__bpDev = { deviceId, secret };
    return () => {
      delete (window as DevWindow).__bpDev;
    };
  }, [deviceId, secret]);
  return null;
}

function SimPane() {
  const params = useSearchParams();
  const game = params.get("game");
  const d = params.get("d");
  const s = params.get("s");
  if (!game || !d || !s) return <p className="p-6 text-ivory-400">Missing simulator parameters.</p>;
  return (
    <>
      <DevIdentity deviceId={d} secret={s} />
      <GameScreen key={`${game}:${d}`} id={game} />
    </>
  );
}

export default function SimPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={<Spinner label="Loading" />}>
      <SimPane />
    </Suspense>
  );
}

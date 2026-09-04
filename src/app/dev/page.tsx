"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/Logo";
import { Button, Card, Eyebrow, Field, cn } from "@/components/ui";
import { presetLevels } from "@/lib/blinds";
import { friendlyMessage } from "@/lib/errors";

// DEVELOPER CONTROL PANEL (development builds only).
// Mints fake devices, creates a table, seats N players and opens each
// player's real screen in its own pane so a full game can be driven from one
// desktop without twelve phones.

interface SimDevice {
  deviceId: string;
  secret: string;
  label: string;
  playerId?: string | null;
  role: "dealer" | "player";
}

async function devCall<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? "NETWORK");
  return data.result as T;
}

async function rpcAs<T>(d: SimDevice, fn: string, args: Record<string, unknown>): Promise<T> {
  return devCall<T>({ op: "rpc", deviceId: d.deviceId, secret: d.secret, fn, args });
}

const NAMES = ["Brad", "Mike", "Jason", "Chris", "Dana", "Priya", "Tom", "Lena", "Omar", "Kim", "Alex", "Sam"];

export default function DevPanel() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevPanelInner />;
}

function DevPanelInner() {
  const [count, setCount] = useState(6);
  const [mode, setMode] = useState<"dealer" | "play_host">("dealer");
  const [devices, setDevices] = useState<SimDevice[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [panes, setPanes] = useState<SimDevice[]>([]);
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/dev")
      .then((r) => r.json())
      .then((d: { ok: boolean }) => setOk(d.ok))
      .catch(() => setOk(false));
  }, []);

  const push = (m: string) => setLog((l) => [m, ...l].slice(0, 40));

  const seed = async () => {
    setBusy(true);
    setLog([]);
    try {
      const host = { ...(await devCall<{ deviceId: string; secret: string }>({ op: "mint", label: mode === "dealer" ? "Sim iPad" : "Sim host phone" })), label: mode === "dealer" ? "Dealer iPad" : "Host phone", role: mode === "dealer" ? "dealer" : "player" } as SimDevice;
      const created = await rpcAs<{ gameId: string; joinCode: string; playerId: string | null }>(host, "create_game", {
        p_config: {
          tableName: "Dev Table",
          maxSeats: Math.max(count, 2),
          mode,
          displayName: mode === "play_host" ? NAMES[0] : undefined,
          timerMode: "tournament",
          levels: presetLevels("turbo"),
          allowLateEntry: true,
          autoAdvanceLevels: true,
          advanceAfterHand: true,
          soundsEnabled: false,
          hapticsEnabled: false,
          timerAlertsEnabled: false,
        },
      });
      host.playerId = created.playerId;
      setGameId(created.gameId);
      setJoinCode(created.joinCode);
      push(`Created ${created.gameId} code ${created.joinCode}`);
      const all: SimDevice[] = [host];
      let seat = 1;
      if (mode === "play_host") {
        await rpcAs(host, "choose_seat", { p_game_id: created.gameId, p_seat: seat++ });
      }
      const playersToAdd = mode === "play_host" ? count - 1 : count;
      for (let i = 0; i < playersToAdd; i++) {
        const name = NAMES[(mode === "play_host" ? i + 1 : i) % NAMES.length]!;
        const d = { ...(await devCall<{ deviceId: string; secret: string }>({ op: "mint", label: `${name}'s phone` })), label: name, role: "player" } as SimDevice;
        const joined = await rpcAs<{ playerId: string }>(d, "join_game", { p_join_code: created.joinCode, p_display_name: name });
        d.playerId = joined.playerId;
        await rpcAs(d, "choose_seat", { p_game_id: created.gameId, p_seat: seat++ });
        all.push(d);
        push(`${name} seated`);
      }
      setDevices(all);
      setPanes(all.slice(0, 5));
    } catch (err) {
      push(`Error: ${friendlyMessage(err)} (${err instanceof Error ? err.message : ""})`);
    } finally {
      setBusy(false);
    }
  };

  const host = devices[0];
  const hostAct = async (fn: string, args: Record<string, unknown> = {}) => {
    if (!host || !gameId) return;
    try {
      await rpcAs(host, fn, { p_game_id: gameId, ...args });
      push(`${fn} ok`);
    } catch (err) {
      push(`${fn}: ${err instanceof Error ? err.message : "error"}`);
    }
  };

  const paneUrl = (d: SimDevice) => `/dev/sim?game=${gameId}&d=${d.deviceId}&s=${encodeURIComponent(d.secret)}&label=${encodeURIComponent(d.label)}`;

  return (
    <main className="safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col gap-4 py-4">
      <header className="flex items-center justify-between">
        <div>
          <Wordmark size="sm" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-status-warn">Developer control panel · dev builds only</p>
        </div>
        <span className={cn("text-[10px] font-semibold uppercase tracking-[0.2em]", ok ? "text-status-ok" : ok === false ? "text-status-bad" : "text-ivory-500")}>
          {ok ? "Database reachable" : ok === false ? "Database unreachable" : "Checking"}
        </span>
      </header>

      <Card className="flex flex-wrap items-end gap-3">
        <Field label="Players" type="number" min={2} max={12} value={count} onChange={(e) => setCount(Math.min(12, Math.max(2, Number(e.target.value) || 2)))} className="w-28" />
        <div>
          <Eyebrow className="mb-2">Creator</Eyebrow>
          <div className="flex gap-2">
            <Button size="sm" variant={mode === "dealer" ? "primary" : "secondary"} onClick={() => setMode("dealer")}>
              Dedicated dealer
            </Button>
            <Button size="sm" variant={mode === "play_host" ? "primary" : "secondary"} onClick={() => setMode("play_host")}>
              Player host
            </Button>
          </div>
        </div>
        <Button variant="gold" onClick={() => void seed()} loading={busy}>
          Create test table + spawn players
        </Button>
        {joinCode ? <span className="font-mono text-2xl tracking-[0.3em] text-ivory-50">{joinCode}</span> : null}
      </Card>

      {gameId && host ? (
        <Card className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void hostAct("start_game")}>
            Start game
          </Button>
          <Button size="sm" onClick={() => void hostAct("start_hand")}>
            Start hand
          </Button>
          <Button size="sm" onClick={() => void hostAct("deal_flop")}>
            Flop
          </Button>
          <Button size="sm" onClick={() => void hostAct("deal_turn")}>
            Turn
          </Button>
          <Button size="sm" onClick={() => void hostAct("deal_river")}>
            River
          </Button>
          <Button size="sm" onClick={() => void hostAct("end_hand")}>
            End hand
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void hostAct("timer_action", { p_action: "pause" })}>
            Pause clock
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void hostAct("timer_action", { p_action: "add_seconds", p_arg: -540 })}>
            Clock -9 min
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void hostAct("end_game")}>
            End game
          </Button>
          <div className="ml-auto flex flex-wrap gap-1">
            {devices.map((d) => (
              <button
                key={d.deviceId}
                type="button"
                onClick={() => setPanes((p) => (p.some((x) => x.deviceId === d.deviceId) ? p.filter((x) => x.deviceId !== d.deviceId) : [...p, d]))}
                className={cn("rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.15em]", panes.some((x) => x.deviceId === d.deviceId) ? "border-gold-400 text-gold-300" : "border-white/10 text-ivory-500")}
              >
                {d.label}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {gameId ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {panes.map((d) => (
            <div key={d.deviceId} className="overflow-hidden rounded-3xl border border-white/10 bg-charcoal-950">
              <div className="flex items-center justify-between bg-charcoal-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">
                <span>
                  {d.label} · {d.role}
                </span>
                <a href={paneUrl(d)} target="_blank" rel="noreferrer" className="text-gold-300">
                  Open tab
                </a>
              </div>
              <iframe title={d.label} src={paneUrl(d)} className="h-[640px] w-full bg-charcoal-950" />
            </div>
          ))}
        </div>
      ) : null}

      <Card>
        <Eyebrow className="mb-2">Log</Eyebrow>
        <ul className="max-h-40 overflow-auto font-mono text-xs text-ivory-400 scrollbar-thin">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Card>
    </main>
  );
}

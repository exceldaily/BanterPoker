"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useShell } from "@/components/AppShell";
import { Wordmark } from "@/components/Logo";
import { StructureEditor } from "@/components/StructureEditor";
import { Button, Card, Eyebrow, Field, Segmented, Toggle, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { PRESETS, formatDuration, levelLabel, anteLabel, presetLevels, type PresetKey } from "@/lib/blinds";
import { friendlyMessage } from "@/lib/errors";
import { prefs, useStored } from "@/lib/storage";
import type { AnteType, CreateGameConfig, LevelInput, TimerMode } from "@/lib/types";

// Setup wizard: 1 Table, 2 Device role + game, 3 Blinds, 4 Options, 5 Invite (in the lobby).

const STEPS = ["Table", "Game", "Blinds", "Options"] as const;

export default function CreatePage() {
  const router = useRouter();
  const { reloadGames } = useShell();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tableName, setTableName] = useState("");
  const [maxSeats, setMaxSeats] = useState(8);
  const [mode, setMode] = useState<"play_host" | "dealer">("play_host");
  const storedName = useStored(prefs.getDisplayName, "");
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const displayName = nameEdit ?? storedName;
  const setDisplayName = setNameEdit;
  const [timerMode, setTimerMode] = useState<TimerMode>("tournament");
  const [preset, setPreset] = useState<PresetKey>("standard");
  const [levels, setLevels] = useState<LevelInput[]>(() => presetLevels("standard"));
  const [casual, setCasual] = useState({ smallBlind: 1, bigBlind: 2, ante: 0, anteType: "none" as AnteType });
  const [opts, setOpts] = useState({ allowLateEntry: true, autoAdvanceLevels: true, advanceAfterHand: true, soundsEnabled: true, hapticsEnabled: true, timerAlertsEnabled: true });
  const [editing, setEditing] = useState(false);

  const applyPreset = (k: PresetKey) => {
    setPreset(k);
    setLevels(presetLevels(k));
    setEditing(k === "custom");
  };

  const next = () => {
    setError(null);
    if (step === 0 && !tableName.trim()) return setError("Give the table a name.");
    if (step === 1 && mode === "play_host" && !displayName.trim()) return setError("Enter your name.");
    if (step === 2 && timerMode === "tournament" && levels.length === 0) return setError("Add at least one level.");
    if (step === 2 && timerMode !== "tournament") return setStep(3);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "play_host") prefs.setDisplayName(displayName.trim());
      const config: CreateGameConfig = {
        tableName: tableName.trim(),
        maxSeats,
        mode,
        displayName: mode === "play_host" ? displayName.trim() : undefined,
        timerMode,
        levels: timerMode === "tournament" ? levels : undefined,
        casual: timerMode === "casual" ? casual : undefined,
        ...opts,
        deviceLabel: mode === "dealer" ? "Dealer device" : undefined,
      };
      const res = await api.createGame(config);
      prefs.setCurrentGame(res.gameId);
      await reloadGames();
      router.replace(`/game/${res.gameId}`);
    } catch (err) {
      setError(friendlyMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 py-6">
      <header className="flex items-center justify-between">
        <button type="button" onClick={() => (step === 0 ? router.push("/") : setStep(step - 1))} className="text-sm text-ivory-400">
          ← Back
        </button>
        <Wordmark size="sm" />
      </header>

      <ol className="flex items-center gap-2" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col gap-1">
            <span className={cn("h-1 rounded-full", i <= step ? "bg-gold-400" : "bg-white/10")} />
            <span className={cn("text-[10px] font-semibold uppercase tracking-[0.2em]", i === step ? "text-ivory-100" : "text-ivory-600")}>{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="flex flex-col gap-5">
          <div>
            <Eyebrow>Step 1</Eyebrow>
            <h1 className="mt-2 font-serif text-4xl text-ivory-50">Set the table.</h1>
          </div>
          <Field label="Table name" value={tableName} onChange={(e) => setTableName(e.target.value.slice(0, 40))} placeholder="Friday Night Poker" autoFocus />
          <div>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ivory-400">Number of seats</span>
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxSeats(n)}
                  className={cn("h-12 rounded-xl border text-lg font-semibold", maxSeats === n ? "border-gold-400 bg-gold-500/20 text-ivory-50" : "border-white/10 bg-charcoal-900/60 text-ivory-300")}
                  aria-pressed={maxSeats === n}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-ivory-600">Dealer devices never take a seat, so this is players only.</p>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="flex flex-col gap-5">
          <div>
            <Eyebrow>Step 2</Eyebrow>
            <h1 className="mt-2 font-serif text-4xl text-ivory-50">How will this device be used?</h1>
          </div>
          <RoleChoice
            selected={mode === "play_host"}
            title="Play + Host"
            body="I am playing in this game and controlling the table."
            onClick={() => setMode("play_host")}
          />
          <RoleChoice
            selected={mode === "dealer"}
            title="Dedicated Dealer"
            body="This device will control the table but will not play. Ideal for an iPad in the middle."
            onClick={() => setMode("dealer")}
          />
          {mode === "play_host" ? <Field label="Your name" value={displayName} onChange={(e) => setDisplayName(e.target.value.slice(0, 24))} placeholder="What the table calls you" /> : null}
          <Card>
            <Eyebrow>Game</Eyebrow>
            <p className="mt-1 font-serif text-2xl text-ivory-50">No Limit Texas Hold&apos;em</p>
            <div className="mt-4">
              <Segmented
                value={timerMode}
                options={[
                  { value: "tournament", label: "Tournament" },
                  { value: "casual", label: "Casual" },
                  { value: "none", label: "No blinds" },
                ]}
                onChange={setTimerMode}
              />
              <p className="mt-2 text-sm text-ivory-400">
                {timerMode === "tournament"
                  ? "Blind levels with a shared clock on every phone."
                  : timerMode === "casual"
                    ? "Static blinds shown to everyone. No clock."
                    : "Just cards and a board. Nothing else on screen."}
              </p>
            </div>
          </Card>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="flex flex-col gap-5">
          <div>
            <Eyebrow>Step 3</Eyebrow>
            <h1 className="mt-2 font-serif text-4xl text-ivory-50">{timerMode === "tournament" ? "Blinds and antes." : timerMode === "casual" ? "Table stakes." : "No blinds to set."}</h1>
          </div>
          {timerMode === "tournament" ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p.key)}
                    className={cn("rounded-2xl border p-3 text-left", preset === p.key ? "border-gold-400 bg-gold-500/15" : "border-white/10 bg-charcoal-900/60")}
                    aria-pressed={preset === p.key}
                  >
                    <span className="block font-semibold text-ivory-50">{p.label}</span>
                    <span className="mt-1 block text-[11px] leading-snug text-ivory-400">{p.description}</span>
                  </button>
                ))}
              </div>
              {editing ? (
                <StructureEditor levels={levels} onChange={setLevels} />
              ) : (
                <Card>
                  <div className="mb-3 flex items-center justify-between">
                    <Eyebrow>{levels.length} levels</Eyebrow>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                      Edit structure
                    </Button>
                  </div>
                  <ol className="max-h-72 overflow-auto scrollbar-thin text-sm">
                    {levels.map((l, i) => (
                      <li key={i} className={cn("flex items-center justify-between border-b border-white/5 py-1.5", l.type === "break" && "text-gold-300")}>
                        <span>{l.type === "break" ? "Break" : levelLabel(l)}</span>
                        <span className="text-ivory-400">
                          {anteLabel(l) ? `${anteLabel(l)} · ` : ""}
                          {formatDuration(l.durationSeconds)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
            </>
          ) : timerMode === "casual" ? (
            <Card className="grid grid-cols-2 gap-3">
              <NumberInput label="Small blind" value={casual.smallBlind} onChange={(v) => setCasual({ ...casual, smallBlind: v })} />
              <NumberInput label="Big blind" value={casual.bigBlind} onChange={(v) => setCasual({ ...casual, bigBlind: v })} />
              <div className="col-span-2">
                <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">Ante</span>
                <Segmented
                  value={casual.anteType}
                  options={[
                    { value: "none", label: "None" },
                    { value: "standard", label: "Standard" },
                    { value: "big_blind", label: "BB ante" },
                  ]}
                  onChange={(v) => setCasual({ ...casual, anteType: v, ante: v === "none" ? 0 : v === "big_blind" ? casual.bigBlind : casual.ante || 1 })}
                />
              </div>
              {casual.anteType !== "none" ? <NumberInput label="Ante amount" value={casual.ante} onChange={(v) => setCasual({ ...casual, ante: v })} /> : null}
            </Card>
          ) : (
            <p className="text-ivory-400">Players will see only their cards, the board and who has the button.</p>
          )}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="flex flex-col gap-3">
          <div>
            <Eyebrow>Step 4</Eyebrow>
            <h1 className="mt-2 font-serif text-4xl text-ivory-50">Options.</h1>
          </div>
          <Toggle label="Allow late players" description="Late arrivals pick an open seat and you approve them." checked={opts.allowLateEntry} onChange={(v) => setOpts({ ...opts, allowLateEntry: v })} />
          {timerMode === "tournament" ? (
            <>
              <Toggle label="Auto advance levels" description="Move to the next level when the clock hits zero." checked={opts.autoAdvanceLevels} onChange={(v) => setOpts({ ...opts, autoAdvanceLevels: v })} />
              <Toggle label="Advance after current hand" description="If a hand is running when time expires, the new level starts when you end the hand." checked={opts.advanceAfterHand} onChange={(v) => setOpts({ ...opts, advanceAfterHand: v })} />
              <Toggle label="Timer alerts" description="Vibrate at 5 minutes, 1 minute and level changes." checked={opts.timerAlertsEnabled} onChange={(v) => setOpts({ ...opts, timerAlertsEnabled: v })} />
            </>
          ) : null}
          <Toggle label="Sounds" description="Understated cues for deals, streets and levels." checked={opts.soundsEnabled} onChange={(v) => setOpts({ ...opts, soundsEnabled: v })} />
          <Toggle label="Haptics" description="A subtle buzz when cards arrive." checked={opts.hapticsEnabled} onChange={(v) => setOpts({ ...opts, hapticsEnabled: v })} />
        </section>
      ) : null}

      {error ? <p className="text-center text-status-bad">{error}</p> : null}

      <div className="mt-auto flex flex-col gap-2 pt-4">
        {step < STEPS.length - 1 ? (
          <Button size="xl" block onClick={next}>
            Continue
          </Button>
        ) : (
          <Button size="xl" block variant="gold" onClick={create} loading={busy}>
            Open the lobby
          </Button>
        )}
      </div>
    </main>
  );
}

function RoleChoice({ selected, title, body, onClick }: { selected: boolean; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn("rounded-3xl border p-5 text-left transition", selected ? "border-gold-400 bg-gold-500/15 shadow-soft" : "border-white/10 bg-charcoal-900/60")}
    >
      <span className="block font-serif text-2xl text-ivory-50">{title}</span>
      <span className="mt-1 block text-sm text-ivory-400">{body}</span>
    </button>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        className="h-12 rounded-xl border border-white/10 bg-charcoal-900 px-3 text-lg text-ivory-50 focus:border-gold-400/60 focus:outline-none"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  );
}

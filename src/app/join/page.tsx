"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useShell } from "@/components/AppShell";
import { Wordmark } from "@/components/Logo";
import { QrScanner, parseScanned } from "@/components/QrScanner";
import { Button, Card, Eyebrow, Field, Spinner, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyMessage } from "@/lib/errors";
import { prefs, useStored } from "@/lib/storage";

type Step = "code" | "name" | "dealer";

function JoinFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const { reloadGames } = useShell();
  const [step, setStep] = useState<Step>(() => (params.get("mode") === "dealer" ? "dealer" : "code"));
  const [code, setCode] = useState(() => (params.get("code") ?? "").toUpperCase());
  const storedName = useStored(prefs.getDisplayName, "");
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const name = nameEdit ?? storedName;
  const setName = setNameEdit;
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<{ tableName: string; seated: number; maxSeats: number; seatingLocked: boolean; allowLateEntry: boolean } | null>(null);

  const lookup = useCallback(
    async (c: string) => {
      const clean = c.trim().toUpperCase();
      if (clean.length < 4) {
        setError("Enter the 6-character table code.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const info = await api.lookupGame(clean);
        if (info.alreadyMember) {
          prefs.setCurrentGame(info.gameId);
          await reloadGames();
          router.replace(`/game/${info.gameId}`);
          return;
        }
        if (info.status === "complete") {
          setError("That game has already ended.");
          return;
        }
        if (info.seatingLocked && !info.allowLateEntry) {
          setError("Seating is locked at that table. Ask the host to allow late entry.");
          return;
        }
        if (info.seated >= info.maxSeats) {
          setError("That table is full.");
          return;
        }
        setCode(clean);
        setTable(info);
        setStep("name");
      } catch (err) {
        setError(friendlyMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [reloadGames, router],
  );

  useEffect(() => {
    const initial = params.get("code");
    if (initial && initial.length >= 4 && params.get("mode") !== "dealer") {
      const t = window.setTimeout(() => void lookup(initial), 0);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = async () => {
    const clean = name.trim();
    if (!clean) {
      setError("Enter your name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      prefs.setDisplayName(clean);
      const res = await api.joinGame(code, clean, navigator.userAgent.includes("iPad") ? "iPad" : undefined);
      prefs.setCurrentGame(res.gameId);
      await reloadGames();
      router.replace(`/game/${res.gameId}`);
    } catch (err) {
      setError(friendlyMessage(err));
      setBusy(false);
    }
  };

  const pairDealer = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.pairDealer(code, "Dealer device");
      prefs.setCurrentGame(res.gameId);
      await reloadGames();
      router.replace(`/game/${res.gameId}`);
    } catch (err) {
      setError(friendlyMessage(err));
      setBusy(false);
    }
  };

  const onScanned = useCallback(
    (text: string) => {
      setScanning(false);
      const parsed = parseScanned(text);
      if (!parsed) {
        setError("That code is not a Banter Poker table.");
        return;
      }
      if (parsed.kind === "display") {
        router.push(`/display/${parsed.code}`);
        return;
      }
      if (parsed.kind === "dealer") {
        setCode(parsed.code);
        setStep("dealer");
        return;
      }
      void lookup(parsed.code);
    },
    [lookup, router],
  );

  return (
    <main className="safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 py-6">
      {scanning ? <QrScanner onResult={onScanned} onClose={() => setScanning(false)} /> : null}
      <header className="flex items-center justify-between">
        <button type="button" onClick={() => (step === "code" ? router.push("/") : setStep("code"))} className="text-sm text-ivory-400">
          ← Back
        </button>
        <Wordmark size="sm" />
      </header>

      {step === "code" ? (
        <div className="flex flex-1 flex-col gap-5">
          <div>
            <Eyebrow>Join table</Eyebrow>
            <h1 className="mt-2 font-serif text-4xl text-ivory-50">Pull up a chair.</h1>
            <p className="mt-2 text-ivory-400">Scan the host&apos;s QR code, or type the table code they give you.</p>
          </div>
          <Button size="xl" block onClick={() => setScanning(true)}>
            Scan QR code
          </Button>
          <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-ivory-600">
            <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
          </div>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup(code);
            }}
          >
            <Field
              label="Table code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              placeholder="K7PM42"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              className="[&_input]:text-center [&_input]:font-mono [&_input]:text-2xl [&_input]:tracking-[0.35em]"
            />
            <Button type="submit" size="lg" variant="secondary" block loading={busy}>
              Continue
            </Button>
          </form>
          {error ? <p className="text-center text-status-bad">{error}</p> : null}
          <p className="mt-auto text-center text-xs text-ivory-600">
            Have a dealer code from the host?{" "}
            <button type="button" className="text-gold-300 underline" onClick={() => setStep("dealer")}>
              Pair as dealer device
            </button>
          </p>
        </div>
      ) : null}

      {step === "name" && table ? (
        <div className="flex flex-1 flex-col gap-5">
          <Card>
            <Eyebrow>Table</Eyebrow>
            <p className="mt-1 font-serif text-2xl text-ivory-50">{table.tableName}</p>
            <p className="text-sm text-ivory-400">
              {table.seated} of {table.maxSeats} seats taken{table.seatingLocked ? " · late entry, host approval needed" : ""}
            </p>
          </Card>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <Field label="Your name" value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder="What the table calls you" autoFocus maxLength={24} />
            <Button type="submit" size="xl" block loading={busy}>
              Join table
            </Button>
          </form>
          {error ? <p className="text-center text-status-bad">{error}</p> : null}
        </div>
      ) : null}

      {step === "dealer" ? (
        <div className="flex flex-1 flex-col gap-5">
          <div>
            <Eyebrow>Dealer device</Eyebrow>
            <h1 className="mt-2 font-serif text-3xl text-ivory-50">Pair this device.</h1>
            <p className="mt-2 text-ivory-400">The host generates a dealer code under Devices. A dealer device controls the table but never sees a hand.</p>
          </div>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void pairDealer();
            }}
          >
            <Field
              label="Dealer code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              placeholder="XR4T2Q"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className={cn("[&_input]:text-center [&_input]:font-mono [&_input]:text-2xl [&_input]:tracking-[0.35em]")}
            />
            <Button type="submit" size="lg" variant="gold" block loading={busy}>
              Pair as dealer
            </Button>
            <Button type="button" variant="ghost" block onClick={() => setScanning(true)}>
              Scan dealer QR
            </Button>
          </form>
          {error ? <p className="text-center text-status-bad">{error}</p> : null}
        </div>
      ) : null}
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<Spinner label="Loading" />}>
      <JoinFlow />
    </Suspense>
  );
}

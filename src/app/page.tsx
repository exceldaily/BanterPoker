"use client";

import Link from "next/link";
import { useShell } from "@/components/AppShell";
import { LogoMark, Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui";
import { prefs, useStored } from "@/lib/storage";

export default function LandingPage() {
  const { games, installable, installed, promptInstall } = useShell();
  const dismissed = useStored(prefs.getInstallDismissed, true);

  const resumable = games.filter((g) => g.status !== "complete");

  return (
    <main className="safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full max-w-md flex-col justify-between">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-12 text-center">
        <div className="flex flex-col items-center gap-4">
          <LogoMark className="h-16 w-16" />
          <Wordmark size="lg" />
          <p className="max-w-xs text-sm leading-relaxed text-ivory-400">Your cards. Your table. No deck required.</p>
        </div>

        <div className="flex w-full flex-col gap-3">
          {resumable.length > 0 ? (
            <div className="rounded-3xl border border-gold-400/30 bg-gold-500/10 p-4 text-left">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-300">Back to your table</p>
              <div className="flex flex-col gap-2">
                {resumable.slice(0, 3).map((g) => (
                  <Link
                    key={g.gameId}
                    href={`/game/${g.gameId}`}
                    className="flex items-center justify-between rounded-2xl bg-charcoal-900/70 px-4 py-3 text-ivory-50"
                  >
                    <span className="font-medium">{g.tableName}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-400">
                      {g.isHost ? "Host" : g.role === "dealer" ? "Dealer" : "Player"}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          <Link href="/create" className="block">
            <Button size="xl" block>
              Create table
            </Button>
          </Link>
          <Link href="/join" className="block">
            <Button size="xl" variant="secondary" block>
              Join table
            </Button>
          </Link>
          {installable && !installed && !dismissed ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                block
                onClick={async () => {
                  const ok = await promptInstall();
                  if (!ok) prefs.setInstallDismissed(true);
                }}
              >
                Install app
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="flex items-center justify-between pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-600">
        <span>Keep the chips. Keep the banter. Lose the deck.</span>
        <Link href="/display" className="hover:text-ivory-300">
          Table display
        </Link>
      </footer>
    </main>
  );
}

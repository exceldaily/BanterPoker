import Link from "next/link";
import { Wordmark } from "@/components/Logo";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="safe-top safe-bottom safe-x flex min-h-dvh flex-col items-center justify-center gap-6 text-center">
      <Wordmark size="lg" />
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-status-bad">Offline</p>
      <p className="max-w-sm text-ivory-300">Banter Poker needs a connection to keep every phone at the table in sync. Reconnect to Wi-Fi or mobile data and try again.</p>
      <Link href="/" className="rounded-2xl bg-ivory-100 px-6 py-3 font-semibold uppercase tracking-[0.1em] text-charcoal-950">
        Try again
      </Link>
    </main>
  );
}

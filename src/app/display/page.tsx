"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "@/components/Logo";
import { QrScanner, parseScanned } from "@/components/QrScanner";
import { Button, Eyebrow, Field } from "@/components/ui";

/** Entry for a spare tablet/TV: paste the display link or scan the display QR. */
export default function DisplayEntryPage() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [scanning, setScanning] = useState(false);

  const go = (text: string) => {
    const parsed = parseScanned(text);
    if (parsed?.kind === "display") {
      router.push(`/display/${parsed.code}`);
      return;
    }
    const token = text.trim().split("/").pop() ?? "";
    if (token.length >= 16) router.push(`/display/${token}`);
  };

  return (
    <main className="safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 py-6">
      {scanning ? (
        <QrScanner
          onResult={(t) => {
            setScanning(false);
            go(t);
          }}
          onClose={() => setScanning(false)}
        />
      ) : null}
      <header className="flex items-center justify-between">
        <button type="button" onClick={() => router.push("/")} className="text-sm text-ivory-400">
          ← Back
        </button>
        <Wordmark size="sm" />
      </header>
      <div>
        <Eyebrow>Table display</Eyebrow>
        <h1 className="mt-2 font-serif text-4xl text-ivory-50">Put the board in the middle.</h1>
        <p className="mt-2 text-ivory-400">A read-only view of the board, blinds and clock for a tablet or TV. It never shows anyone&apos;s cards. Ask the host for the display link under Table Display.</p>
      </div>
      <Button size="xl" block onClick={() => setScanning(true)}>
        Scan display QR
      </Button>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
      >
        <Field label="Display link or token" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…/display/…" autoCorrect="off" spellCheck={false} />
        <Button type="submit" size="lg" variant="secondary" block>
          Open display
        </Button>
      </form>
    </main>
  );
}

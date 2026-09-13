"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui";

// Per-game photo. The picture is squashed to a 96px JPEG in the browser and
// sent as a small data URL; it lives on the player row for this game only and
// is wiped when the game ends. Nothing is uploaded to storage and nothing
// persists on the phone.

const SIZE = 96;
const MAX_BYTES = 16_000;

async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  const img: ImageBitmap | HTMLImageElement | null =
    bitmap ??
    (await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = URL.createObjectURL(file);
    }));
  if (!img) throw new Error("AVATAR_INVALID");
  const w = "width" in img ? img.width : 0;
  const h = "height" in img ? img.height : 0;
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("AVATAR_INVALID");
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
  // Step quality down until it fits the size cap.
  for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= MAX_BYTES) return url;
  }
  throw new Error("AVATAR_INVALID");
}

export function AvatarCapture({ current, onChange, busy }: { current: string | null; onChange: (dataUrl: string | null) => Promise<void>; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setWorking(true);
    setError(null);
    try {
      const url = await toAvatarDataUrl(file);
      await onChange(url);
    } catch {
      setError("That photo could not be used. Try another one.");
    } finally {
      setWorking(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-charcoal-800">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current} alt="Your photo for this game" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-ivory-600">No photo</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={working || busy} onClick={() => input.current?.click()}>
            {current ? "Change photo" : "Take a photo"}
          </Button>
          {current ? (
            <Button size="sm" variant="ghost" onClick={() => void onChange(null)} disabled={working || busy}>
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] text-ivory-600">{error ?? "Just for this game. It is deleted when the game ends."}</p>
      </div>
      <input ref={input} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

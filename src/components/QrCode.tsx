"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/components/ui";

/** Renders a QR code as an inline SVG data URL (ivory on dark, high contrast). */
export function QrCode({ value, size = 240, className, label }: { value: string; size?: number; className?: string; label?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: size * 2,
      color: { dark: "#0a0a0a", light: "#fbf8f1" },
    })
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);

  return (
    <div className={cn("inline-flex flex-col items-center gap-3", className)}>
      <div className="rounded-3xl bg-ivory-50 p-3 shadow-card" style={{ width: size + 24, height: size + 24 }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} width={size} height={size} alt={label ?? "QR code"} className="rounded-xl" />
        ) : (
          <div className="h-full w-full animate-pulse rounded-xl bg-ivory-200" />
        )}
      </div>
      {label ? <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-ivory-400">{label}</span> : null}
    </div>
  );
}

export function siteUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_SITE_URL ?? "";
}

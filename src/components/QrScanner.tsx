"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

// QR scanning with the native BarcodeDetector where available and a jsQR
// fallback elsewhere. Camera is only opened from an explicit user tap.

type Detector = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats: string[] }) => Detector;
  }
}

export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;

    const finish = (text: string) => {
      if (done.current) return;
      done.current = true;
      onResult(text);
    };

    const run = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch {
        setError("Camera access is off. Type the table code instead.");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
      let jsqr: typeof import("jsqr").default | null = null;
      if (!detector) {
        jsqr = (await import("jsqr")).default;
      }
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (cancelled || done.current) return;
        if (video.readyState >= 2) {
          try {
            if (detector) {
              const codes = await detector.detect(video);
              const hit = codes.find((c) => c.rawValue);
              if (hit) return finish(hit.rawValue);
            } else if (jsqr && ctx) {
              const w = Math.min(640, video.videoWidth);
              const h = Math.round((video.videoHeight / video.videoWidth) * w);
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const res = jsqr(img.data, w, h, { inversionAttempts: "dontInvert" });
              if (res?.data) return finish(res.data);
            }
          } catch {
            // ignore a bad frame
          }
        }
        raf = window.setTimeout(() => void tick(), 120);
      };
      void tick();
    };
    void run();

    return () => {
      cancelled = true;
      window.clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-64 w-64 rounded-3xl border-2 border-ivory-50/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
        <p className="absolute inset-x-0 top-[max(var(--safe-top),1rem)] text-center text-xs font-semibold uppercase tracking-[0.3em] text-ivory-100">
          Point at the table QR code
        </p>
        {error ? <p className="absolute inset-x-6 bottom-28 rounded-2xl bg-charcoal-900/90 p-4 text-center text-ivory-100">{error}</p> : null}
      </div>
      <div className="safe-bottom bg-charcoal-950 p-4">
        <Button variant="secondary" block onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Extracts a join code or dealer code from raw QR text (URL or bare code). */
export function parseScanned(text: string): { kind: "join" | "dealer" | "display"; code: string } | null {
  const t = text.trim();
  try {
    const u = new URL(t);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "join" && parts[1]) return { kind: "join", code: parts[1].toUpperCase() };
    if (parts[0] === "pair" && parts[1]) return { kind: "dealer", code: parts[1].toUpperCase() };
    if (parts[0] === "display" && parts[1]) return { kind: "display", code: parts[1] };
    const q = u.searchParams.get("code");
    if (q) return { kind: "join", code: q.toUpperCase() };
  } catch {
    // not a URL
  }
  if (/^[A-Z0-9]{4,8}$/i.test(t)) return { kind: "join", code: t.toUpperCase() };
  return null;
}

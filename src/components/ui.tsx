"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useIsClient } from "@/lib/storage";

export { cn };

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold";
type Size = "sm" | "md" | "lg" | "xl";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ivory-100 text-charcoal-950 hover:bg-ivory-50 active:bg-ivory-200 shadow-soft",
  secondary: "bg-charcoal-700/80 text-ivory-100 hover:bg-charcoal-600 border border-white/10",
  ghost: "bg-transparent text-ivory-200 hover:bg-white/5 border border-transparent",
  danger: "bg-status-bad/90 text-ivory-50 hover:bg-status-bad",
  gold: "bg-gradient-to-b from-gold-300 to-gold-500 text-charcoal-950 hover:brightness-110 shadow-soft",
};

const SIZES: Record<Size, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-12 px-5 text-base",
  lg: "h-14 px-6 text-lg",
  xl: "h-[4.5rem] px-8 text-xl tracking-wide",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", block, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-2xl font-semibold uppercase tracking-[0.08em] transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 disabled:cursor-not-allowed disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  return (
    <label className={cn("block", className)}>
      {label ? <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-ivory-400">{label}</span> : null}
      <input
        className={cn(
          "h-14 w-full rounded-2xl border border-white/10 bg-charcoal-900/80 px-4 text-lg text-ivory-50 outline-none",
          "placeholder:text-ivory-600 focus:border-gold-400/60 focus:ring-2 focus:ring-gold-400/20",
        )}
        {...rest}
      />
      {hint ? <span className="mt-2 block text-sm text-ivory-400">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-charcoal-900/60 px-4 py-3 text-left disabled:opacity-40"
    >
      <span>
        <span className="block font-medium text-ivory-100">{label}</span>
        {description ? <span className="mt-0.5 block text-sm text-ivory-400">{description}</span> : null}
      </span>
      <span className={cn("relative h-7 w-12 shrink-0 rounded-full transition", checked ? "bg-gold-500" : "bg-charcoal-600")}>
        <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-ivory-50 transition", checked ? "left-6" : "left-1")} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md" }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-2xl border border-white/10 bg-charcoal-900/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-xl font-semibold uppercase tracking-[0.12em] transition",
            size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
            value === o.value ? "bg-ivory-100 text-charcoal-950" : "text-ivory-400 hover:text-ivory-100",
          )}
          aria-pressed={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-3xl border border-white/10 bg-charcoal-900/70 p-5 shadow-soft backdrop-blur", className)}>{children}</div>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[11px] font-semibold uppercase tracking-[0.22em] text-ivory-400", className)}>{children}</p>;
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  const mounted = useIsClient();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted || !open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="rise-in w-full max-w-md rounded-3xl border border-white/10 bg-charcoal-900 p-6 shadow-card safe-bottom"
      >
        {title ? <h2 className="mb-4 font-serif text-2xl text-ivory-50">{title}</h2> : null}
        <div className="text-ivory-200">{children}</div>
        {footer ? <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy} block>
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onCancel} block>
            {cancelLabel}
          </Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}

export function Toast({ message, tone = "info" }: { message: string | null; tone?: "info" | "error" }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-none fixed inset-x-0 top-[max(var(--safe-top),0.75rem)] z-[60] mx-auto w-fit max-w-[90vw] rounded-2xl px-4 py-2 text-sm shadow-soft rise-in",
        tone === "error" ? "bg-status-bad text-ivory-50" : "bg-ivory-100 text-charcoal-950",
      )}
    >
      {message}
    </div>
  );
}

export function useToast(): { message: string | null; tone: "info" | "error"; show: (m: string, tone?: "info" | "error") => void } {
  const [state, setState] = useState<{ message: string | null; tone: "info" | "error" }>({ message: null, tone: "info" });
  useEffect(() => {
    if (!state.message) return;
    const id = window.setTimeout(() => setState((s) => ({ ...s, message: null })), 3200);
    return () => window.clearTimeout(id);
  }, [state.message]);
  return { ...state, show: (message, tone = "info") => setState({ message, tone }) };
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-ivory-400">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-ivory-400 border-t-transparent" aria-hidden />
      {label ? <span className="text-xs font-semibold uppercase tracking-[0.2em]">{label}</span> : null}
    </div>
  );
}

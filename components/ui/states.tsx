/**
 * Shared loading / empty / error / success surface primitives.
 *
 * Replaces ad-hoc spinners and empty divs scattered across the portal with one
 * consistent visual language:
 *   <Spinner size="md" />                       — gold rotating loader
 *   <PageLoader />                              — full-screen centered spinner (page boot)
 *   <EmptyState Icon={Bell} title sub action /> — tone-tinted icon chip + title + sub
 *   <Skeleton className="h-4 w-32" />           — shimmering placeholder
 *   <SkeletonRow />                             — composed list row skeleton
 *   <Banner tone="error" Icon={AlertTriangle}>…</Banner>
 *
 * Tone tokens follow the global palette (`var(--gold)`, `var(--success)`, `var(--danger)`).
 */

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2, Check, CloudOff } from "lucide-react";
import { useLang } from "@/components/LangContext";
import type { Translation, Lang } from "@/lib/translations";
import { relativeTime } from "@/lib/relativeTime";

// ── Spinner ────────────────────────────────────────────────────────────────
type SpinnerSize = "xs" | "sm" | "md" | "lg";
const SPINNER_SIZES: Record<SpinnerSize, number> = { xs: 12, sm: 16, md: 20, lg: 32 };

export function Spinner({ size = "md", className = "", color }: { size?: SpinnerSize; className?: string; color?: string }) {
  const px = SPINNER_SIZES[size];
  const { t } = useLang();
  return (
    <Loader2
      size={px}
      strokeWidth={1.8}
      className={`animate-spin ${className}`}
      style={{ color: color ?? "var(--gold)" }}
      aria-label={t.aLoading}
    />
  );
}

// ── PageLoader — full-screen centered spinner (used at page mount) ─────────
export function PageLoader({ message }: { message?: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="text-center">
        <Spinner size="lg" />
        {message && <p className="mt-4 text-[12.5px]" style={{ color: "var(--w3)" }}>{message}</p>}
      </div>
    </main>
  );
}

// ── EmptyState — tone-tinted icon chip + title + sub + optional action ────
type Tone = "neutral" | "success" | "danger" | "info";

const TONES: Record<Tone, { bg: string; color: string; border: string }> = {
  neutral: { bg: "var(--gdim)",            color: "var(--gold)", border: "var(--border-gold)" },
  success: { bg: "var(--success-bg)",   color: "var(--success)",     border: "var(--success-border)" },
  danger:  { bg: "var(--danger-bg)",   color: "var(--danger)",     border: "var(--danger-border)" },
  info:    { bg: "var(--info-bg)",         color: "var(--info)", border: "var(--info-border)" },
};

export function EmptyState({
  Icon, title, sub, action, tone = "neutral", className = "",
}: {
  Icon: LucideIcon;
  title: string;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div className={`text-center py-12 px-6 ${className}`}
      style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-2xl)" }}>
      <span className="mx-auto mb-4 flex items-center justify-center w-12 h-12 rounded-full"
        style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}` }}>
        <Icon size={22} strokeWidth={1.6} />
      </span>
      <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{title}</p>
      {sub && <p className="text-[12.5px] mt-1.5 max-w-xs mx-auto leading-relaxed" style={{ color: "var(--w3)" }}>{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Skeleton — shimmering placeholder ────────────────────────────────────
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={`inline-block bv-skeleton ${className}`}
      style={{
        background: "var(--bg2)",
        borderRadius: "var(--r-sm)",
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

// ── SkeletonRow — pre-composed list row placeholder ────────────────────────
export function SkeletonRow({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3"
          style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
          <Skeleton className="w-9 h-9" style={{ borderRadius: "var(--r-md)" }} />
          <div className="flex-1 space-y-2">
            <Skeleton className="block w-1/2 h-3" />
            <Skeleton className="block w-3/4 h-2.5" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Banner — inline tone-tinted strip (errors, success, info) ─────────────
export function Banner({
  tone = "info", Icon, children, className = "",
}: {
  tone?: Tone;
  Icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-2 text-[12.5px] ${className}`}
      style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}`, borderRadius: "var(--r-sm)" }}>
      {Icon && <Icon size={13} strokeWidth={1.8} className="flex-shrink-0" />}
      <span className="leading-snug">{children}</span>
    </div>
  );
}

// ── AutosaveIndicator ──────────────────────────────────────────────────────
/**
 * Tiny pill that shows the user their work is saved (and how recently).
 * Pass `savedAt: Date | null` from a useState that the parent updates after
 * each successful localStorage / DB write. Pass `saving: true` while the
 * write is in flight (optional — sub-second writes can omit it).
 *
 * States:
 *   savedAt === null && !saving  →  hidden (no draft yet)
 *   saving === true              →  "Saving…" (gold)
 *   error === true               →  "Couldn't save" (danger)
 *   savedAt set                  →  "Saved · just now" / "30s ago" / "2m ago" …
 *
 * The relative time auto-refreshes every 15s so the user never sees a stale
 * "saved 0s ago" pinned forever.
 */
export function AutosaveIndicator({
  savedAt, saving = false, error = false, className = "",
}: {
  savedAt: Date | null;
  saving?: boolean;
  error?: boolean;
  className?: string;
}) {
  const { t, lang } = useLang();
  // Tick every 15s to refresh the relative time string (e.g. "just now" → "30s ago")
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!savedAt || saving) return;
    const id = setInterval(() => setTick(t => t + 1), 15_000);
    return () => clearInterval(id);
  }, [savedAt, saving]);

  if (!savedAt && !saving && !error) return null;

  const baseStyle = "inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1 rounded-full";

  if (error) {
    return (
      <span className={`${baseStyle} ${className}`}
        style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
        <CloudOff size={11} strokeWidth={1.8} />
        {t.aSaveError}
      </span>
    );
  }

  if (saving) {
    return (
      <span className={`${baseStyle} ${className}`}
        style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
        <Loader2 size={11} strokeWidth={2} className="animate-spin" />
        {t.aSaving}
      </span>
    );
  }

  return (
    <span className={`${baseStyle} ${className}`}
      style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
      <Check size={11} strokeWidth={2} style={{ color: "var(--success)" }} />
      {t.aSaved} · {relativeTime(savedAt!, lang)}
    </span>
  );
}


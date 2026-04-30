"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional uppercase eyebrow above the title — e.g. "Privacy & terms". */
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, eyebrow, children, className }: DialogProps) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) {
      document.addEventListener("keydown", onKey);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      // Always sits BELOW the navbar (top: 58px) and above the mobile bottom
      // action bar — so the bug button / language switcher / profile icons
      // remain reachable while a dialog is open. Z-700 keeps it under the
      // floating bug button (z-1201). Lighter dim than before to match the
      // rest of the site's popup language.
      className="fixed inset-x-0 bottom-0 top-[58px] z-[700] flex items-end sm:items-center justify-center px-3 pb-[96px] sm:p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={cn(
          // Mobile: fill width, capped height so it never overlaps the bar.
          // Desktop: centred card with generous max-width.
          "relative w-full max-w-[680px] flex flex-col",
          // Mobile max-height = viewport minus top safe area minus 96 px bottom clearance
          "max-h-[calc(100vh-172px)] sm:max-h-[88vh]",
          className
        )}
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-2xl)",
          boxShadow: "var(--shadow-lg)",
          animation: "bvFadeRise .28s var(--ease-out)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-1.5" style={{ color: "var(--gold)" }}>
                {eyebrow}
              </p>
            )}
            <h2
              className="text-[1.05rem] font-semibold tracking-[-0.015em] leading-tight"
              style={{ color: "var(--w)" }}
            >
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center transition-colors cursor-pointer"
            style={{
              background: "var(--bg2)",
              border: "1px solid var(--border)",
              color: "var(--w3)",
              borderRadius: "var(--r-sm)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--border)";
              (e.currentTarget as HTMLElement).style.color = "var(--w)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--bg2)";
              (e.currentTarget as HTMLElement).style.color = "var(--w3)";
            }}
          >
            <X size={13} strokeWidth={1.8} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 py-5 flex-1 scrollbar-thin">
          {children}
        </div>
      </div>
    </div>
  );
}

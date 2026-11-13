"use client";

/**
 * Shared modal primitive — the single source of truth for popup chrome.
 *
 * Every popup on the site goes through this component so we get:
 *   - Permanent top navbar (modal starts at top: 58px on every breakpoint)
 *   - Permanent mobile bottom action bar (modal leaves 72px clearance on phones)
 *   - Permanent floating bug-report button (modal sits at z-700, button at z-1201)
 *   - Same backdrop blur + soft dim everywhere — no jarring black screens
 *   - Esc / click-outside / X-button to close
 *   - Body scroll locked while open
 *
 * Usage:
 *   <Modal open={open} onClose={...} title="Title" subtitle="Optional subtitle"
 *          footer={<><Cancel/> <Save/></>}>
 *     ...form fields...
 *   </Modal>
 *
 * For special cases (passport-review form, photo crop) you can pass `chromeless`
 * to skip the title bar / footer and bring your own — the chrome rules still apply.
 */

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import FocusTrap from "focus-trap-react";
import { X as XIcon } from "lucide-react";
import { useLang } from "@/components/LangContext";

export type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZE_MAX_W: Record<ModalSize, string> = {
  sm: "440px",
  md: "560px",
  lg: "780px",
  xl: "1024px",
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "sm",
  chromeless = false,
  closeOnBackdrop = true,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  /** Skip the default header + footer — caller renders its own. Chrome rules still apply. */
  chromeless?: boolean;
  closeOnBackdrop?: boolean;
  /** When true, Esc / backdrop / X-button are disabled — prevents dismissal mid-submit. */
  busy?: boolean;
}) {
  const { t } = useLang();
  const titleId = useId();
  // Lock body scroll + Esc to close (Esc disabled while busy).
  // Tab cycling + focus restore is delegated to focus-trap-react below — that
  // library handles dynamic content, nested portals, screen reader cases, etc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, busy]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
      style={{
        top: "calc(58px + var(--bv-subnav-h, 0px))",
        background: "rgba(21,19,15,0.45)",
        backdropFilter: "blur(8px)",
        animation: "bvFadeRise 0.22s var(--ease-out)",
      }}
      onClick={() => { if (closeOnBackdrop && !busy) onClose(); }}>
      <FocusTrap
        focusTrapOptions={{
          escapeDeactivates: false,           // Esc handled by our useEffect (busy-aware)
          clickOutsideDeactivates: false,     // outside-click handled by backdrop onClick
          returnFocusOnDeactivate: true,      // restore focus to the trigger element
          allowOutsideClick: true,            // permit clicks on the backdrop / scrollbar
          fallbackFocus: () => document.body, // safety if no tabbable found yet
        }}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
          className="w-full flex flex-col outline-none"
          style={{
            maxWidth: SIZE_MAX_W[size],
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            boxShadow: "0 30px 80px -30px rgba(21,19,15,.45)",
            animation: "bvFadeRise 0.28s var(--ease-out)",
            paddingBottom: "env(safe-area-inset-bottom)",
            maxHeight: "calc(100% - 0.5rem)",
          }}
          onClick={e => e.stopPropagation()}>

          {!chromeless && (title || subtitle) && (
            <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
              <div className="min-w-0">
                {title && (
                  <p id={titleId} style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, lineHeight: 1.15, letterSpacing: "-.01em", color: "var(--w)" }}>
                    {title}
                  </p>
                )}
                {subtitle && (
                  <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--w3)" }}>
                    {subtitle}
                  </p>
                )}
              </div>
              <button onClick={onClose} aria-label={t.miClose} disabled={busy}
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: "var(--w3)", border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer" }}>
                <XIcon size={14} strokeWidth={1.8} />
              </button>
            </div>
          )}

          {/* Body — scrollable when content overflows */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {children}
          </div>

          {!chromeless && footer && (
            <div className="flex items-center justify-end gap-2 px-5 py-3"
              style={{ borderTop: "1px solid var(--border)" }}>
              {footer}
            </div>
          )}
        </div>
      </FocusTrap>
    </div>,
    document.body,
  );
}

/**
 * The primary action of a modal / form. Name kept for the call-sites; since the one design
 * (founder 2026-11-13) it is the BLACK pill (kit `Btn kind="primary"`), never gold-filled.
 */
export function GoldButton({
  onClick,
  disabled,
  children,
  className = "",
  type = "button",
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`bv-press inline-flex items-center justify-center gap-1.5 text-[13.5px] font-semibold disabled:opacity-40 ${className}`}
      style={{
        height: 40,
        padding: "0 18px",
        background: "var(--w)",
        color: "var(--bg)",
        border: "1px solid var(--w)",
        borderRadius: 999,
        cursor: disabled ? "default" : "pointer",
      }}>
      {children}
    </button>
  );
}

/**
 * Subtle text-only secondary action (Cancel, Later, etc).
 */
export function GhostButton({
  onClick,
  disabled,
  children,
  className = "",
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`bv-press text-[12.5px] font-medium px-4 py-2 disabled:opacity-50 ${className}`}
      style={{ background: "transparent", color: "var(--w3)", border: "none" }}>
      {children}
    </button>
  );
}

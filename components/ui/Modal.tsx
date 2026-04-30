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

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X as XIcon } from "lucide-react";

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
}) {
  // Lock body scroll + Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 top-[58px] z-[700] flex items-center justify-center p-4 bv-modal-outer"
      style={{
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        animation: "bvFadeRise 0.22s var(--ease-out)",
      }}
      onClick={() => closeOnBackdrop && onClose()}>
      {/* Mobile: leave clearance for the bottom action bar so the modal
          never slides behind the language / theme / profile cluster. */}
      <style>{`
        @media (max-width: 639.98px) {
          .bv-modal-outer { padding-bottom: calc(1rem + 72px) !important; }
        }
      `}</style>
      <div
        className="w-full flex flex-col"
        style={{
          maxWidth: SIZE_MAX_W[size],
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 18px 48px rgba(0,0,0,0.22)",
          animation: "bvFadeRise 0.28s var(--ease-out)",
          paddingBottom: "env(safe-area-inset-bottom)",
          maxHeight: "calc(100% - 0.5rem)",
        }}
        onClick={e => e.stopPropagation()}>

        {!chromeless && (title || subtitle) && (
          <div className="flex items-start justify-between gap-3 px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="min-w-0">
              {title && (
                <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                  {title}
                </p>
              )}
              {subtitle && (
                <p className="text-[11.5px] mt-0.5" style={{ color: "var(--w3)" }}>
                  {subtitle}
                </p>
              )}
            </div>
            <button onClick={onClose} aria-label="Close"
              className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ color: "var(--w3)" }}>
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
    </div>,
    document.body,
  );
}

/**
 * Gold action button — same look as CV builder's primary CTA.
 * Use for the main save/confirm action in modals & forms.
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
      className={`inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold px-5 py-2 transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:opacity-40 disabled:translate-y-0 ${className}`}
      style={{
        background: "var(--gold)",
        color: "#131312",
        borderRadius: "var(--r-md)",
        boxShadow: "0 4px 14px rgba(212,175,55,0.30), 0 0 0 1px rgba(212,175,55,0.35)",
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
      className={`text-[12.5px] font-medium px-4 py-2 transition-colors disabled:opacity-50 ${className}`}
      style={{ background: "transparent", color: "var(--w3)", border: "none" }}>
      {children}
    </button>
  );
}

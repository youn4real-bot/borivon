"use client";

/**
 * Premium-feel section card — the same surface used everywhere in the
 * CV builder. Extracted so admin, organizations, manage-admins, and any
 * future page can drop one in for instant visual consistency.
 *
 * Each card is:
 *   - Full-width with 20px rounded corners
 *   - var(--card) background, no border (matches CV builder)
 *   - 1px subtle drop-shadow for elevation
 *   - Optional collapse (default open)
 *   - Optional header icon (gold tinted square) + title
 *   - Optional right-aligned action area
 */

import { useState } from "react";
import type { LucideIcon } from "lucide-react";

export function SectionCard({
  id,
  title,
  Icon,
  children,
  action,
  defaultOpen = true,
  collapsible = true,
}: {
  id?: string;
  title?: React.ReactNode;
  Icon?: LucideIcon;
  children: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  /** Set false to render a static card with no toggle (no chevron). */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasHeader = title || Icon || action;
  const isOpen = collapsible ? open : true;

  return (
    <div id={id} className="mb-4 transition-all overflow-hidden"
      style={{
        background: "var(--card)",
        border: "none",
        borderRadius: "20px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}>
      {hasHeader && (
        <div className={`flex items-center justify-between gap-3 px-6 ${isOpen ? "pt-6 mb-6" : "py-5"}`}>
          {collapsible ? (
            <button
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
              className="flex items-center gap-3 text-left flex-1 min-w-0"
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
              {Icon && (
                <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                  style={{ background: "var(--gdim)", color: "var(--gold)", borderRadius: "12px" }}>
                  <Icon size={15} strokeWidth={1.8} />
                </span>
              )}
              {title && (
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] flex-1 min-w-0" style={{ color: "var(--w)" }}>
                  {title}
                </h2>
              )}
              <span className="flex items-center justify-center w-7 h-7 flex-shrink-0 transition-transform"
                style={{ color: "var(--w3)", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
                aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {Icon && (
                <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
                  style={{ background: "var(--gdim)", color: "var(--gold)", borderRadius: "12px" }}>
                  <Icon size={15} strokeWidth={1.8} />
                </span>
              )}
              {title && (
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] flex-1 min-w-0" style={{ color: "var(--w)" }}>
                  {title}
                </h2>
              )}
            </div>
          )}
          {action && isOpen && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      {isOpen && <div className={hasHeader ? "px-6 pb-6" : "p-6"}>{children}</div>}
    </div>
  );
}

/**
 * Page header — back arrow + title + subtitle, used at the top of every
 * "secondary" page (admin/manage, organizations, anywhere with a back nav).
 */
export function PageHeader({
  onBack,
  title,
  subtitle,
  Icon,
  action,
}: {
  onBack?: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  Icon?: LucideIcon;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 mb-8">
      {onBack && (
        <button onClick={onBack} aria-label="Back"
          className="bv-icon-btn w-9 h-9 flex items-center justify-center flex-shrink-0 rounded-full"
          style={{ color: "var(--w2)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
      )}
      {Icon && (
        <span className="flex items-center justify-center w-9 h-9 flex-shrink-0 mt-1"
          style={{ background: "var(--gdim)", color: "var(--gold)", borderRadius: "12px" }}>
          <Icon size={15} strokeWidth={1.8} />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-[20px] font-semibold tracking-[-0.015em]" style={{ color: "var(--w)" }}>{title}</h1>
        {subtitle && (
          <p className="text-[12.5px] mt-1" style={{ color: "var(--w3)" }}>{subtitle}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

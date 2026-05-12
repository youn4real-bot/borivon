"use client";

import { useEffect, useRef, ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  children: ReactNode;
  align?: "left" | "right";
  minWidth?: number;
}

export function DropdownMenu({ open, onClose, anchor, children, align = "right", minWidth = 160 }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (anchor?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", handle, true);
    return () => document.removeEventListener("mousedown", handle, true);
  }, [open, onClose, anchor]);

  if (!open || !anchor || !anchor.isConnected || typeof window === "undefined") return null;

  const rect = anchor.getBoundingClientRect();
  const style: React.CSSProperties = {
    position: "fixed",
    top: rect.bottom + 4,
    zIndex: 9999,
    minWidth,
    ...(align === "right"
      ? { right: window.innerWidth - rect.right }
      : { left: rect.left }),
    background: "var(--card)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-md)",
    borderRadius: "var(--r-md)",
    overflow: "hidden",
  };

  return createPortal(
    <div ref={menuRef} style={style}>{children}</div>,
    document.body
  );
}

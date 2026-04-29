"use client";

/**
 * Lightweight context that lets a page register a "mobile menu" toggle.
 * The Navbar's bottom bar reads this and renders the toggle as the first
 * item on mobile. When the page unmounts, the config clears.
 *
 * Used by the candidate dashboard to swap the side phase rail in/out via
 * a hamburger ↔ home button at the bottom-left of the mobile action bar.
 */

import { createContext, useContext, useState, useMemo } from "react";
import type { ReactNode } from "react";

export type MobileMenuConfig = {
  isOpen: boolean;
  toggle: () => void;
  // Aria-label for the button.
  label?: string;
} | null;

type Ctx = {
  config: MobileMenuConfig;
  setConfig: (c: MobileMenuConfig) => void;
};

const MobileMenuContext = createContext<Ctx | null>(null);

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<MobileMenuConfig>(null);
  const value = useMemo(() => ({ config, setConfig }), [config]);
  return <MobileMenuContext.Provider value={value}>{children}</MobileMenuContext.Provider>;
}

export function useMobileMenu() {
  // Tolerate provider absence — non-portal pages don't need this.
  return useContext(MobileMenuContext);
}

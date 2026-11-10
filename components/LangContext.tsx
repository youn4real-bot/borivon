"use client";
import React, { createContext, useContext, useState, useEffect } from "react";
import type { Lang } from "@/lib/translations";
import { translations } from "@/lib/translations";

interface LangCtx {
  lang: Lang;
  t: typeof translations[Lang];
  setLang: (l: Lang) => void;
}

const LangContext = createContext<LangCtx>({
  lang: "de",
  t: translations.de,
  setLang: () => {},
});

/**
 * German for everyone (founder 2026-11-10: "everything on this website must be in German, even the
 * nurses' portal"). French and English stay, one click away in the settings / footer; a choice someone
 * made is kept. The browser's language no longer decides.
 */
function detectLang(): Lang {
  let saved: Lang | null = null;
  try { saved = localStorage.getItem("borivon-lang") as Lang | null; } catch { /* storage off */ }
  if (saved && ["fr", "en", "de"].includes(saved)) return saved;
  return "de";
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("de");

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("borivon-lang", l);
    document.documentElement.setAttribute("lang", l);
    document.documentElement.setAttribute("dir", "ltr");
  };

  useEffect(() => {
    const detected = detectLang();
    setLangState(detected);
    document.documentElement.setAttribute("lang", detected);
    document.documentElement.setAttribute("dir", "ltr");
  }, []);

  return (
    <LangContext.Provider value={{ lang, t: translations[lang], setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export const useLang = () => useContext(LangContext);

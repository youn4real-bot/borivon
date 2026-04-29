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
  lang: "fr",
  t: translations.fr,
  setLang: () => {},
});

function detectLang(): Lang {
  const saved = localStorage.getItem("borivon-lang") as Lang | null;
  if (saved && ["fr", "en", "de"].includes(saved)) return saved;
  const browser = navigator.language?.toLowerCase() ?? "";
  if (browser.startsWith("de")) return "de";
  if (browser.startsWith("fr")) return "fr";
  return "en";
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("fr");

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

"use client";

import "./fx.css";
import { useEffect, useState, type ReactNode } from "react";
import { useLang } from "@/components/LangContext";
import type { Lang } from "@/lib/facility/steps";
import { fxT } from "./i18n";

/** The language this platform speaks: the site's choice (de / en / fr), German until known. */
export function useFxLang(): { lang: Lang; setLang: (l: Lang) => void; ready: boolean } {
  const { lang, setLang } = useLang();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const l = (["de", "en", "fr"].includes(lang) ? lang : "de") as Lang;
  return { lang: l, setLang: (x: Lang) => setLang(x), ready };
}

export const Arrow = () => (
  <svg viewBox="0 0 20 10" aria-hidden="true"><path d="M1 5h17M14 1l4 4-4 4" /></svg>
);

/** Top bar + footer around every platform page. `nav` = the workspace links (signed in only). */
export function FxShell({ children, who, nav, lang, setLang, ready }: {
  children: ReactNode; who?: string; nav?: ReactNode; lang: Lang; setLang: (l: Lang) => void; ready: boolean;
}) {
  const t = fxT(lang);
  return (
    <div className="fx">
      <header className="fx-top">
        <div className="c">
          <a className="fx-logo" href="/">Borivon<b>.</b></a>
          {who && <span className="who">{who}</span>}
          <span className="sp" />
          {nav && <nav className="fx-nav" aria-label="Borivon">{nav}</nav>}
          <div className="fx-langs" role="group" aria-label="Sprache / Language">
            {(["de", "en", "fr"] as Lang[]).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </header>
      <main id="main-content" className={`fx-main fx-in${ready ? " on" : ""}`}>{children}</main>
      <footer className="fx-foot">
        <div className="c">
          <span>© Borivon LLC</span>
          <a href="/impressum">{t.impressum}</a>
          <a href="/datenschutz">{t.privacy}</a>
          <a href="/einrichtung/nutzungsbedingungen">{t.terms}</a>
          <a href="/einrichtung/avv">{t.avv}</a>
          <span className="sp" />
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">{t.mapData}</a>
        </div>
      </footer>
    </div>
  );
}

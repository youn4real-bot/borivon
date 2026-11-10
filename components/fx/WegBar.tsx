"use client";

import type { Lang } from "@/lib/facility/steps";
import { WEG_ANCHOR, WEG_ORDER, WEG_T, wegNow, type WegKey } from "@/lib/facility/weg";

/** Four stations at the top of the way: where she stands, how far, a tap jumps there. */
export function WegBar({ lang, prog }: { lang: Lang; prog: Partial<Record<WegKey, [number, number]>> }) {
  const t = WEG_T[lang] ?? WEG_T.de;
  const now = wegNow(prog);
  return (
    <ol className="fx-weg" aria-label={t.aria}>
      {WEG_ORDER.map((k, i) => {
        const [d, n] = prog[k] ?? [0, 0];
        const full = n > 0 && d >= n;
        const pct = n > 0 ? Math.round((d / n) * 100) : 0;
        return (
          <li key={k} className={`${k === now ? "now" : ""}${full ? " done" : ""}`}>
            <span className="wb" style={{ width: `${pct}%` }} aria-hidden="true" />
            <a href={`#${WEG_ANCHOR[k]}`} aria-current={k === now ? "step" : undefined}>
              <span className="wn">{String(i + 1).padStart(2, "0")}</span>
              <span className="wl">{t[k]}</span>
              <span className="ws">{full ? t.done : k === now ? `${t.now} · ${t.of.replace("{a}", String(d)).replace("{b}", String(n))}` : t.of.replace("{a}", String(d)).replace("{b}", String(n))}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

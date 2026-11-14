// The one page loader of the portal (founder 2026-11-12: no spinning circle — the logo, animated,
// minimalist). The logo is exactly the homepage wordmark (components/Wordmark.tsx): EB Garamond
// italic 500 + upright bold gold dot. The letters rise in one after another, the gold dot drops in,
// a short hold, a soft fade, again. Pure JSX, no hooks, no "use client": safe inside loading.tsx
// (server) and client pages alike, so the server shell and the page show the same loader.
import React from "react";

const LETTERS = "Borivon".split("");

const CSS = `
.bv-ld{display:inline-flex;align-items:center;justify-content:center}
.bv-ld-w{font-family:var(--font-serif),"EB Garamond",Georgia,serif;font-style:italic;font-weight:500;font-size:46px;line-height:1;letter-spacing:-.01em;color:var(--w,#15130f);white-space:nowrap}
.bv-ld-w span{display:inline-block;opacity:0;animation:bvLdIn 2.8s cubic-bezier(.2,.7,.2,1) infinite}
.bv-ld-w b{display:inline-block;font-style:normal;font-weight:700;color:var(--gold,#a8843a);opacity:0;animation:bvLdDot 2.8s cubic-bezier(.3,1.3,.5,1) infinite;animation-delay:.55s}
@keyframes bvLdIn{0%{opacity:0;transform:translateY(.22em);filter:blur(6px)}18%,70%{opacity:1;transform:none;filter:blur(0)}88%,100%{opacity:0;transform:none;filter:blur(0)}}
@keyframes bvLdDot{0%{opacity:0;transform:translateY(-.7em)}14%{opacity:1;transform:translateY(0)}20%{transform:translateY(-.08em)}26%,60%{opacity:1;transform:none}78%,100%{opacity:0;transform:none}}
@media (prefers-reduced-motion: reduce){.bv-ld-w span,.bv-ld-w b{animation:none;opacity:1}}
`;

export function BvLoader({ label = "Lädt" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="bv-ld" data-bv-loader="">
      <span className="bv-ld-w" aria-hidden="true">
        {LETTERS.map((c, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.07}s` }}>{c}</span>
        ))}
        <b>.</b>
      </span>
      <style>{CSS}</style>
    </div>
  );
}

/** The same loader as plain HTML (no React), for the boot cover that app/portal/layout.tsx paints before
 *  any JavaScript runs. Keep it identical to <BvLoader/>. */
export function bvLoaderHtml(): string {
  const letters = LETTERS.map((c, i) => `<span style="animation-delay:${(i * 0.07).toFixed(2)}s">${c}</span>`).join("");
  return `<div class="bv-ld"><span class="bv-ld-w" aria-hidden="true">${letters}<b>.</b></span></div><style>${CSS}</style>`;
}

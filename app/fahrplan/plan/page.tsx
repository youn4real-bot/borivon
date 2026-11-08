"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PdfViewer } from "@/components/PdfViewer";
import type { PageOverlayFn } from "@/components/PdfViewer";

/**
 * borivon.com/fahrplan/plan?id=&t=&lang= — the Fahrplan ON the website (founder
 * 2026-11-08, modelled on acquisition.com): opens in the browser, links inside
 * the PDF stay clickable (laid over the pages), download is optional.
 * The PDF itself comes from /api/roadmap/view (signed link, after opt-in).
 */
type Link = { page: number; x: number; y: number; w: number; h: number; url: string };

const TXT = {
  de: { plan: "Ihr Fahrplan", bonus: "Bonus: Agentur-Check", dl: "PDF herunterladen", bad: "Dieser Link ist ungültig oder abgelaufen.", again: "Fahrplan neu anfordern" },
  en: { plan: "Your roadmap", bonus: "Bonus: agency check", dl: "Download PDF", bad: "This link is invalid or expired.", again: "Request the roadmap again" },
  fr: { plan: "Votre plan", bonus: "Bonus : check agence", dl: "Télécharger le PDF", bad: "Ce lien est invalide ou expiré.", again: "Redemander le plan" },
} as const;

function Viewer() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "", t = sp.get("t") ?? "";
  const lang = (["de", "en", "fr"].includes(sp.get("lang") ?? "") ? sp.get("lang") : "de") as keyof typeof TXT;
  const [doc, setDoc] = useState<"plan" | "bonus">(sp.get("doc") === "bonus" ? "bonus" : "plan");
  const [links, setLinks] = useState<Link[]>([]);
  const [failed, setFailed] = useState(false);
  const T = TXT[lang];
  const base = `/api/roadmap/view?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}${doc === "bonus" ? "&doc=bonus" : ""}`;

  useEffect(() => {
    let off = false;
    setLinks([]);
    fetch(`${base}&links=1`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { links?: Link[] }) => { if (!off) setLinks(j.links ?? []); })
      .catch(() => { if (!off) setFailed(true); });
    return () => { off = true; };
  }, [base]);

  const overlay: PageOverlayFn = useMemo(() => ({ pageNum, dispW, dispH }) => (
    <>
      {links.filter((l) => l.page === pageNum).map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noopener" aria-label={l.url}
          style={{ position: "absolute", left: l.x * dispW, top: l.y * dispH, width: l.w * dispW, height: l.h * dispH, cursor: "pointer", pointerEvents: "auto" }} />
      ))}
    </>
  ), [links]);

  if (!id || !t || failed) {
    return (
      <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center", color: "var(--w2)" }}>
        <div>
          <p style={{ marginBottom: 16 }}>{T.bad}</p>
          <a href="/fahrplan" style={{ color: "var(--gold)", fontWeight: 600 }}>{T.again} →</a>
        </div>
      </div>
    );
  }

  const tab = (k: "plan" | "bonus", label: string) => (
    <button type="button" onClick={() => setDoc(k)} aria-pressed={doc === k}
      style={{ background: doc === k ? "#eeecea" : "transparent", color: doc === k ? "#131312" : "#9a978f", border: 0, borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: doc === k ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>
      {label}
    </button>
  );

  return (
    <div style={{ background: "#0e0e10", minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px clamp(12px,3vw,28px)", borderBottom: "1px solid rgba(238,236,234,0.09)", flexWrap: "wrap" }}>
        <a href="/" style={{ fontFamily: "var(--font-serif-v), Georgia, serif", fontStyle: "italic", fontSize: 22, color: "#eeecea", textDecoration: "none" }}>
          Borivon<span style={{ color: "#c9a240", fontStyle: "normal" }}>.</span>
        </a>
        <div style={{ display: "flex", gap: 2, border: "1px solid rgba(238,236,234,0.09)", borderRadius: 999, padding: 3 }}>
          {tab("plan", T.plan)}{tab("bonus", T.bonus)}
        </div>
        <a href={`${base}&dl=1`} style={{ background: "#c9a240", color: "#131312", borderRadius: 999, padding: "9px 16px", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
          ↓ {T.dl}
        </a>
      </header>
      <div style={{ flex: 1, minHeight: 0, height: "calc(100dvh - 64px)" }}>
        <PdfViewer key={doc} src={base} hideRotate pageOverlay={overlay} onError={() => setFailed(true)} />
      </div>
    </div>
  );
}

export default function FahrplanPlanPage() {
  return <Suspense fallback={null}><Viewer /></Suspense>;
}

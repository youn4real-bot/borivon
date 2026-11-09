"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PdfViewer } from "@/components/PdfViewer";
import type { PageOverlayFn } from "@/components/PdfViewer";
import { track, setTrackLead } from "@/lib/track/client";

/** Our workshop / site links inside the PDF carry where they came from, so the visit (and a booking)
 *  is credited to this Fahrplan and its lead in the founder's analytics. */
function tagged(url: string, leadId: string): string {
  try {
    const u = new URL(url);
    if (!/(^|.)borivon.com$/.test(u.hostname)) return url;
    u.searchParams.set("via", "pdf");
    if (/^[0-9a-f-]{36}$/i.test(leadId)) u.searchParams.set("lid", leadId);
    return u.toString();
  } catch { return url; }
}

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
  useEffect(() => { setTrackLead(id); }, [id]);
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
        <a key={i} href={tagged(l.url, id)} target="_blank" rel="noopener" aria-label={l.url}
          onClick={() => track("pdf_cta", `${doc} p${pageNum}`, l.url)}
          style={{ position: "absolute", left: l.x * dispW, top: l.y * dispH, width: l.w * dispW, height: l.h * dispH, cursor: "pointer", pointerEvents: "auto" }} />
      ))}
    </>
  ), [links, id, doc]);

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
      style={{ background: doc === k ? "#f4efe4" : "transparent", color: doc === k ? "#15130f" : "#a59e90", border: 0, borderRadius: 3, padding: "7px 14px", fontSize: 13, fontWeight: doc === k ? 500 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>
      {label}
    </button>
  );

  return (
    // borivon.com look (content/pflege/bv.css): a night reading room, paper accents, square corners
    <div style={{ background: "#12110e", minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px clamp(12px,3vw,28px)", borderBottom: "1px solid #2c2924", flexWrap: "wrap" }}>
        <a href="/" style={{ fontFamily: "var(--font-serif-v), Georgia, serif", fontStyle: "italic", fontWeight: 500, fontSize: 24, color: "#f4efe4", textDecoration: "none" }}>
          Borivon<span style={{ color: "#d4b676", fontStyle: "normal" }}>.</span>
        </a>
        <div style={{ display: "flex", gap: 2, border: "1px solid #2c2924", borderRadius: 4, padding: 3 }}>
          {tab("plan", T.plan)}{tab("bonus", T.bonus)}
        </div>
        <a href={`${base}&dl=1`} style={{ background: "#f4efe4", color: "#15130f", borderRadius: 3, padding: "10px 16px", fontSize: 13, fontWeight: 500, textDecoration: "none", whiteSpace: "nowrap" }}>
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

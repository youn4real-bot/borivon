"use client";

/**
 * WhatsApp doc request — minimalist, STEP-BY-STEP, with a one-time upload link.
 *
 * A candidate is usually missing just one or a couple of docs; dumping the whole
 * list overwhelms her. So the admin ticks the one(s) to ask for now, taps "Create
 * link", and we mint a LOGIN-LESS one-time upload link (borivon.com/u/<token>)
 * scoped to exactly those docs — then open WhatsApp pre-filled with it. The
 * candidate opens the link and uploads without logging in. If the upload-link
 * feature isn't enabled (migration not run), it falls back to the portal login
 * link so the nudge still works.
 *
 * Shows the number it will message and warns when it looks incomplete, so we never
 * message a wrong person. Compose-and-open only — the admin hits send.
 *
 * The one design (founder 2026-11-13): the trigger is one row of the admin's ⋯ menu; the picker is the
 * universal popup (LAW #36: z 1100, blur 8, radius 20), and a long list flips instead of scrolling.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Check, AlertTriangle, X as XIcon, Loader2, Copy, Link2 } from "lucide-react";
import { normalizeWaPhone, isValidWaPhone, prettyWaPhone, waMeUrl } from "@/lib/waLink";
import { KitStyle, Btn, Pager, usePaged } from "@/components/fx/kit";

export type MissingDoc = { key: string; label: string };

const WA_GREEN = "#25D366";
// the menu row's hover (inline styles cannot hover); same rule as the rest of the ⋯ menu
const ROW_CSS = ".bvx-row{transition:background .15s}.bvx-row:hover:not(:disabled){background:var(--bg2)}";

export function WhatsAppDocRequest({
  candidateId,
  accessToken,
  phoneRaw,
  firstName,
  docs,
  lang,
}: {
  candidateId: string;
  accessToken: string;
  phoneRaw: string;
  firstName: string;
  docs: MissingDoc[];
  lang: string;
}) {
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [minting, setMinting] = useState(false);
  const [waHref, setWaHref] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const open = pos !== null;

  const phone = normalizeWaPhone(phoneRaw);
  const valid = isValidWaPhone(phone);
  if (!phone || docs.length === 0) return null;

  const chosen = docs.filter((d) => sel.has(d.key));

  const toggle = (key: string) => {
    setSel((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
    setWaHref(null); setUploadUrl(null); setCopied(false); // selection changed → re-mint
  };

  const composeMessage = (link: string) => {
    const names = chosen.map((d) => d.label).join(", ");
    const one = chosen.length === 1;
    return lang === "fr"
      ? `Bonjour ${firstName}, merci de téléverser ${one ? "ce document" : "ces documents"} : ${names}. Pas besoin de compte, cliquez ici : ${link}`
      : lang === "de"
      ? `Hallo ${firstName}, bitte laden Sie ${one ? "dieses Dokument" : "diese Dokumente"} hoch: ${names}. Kein Login nötig, hier klicken: ${link}`
      : `Hi ${firstName}, please upload ${one ? "this document" : "these documents"}: ${names}. No login needed, tap here: ${link}`;
  };

  const createLink = async () => {
    if (!chosen.length || minting) return;
    setMinting(true);
    try {
      const r = await fetch("/api/portal/admin/upload-links", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ candidateId, docKeys: chosen.map((d) => d.key) }),
      });
      if (r.ok) {
        const j = (await r.json()) as { url?: string };
        const link = j.url || "https://www.borivon.com/portal";
        setUploadUrl(link);
        setWaHref(waMeUrl(phone, composeMessage(link)));
      } else {
        // Feature not enabled / error → fall back to the portal login link.
        const link = "https://www.borivon.com/portal";
        setUploadUrl(link);
        setWaHref(waMeUrl(phone, composeMessage(link)));
      }
    } catch {
      const link = "https://www.borivon.com/portal";
      setUploadUrl(link);
      setWaHref(waMeUrl(phone, composeMessage(link)));
    } finally {
      setMinting(false);
    }
  };

  const openPop = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSel(new Set()); setWaHref(null); setUploadUrl(null); setCopied(false);
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };
  const close = () => setPos(null);

  const copyLink = async () => {
    if (!uploadUrl) return;
    try { await navigator.clipboard.writeText(uploadUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <>
      <style>{ROW_CSS}</style>
      <button type="button" onClick={openPop}
        title={L("Request documents on WhatsApp", "Demander des documents sur WhatsApp", "Dokumente per WhatsApp anfordern")}
        className="bvx-row"
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", height: 40, padding: "0 10px", borderRadius: 10, background: "none", border: 0, fontSize: 14, color: "var(--w)", cursor: "pointer", fontFamily: "inherit", textAlign: "left", whiteSpace: "nowrap" }}>
        <MessageCircle size={15} strokeWidth={1.8} style={{ color: WA_GREEN, flex: "none" }} /> WhatsApp
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
          onClick={close}>
          <KitStyle />
          <style>{ROW_CSS}</style>
          <div role="dialog" aria-modal="true" className="w-full rounded-[20px] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 380, padding: 22, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", animation: "bvFadeRise .28s var(--ease-out)",
              maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)" }}>
            <div className="flex items-start flex-shrink-0" style={{ gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, lineHeight: 1.2, color: "var(--w)" }}>
                  {L("Ask to upload", "Demander de téléverser", "Zum Hochladen auffordern")}
                </h3>
                <div style={{ marginTop: 4, fontSize: 12.5, color: valid ? "var(--w3)" : "#dc2626" }}>
                  {valid ? prettyWaPhone(phone) : (
                    <span className="inline-flex items-start" style={{ gap: 5 }}>
                      <AlertTriangle size={13} strokeWidth={2} style={{ flex: "none", marginTop: 2 }} />
                      <span>{prettyWaPhone(phone)} — {L("this number looks incomplete; fix it in her profile first", "ce numéro semble incomplet ; corrigez-le d'abord dans son profil", "diese Nummer wirkt unvollständig; bitte zuerst im Profil korrigieren")}</span>
                    </span>
                  )}
                </div>
              </div>
              <button type="button" onClick={close} aria-label={L("Close", "Fermer", "Schließen")}
                style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--w3)", cursor: "pointer", display: "grid", placeItems: "center", flex: "none" }}>
                <XIcon size={14} strokeWidth={1.8} />
              </button>
            </div>

            <p className="flex-shrink-0" style={{ margin: "14px 0 6px", fontSize: 12.5, color: "var(--w3)" }}>
              {L("Pick 1–2 — step by step, don't overwhelm.", "Choisissez 1–2 — étape par étape.", "1–2 auswählen — Schritt für Schritt.")}
            </p>

            {/* the papers she is missing — a long list flips (‹ 1 / 2 ›) instead of scrolling */}
            <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
              <DocPicks docs={docs} sel={sel} toggle={toggle} />
            </div>

            <div className="flex flex-col flex-shrink-0" style={{ gap: 8, marginTop: 16 }}>
              {!waHref ? (
                <Btn kind="primary" onClick={() => void createLink()} disabled={!chosen.length || minting} style={{ width: "100%" }}>
                  {minting ? <Loader2 size={15} className="animate-spin" strokeWidth={2.2} /> : <Link2 size={15} strokeWidth={1.8} />}
                  {chosen.length ? L(`Create link (${chosen.length})`, `Créer le lien (${chosen.length})`, `Link erstellen (${chosen.length})`) : L("Select a document", "Choisir un document", "Dokument auswählen")}
                </Btn>
              ) : (
                <>
                  <a href={waHref} target="_blank" rel="noopener noreferrer" onClick={close} className="bvk-btn bvk-primary" style={{ width: "100%" }}>
                    <MessageCircle size={15} strokeWidth={1.8} style={{ color: WA_GREEN }} /> {L("Send on WhatsApp", "Envoyer sur WhatsApp", "Auf WhatsApp senden")}
                  </a>
                  <Btn kind="ghost" size="sm" onClick={() => void copyLink()} style={{ width: "100%" }}>
                    {copied ? <Check size={14} strokeWidth={2.2} style={{ color: "#16a34a" }} /> : <Copy size={14} strokeWidth={1.8} />}
                    {copied ? L("Copied", "Copié", "Kopiert") : L("Copy link", "Copier le lien", "Link kopieren")}
                  </Btn>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** The tick list of missing papers; mounts with the popup, so it always opens on page 1. */
function DocPicks({ docs, sel, toggle }: { docs: MissingDoc[]; sel: Set<string>; toggle: (key: string) => void }) {
  const { slice, page, pages, setPage } = usePaged(docs, 8, 7);
  return (
    <>
      <div className="flex flex-col" style={{ gap: 2 }}>
        {slice.map((d) => {
          const on = sel.has(d.key);
          return (
            <button key={d.key} type="button" onClick={() => toggle(d.key)} aria-pressed={on} className="bvx-row"
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", height: 40, padding: "0 10px", borderRadius: 10, border: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                fontSize: 14, color: "var(--w)", background: on ? "var(--bg2)" : "none" }}>
              <span className="flex items-center justify-center" style={{ width: 17, height: 17, borderRadius: 5, flex: "none",
                border: `1.5px solid ${on ? "var(--w)" : "var(--border2)"}`, background: on ? "var(--w)" : "transparent", color: "var(--bg)" }}>
                {on && <Check size={11} strokeWidth={3} />}
              </span>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</span>
            </button>
          );
        })}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </>
  );
}

"use client";

/**
 * WhatsApp doc request — the minimalist, STEP-BY-STEP nudge.
 *
 * A candidate is usually missing just one or a couple of docs at a time; dumping
 * the whole list overwhelms her. So this opens a small popover of the missing
 * docs, the admin ticks the one(s) to ask for now, and it opens WhatsApp
 * pre-filled with only those. Compose-and-open only — the admin hits send.
 *
 * It also SHOWS the number it will message and warns when it looks incomplete
 * (e.g. a Moroccan number missing a digit) so we never message a wrong person.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Check, AlertTriangle, X as XIcon } from "lucide-react";
import { normalizeWaPhone, isValidWaPhone, prettyWaPhone, waMeUrl } from "@/lib/waLink";

export type MissingDoc = { key: string; label: string };

export function WhatsAppDocRequest({
  phoneRaw,
  firstName,
  docs,
  lang,
}: {
  phoneRaw: string;
  firstName: string;
  docs: MissingDoc[];
  lang: string;
}) {
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const open = pos !== null;

  const phone = normalizeWaPhone(phoneRaw);
  const valid = isValidWaPhone(phone);
  if (!phone || docs.length === 0) return null; // nothing to nudge about

  const toggle = (key: string) =>
    setSel((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const chosen = docs.filter((d) => sel.has(d.key));
  const buildUrl = () => {
    const names = chosen.map((d) => d.label).join(", ");
    const one = chosen.length === 1;
    const portal = "https://www.borivon.com/portal";
    const msg = lang === "fr"
      ? `Bonjour ${firstName}, merci de téléverser ${one ? "ce document" : "ces documents"} sur votre portail Borivon : ${names}. Lien : ${portal}`
      : lang === "de"
      ? `Hallo ${firstName}, bitte laden Sie ${one ? "dieses Dokument" : "diese Dokumente"} in Ihrem Borivon-Portal hoch: ${names}. Link: ${portal}`
      : `Hi ${firstName}, please upload ${one ? "this document" : "these documents"} in your Borivon portal: ${names}. Link: ${portal}`;
    return waMeUrl(phone, msg);
  };

  const openPop = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSel(new Set());
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };
  const close = () => setPos(null);

  return (
    <>
      <button type="button" onClick={openPop}
        title={L("Request documents on WhatsApp", "Demander des documents sur WhatsApp", "Dokumente per WhatsApp anfordern")}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3.5 py-2 rounded-full transition-opacity hover:opacity-80 flex-shrink-0"
        style={{ background: "rgba(37,211,102,0.12)", color: "#25D366", border: "1px solid rgba(37,211,102,0.4)" }}>
        <MessageCircle size={12} strokeWidth={2} /> {L("WhatsApp", "WhatsApp", "WhatsApp")}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[1099]" onClick={close} />
          <div className="fixed z-[1100] p-3 flex flex-col gap-2"
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos!.top, right: pos!.right, width: 288, maxHeight: 380, overflowY: "auto", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "0 12px 34px rgba(0,0,0,0.45)" }}>
            <div className="flex items-center">
              <span className="text-[12.5px] font-semibold" style={{ color: "var(--w)" }}>
                {L("Ask to upload", "Demander de téléverser", "Zum Hochladen auffordern")}
              </span>
              <button type="button" onClick={close} className="ml-auto opacity-70 hover:opacity-100" style={{ color: "var(--w2)" }}><XIcon size={15} strokeWidth={2} /></button>
            </div>

            {/* The number we'll message + an incomplete-number warning. */}
            <div className="text-[11px]" style={{ color: valid ? "var(--w3)" : "var(--danger)" }}>
              {valid ? prettyWaPhone(phone) : (
                <span className="inline-flex items-start gap-1">
                  <AlertTriangle size={12} strokeWidth={2} className="mt-0.5 flex-shrink-0" />
                  <span>{prettyWaPhone(phone)} — {L("this number looks incomplete; fix it in her profile first", "ce numéro semble incomplet ; corrigez-le d'abord dans son profil", "diese Nummer wirkt unvollständig; bitte zuerst im Profil korrigieren")}</span>
                </span>
              )}
            </div>

            <p className="text-[10.5px]" style={{ color: "var(--w3)" }}>
              {L("Pick 1–2 — step by step, don't overwhelm.", "Choisissez 1–2 — étape par étape.", "1–2 auswählen — Schritt für Schritt.")}
            </p>

            <div className="flex flex-col gap-1">
              {docs.map((d) => {
                const on = sel.has(d.key);
                return (
                  <button key={d.key} type="button" onClick={() => toggle(d.key)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[12.5px] transition-colors bv-row-hover"
                    style={{ color: "var(--w)", border: `1px solid ${on ? "var(--border-gold)" : "transparent"}`, background: on ? "var(--gdim)" : "transparent" }}>
                    <span className="flex items-center justify-center flex-shrink-0" style={{ width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${on ? "#25D366" : "var(--border)"}`, background: on ? "#25D366" : "transparent", color: "#fff" }}>
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="flex-1 truncate">{d.label}</span>
                  </button>
                );
              })}
            </div>

            <a
              href={chosen.length ? buildUrl() : undefined}
              target="_blank" rel="noopener noreferrer"
              onClick={(e) => { if (!chosen.length) { e.preventDefault(); return; } close(); }}
              aria-disabled={chosen.length === 0}
              className="mt-1 inline-flex items-center justify-center gap-1.5 text-[12.5px] font-semibold transition-opacity"
              style={{ height: 38, borderRadius: 10, background: chosen.length ? "#25D366" : "var(--card)", color: chosen.length ? "#fff" : "var(--w3)", border: chosen.length ? "none" : "1px solid var(--border)", opacity: chosen.length ? 1 : 0.6, cursor: chosen.length ? "pointer" : "not-allowed" }}>
              <MessageCircle size={14} strokeWidth={2} />
              {chosen.length ? L(`Send on WhatsApp (${chosen.length})`, `Envoyer sur WhatsApp (${chosen.length})`, `Auf WhatsApp senden (${chosen.length})`) : L("Select a document", "Choisir un document", "Dokument auswählen")}
            </a>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

"use client";

/**
 * Admin — Affiliates (supreme admin only; the API enforces it too).
 * Create referral partners, copy their share + private dashboard links, adjust
 * their per-placement commission, and mark payouts paid. The app only tracks
 * what's owed — money is paid out manually.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import {
  ArrowLeft, Plus, Copy, Check, Loader2, RefreshCw, Play, Pause, Link2, KeyRound,
} from "lucide-react";

type Affiliate = {
  id: string; code: string; name: string; email: string | null; phone: string | null;
  commission_eur: number; currency: string; active: boolean; clicks: number;
  shareUrl: string; referred: number; placed: number; owedEur: number; paidEur: number;
  termsAccepted?: boolean | null;
};
type Created = { shareUrl: string; dashUrl: string; dashUrlFallback: string; dashToken: string; name: string };

export default function AdminAffiliatesPage() {
  const router = useRouter();
  const { lang } = useLang();
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);

  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [rows, setRows] = useState<Affiliate[]>([]);
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState("");

  // create form
  const [showForm, setShowForm] = useState(false);
  const [fName, setFName] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fComm, setFComm] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  // per-row commission edits
  const [commEdit, setCommEdit] = useState<Record<string, string>>({});

  const money = (n: number, cur = "EUR") => `${cur === "EUR" ? "€" : cur + " "}${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 1600); } catch { /* ignore */ }
  };

  const load = useCallback(async (tk: string) => {
    try {
      const r = await fetch("/api/portal/admin/affiliates", { headers: { Authorization: `Bearer ${tk}` } });
      if (r.status === 401 || r.status === 403) { setForbidden(true); setLoading(false); return; }
      const j = await r.json();
      setRows(j.affiliates ?? []);
    } catch { /* keep old */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!alive) return;
      const tk = session?.access_token ?? "";
      setToken(tk);
      if (!tk) { setForbidden(true); setLoading(false); return; }
      load(tk);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => { if (s?.access_token) setToken(s.access_token); });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [load]);

  const create = async () => {
    if (!fName.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/portal/admin/affiliates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: fName.trim(), email: fEmail.trim(), phone: fPhone.trim(), commission_eur: Number(fComm) || 0 }),
      });
      const j = await r.json();
      if (r.ok) {
        setCreated({ ...j, name: fName.trim() });
        setFName(""); setFEmail(""); setFPhone(""); setFComm(""); setShowForm(false);
        load(token);
      } else { alert(j.error || "Error"); }
    } catch { alert("Error"); }
    setCreating(false);
  };

  const patch = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const r = await fetch("/api/portal/admin/affiliates", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.dashToken) setCreated({ shareUrl: "", dashUrl: j.dashUrl, dashUrlFallback: j.dashUrlFallback, dashToken: j.dashToken, name: L("New dashboard link", "Nouveau lien tableau de bord", "Neuer Dashboard-Link") });
      await load(token);
    } catch { /* ignore */ }
    setBusy("");
  };

  const markPaid = async (affiliateId: string) => {
    if (!confirm(L("Mark all owed commissions for this affiliate as PAID? Do this after you've paid them.", "Marquer toutes les commissions dues comme PAYÉES ? À faire après paiement.", "Alle fälligen Provisionen als BEZAHLT markieren? Nach der Auszahlung."))) return;
    setBusy(`pay-${affiliateId}`);
    try {
      await fetch("/api/portal/admin/affiliates/payout", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ affiliateId, all: true }),
      });
      await load(token);
    } catch { /* ignore */ }
    setBusy("");
  };

  const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)" };
  const input: React.CSSProperties = { background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--w)", padding: "10px 12px", fontSize: 13, width: "100%" };

  return (
    <div id="bv-main" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <div className="mx-auto w-full max-w-[860px] px-4 sm:px-6 py-6">
        <button onClick={() => router.push("/portal/admin")} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold mb-4" style={{ color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
          <ArrowLeft size={15} /> {L("Back", "Retour", "Zurück")}
        </button>

        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[21px] font-bold tracking-tight" style={{ color: "var(--w)" }}>{L("Affiliates", "Affiliés", "Affiliates")}</h1>
            <p className="text-[12.5px] mt-0.5" style={{ color: "var(--w3)" }}>{L("Referral partners · you pay a fixed € per nurse placed in Germany.", "Partenaires · vous payez un montant fixe par infirmière placée en Allemagne.", "Empfehlungspartner · fester € pro in Deutschland vermittelter Pflegekraft.")}</p>
          </div>
          {!forbidden && (
            <button onClick={() => { setShowForm((v) => !v); setCreated(null); }} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12.5px] font-semibold flex-shrink-0" style={{ background: "var(--gold)", color: "#1a1205", border: "none", cursor: "pointer" }}>
              <Plus size={15} /> {L("New affiliate", "Nouvel affilié", "Neuer Affiliate")}
            </button>
          )}
        </div>

        {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin" style={{ color: "var(--gold)" }} /></div>}

        {!loading && forbidden && (
          <div className="text-center py-20" style={card}>
            <p className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>{L("Supreme admin only", "Admin suprême uniquement", "Nur Super-Admin")}</p>
            <p className="text-[12.5px] mt-1" style={{ color: "var(--w3)" }}>{L("Affiliate payouts are restricted to the supreme admin.", "Les paiements d'affiliation sont réservés à l'admin suprême.", "Affiliate-Auszahlungen sind dem Super-Admin vorbehalten.")}</p>
          </div>
        )}

        {/* Created / new-link reveal (shown once) */}
        {created && (
          <div className="rounded-2xl p-4 mb-5" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
            <p className="text-[13px] font-bold" style={{ color: "var(--w)" }}>{created.name}</p>
            <p className="text-[11.5px] mt-1 mb-3" style={{ color: "var(--warning)" }}>⚠️ {L("Copy the private dashboard link now — it's shown only once.", "Copiez le lien privé maintenant — affiché une seule fois.", "Kopieren Sie den privaten Link jetzt — nur einmal sichtbar.")}</p>
            {created.shareUrl && (
              <LinkRow label={L("Referral link (share this)", "Lien de parrainage (à partager)", "Empfehlungslink (teilen)")} value={created.shareUrl} k="c-share" copied={copied} onCopy={copy} />
            )}
            <LinkRow label={L("Private dashboard (give to the affiliate)", "Tableau de bord privé (pour l'affilié)", "Privates Dashboard (für den Affiliate)")} value={created.dashUrl} k="c-dash" copied={copied} onCopy={copy} />
            <button onClick={() => setCreated(null)} className="text-[11.5px] font-semibold mt-1" style={{ color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>{L("Done", "Terminé", "Fertig")}</button>
          </div>
        )}

        {/* Create form */}
        {showForm && !forbidden && (
          <div className="p-4 mb-5" style={card}>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="text-[11px] font-semibold" style={{ color: "var(--w3)" }}>{L("Name", "Nom", "Name")} *</label><input style={input} value={fName} onChange={(e) => setFName(e.target.value)} placeholder={L("Affiliate name", "Nom de l'affilié", "Name")} /></div>
              <div><label className="text-[11px] font-semibold" style={{ color: "var(--w3)" }}>{L("Commission € / placement", "Commission € / placement", "Provision € / Vermittlung")} *</label><input style={input} type="number" min={0} value={fComm} onChange={(e) => setFComm(e.target.value)} placeholder="0" /></div>
              <div><label className="text-[11px] font-semibold" style={{ color: "var(--w3)" }}>{L("Email", "E-mail", "E-Mail")}</label><input style={input} value={fEmail} onChange={(e) => setFEmail(e.target.value)} placeholder="—" /></div>
              <div><label className="text-[11px] font-semibold" style={{ color: "var(--w3)" }}>{L("Phone", "Téléphone", "Telefon")}</label><input style={input} value={fPhone} onChange={(e) => setFPhone(e.target.value)} placeholder="—" /></div>
            </div>
            <div className="flex gap-2 mt-3">
              <button disabled={creating || !fName.trim()} onClick={create} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-semibold disabled:opacity-40" style={{ background: "var(--gold)", color: "#1a1205", border: "none", cursor: "pointer" }}>{creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {L("Create", "Créer", "Erstellen")}</button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-full text-[12.5px] font-semibold" style={{ background: "transparent", color: "var(--w3)", border: "1px solid var(--border)", cursor: "pointer" }}>{L("Cancel", "Annuler", "Abbrechen")}</button>
            </div>
          </div>
        )}

        {/* List */}
        {!loading && !forbidden && rows.length === 0 && (
          <div className="text-center py-16" style={card}><p className="text-[13px]" style={{ color: "var(--w3)" }}>{L("No affiliates yet. Create your first one.", "Aucun affilié. Créez le premier.", "Noch keine Affiliates. Erstellen Sie den ersten.")}</p></div>
        )}

        <div className="space-y-3">
          {rows.map((a) => (
            <div key={a.id} className="p-4" style={card}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-bold flex items-center gap-2 flex-wrap" style={{ color: "var(--w)" }}>
                    {a.name}
                    {!a.active && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>{L("Paused", "En pause", "Pausiert")}</span>}
                    {a.termsAccepted === true && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--success-bg, rgba(22,163,74,0.14))", color: "var(--success)" }}>{L("Terms ✓", "CGV ✓", "AGB ✓")}</span>}
                    {a.termsAccepted === false && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--warning-bg, rgba(245,158,11,0.14))", color: "var(--warning)" }}>{L("Terms pending", "CGV en attente", "AGB ausstehend")}</span>}
                  </p>
                  {(a.email || a.phone) && <p className="text-[11.5px] mt-0.5" style={{ color: "var(--w3)" }}>{[a.email, a.phone].filter(Boolean).join(" · ")}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[18px] font-bold leading-none" style={{ color: "var(--warning)" }}>{money(a.owedEur, a.currency)}</p>
                  <p className="text-[10.5px] mt-1" style={{ color: "var(--w3)" }}>{L("owed", "dû", "offen")} · {money(a.paidEur, a.currency)} {L("paid", "payé", "bezahlt")}</p>
                </div>
              </div>

              {/* stats */}
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[12px]" style={{ color: "var(--w2)" }}>
                <span>{a.clicks} {L("clicks", "clics", "Klicks")}</span>
                <span>{a.referred} {L("referred", "parrainés", "empfohlen")}</span>
                <span>{a.placed} {L("placed", "placés", "vermittelt")}</span>
                <span>{money(a.commission_eur, a.currency)} / {L("placement", "placement", "Vermittlung")}</span>
              </div>

              {/* share link */}
              <div className="flex items-center gap-2 mt-3">
                <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                  <Link2 size={13} style={{ color: "var(--gold)", flexShrink: 0 }} />
                  <span className="text-[12px] truncate" style={{ color: "var(--w2)" }}>{a.shareUrl}</span>
                </div>
                <button onClick={() => copy(a.shareUrl, `s-${a.id}`)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-[12px] font-semibold flex-shrink-0" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)", cursor: "pointer" }}>
                  {copied === `s-${a.id}` ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>

              {/* actions */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {a.owedEur > 0 && (
                  <button disabled={busy === `pay-${a.id}`} onClick={() => markPaid(a.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold disabled:opacity-50" style={{ background: "var(--gold)", color: "#1a1205", border: "none", cursor: "pointer" }}>
                    {busy === `pay-${a.id}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {L("Mark owed as paid", "Marquer dû comme payé", "Als bezahlt markieren")}
                  </button>
                )}
                <button disabled={busy === `t-${a.id}`} onClick={() => patch({ id: a.id, active: !a.active }, `t-${a.id}`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold" style={{ background: "transparent", color: "var(--w2)", border: "1px solid var(--border)", cursor: "pointer" }}>
                  {a.active ? <><Pause size={12} /> {L("Pause", "Pause", "Pausieren")}</> : <><Play size={12} /> {L("Activate", "Activer", "Aktivieren")}</>}
                </button>
                <button disabled={busy === `k-${a.id}`} onClick={() => patch({ id: a.id, regenerateToken: true }, `k-${a.id}`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold" style={{ background: "transparent", color: "var(--w2)", border: "1px solid var(--border)", cursor: "pointer" }}>
                  <KeyRound size={12} /> {L("New dashboard link", "Nouveau lien privé", "Neuer Dashboard-Link")}
                </button>
                {/* commission inline edit */}
                <span className="inline-flex items-center gap-1.5">
                  <input type="number" min={0} value={commEdit[a.id] ?? String(a.commission_eur)} onChange={(e) => setCommEdit((m) => ({ ...m, [a.id]: e.target.value }))} className="w-[70px] text-[12px]" style={{ ...input, padding: "6px 8px" }} />
                  {commEdit[a.id] !== undefined && Number(commEdit[a.id]) !== a.commission_eur && (
                    <button disabled={busy === `c-${a.id}`} onClick={() => patch({ id: a.id, commission_eur: Number(commEdit[a.id]) || 0 }, `c-${a.id}`)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11.5px] font-semibold" style={{ background: "var(--gold)", color: "#1a1205", border: "none", cursor: "pointer" }}>
                      <Check size={12} /> {L("Save €", "Enreg. €", "€ speichern")}
                    </button>
                  )}
                </span>
                <button disabled={busy === `r-${a.id}`} onClick={() => load(token)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11.5px] font-semibold ml-auto" style={{ background: "transparent", color: "var(--w3)", border: "1px solid var(--border)", cursor: "pointer" }}>
                  <RefreshCw size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LinkRow({ label, value, k, copied, onCopy }: { label: string; value: string; k: string; copied: string; onCopy: (v: string, k: string) => void }) {
  return (
    <div className="mb-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--w3)" }}>{label}</p>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 px-3 py-2 rounded-lg text-[12px] truncate" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}>{value}</div>
        <button onClick={() => onCopy(value, k)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-[12px] font-semibold flex-shrink-0" style={{ background: "var(--gold)", color: "#1a1205", border: "none", cursor: "pointer" }}>
          {copied === k ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

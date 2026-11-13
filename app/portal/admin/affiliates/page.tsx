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
  Plus, Copy, Check, Loader2, RefreshCw, Play, Pause, Link2, KeyRound, Users, ChevronDown, MessageCircle,
} from "lucide-react";
import { normalizeWaPhone, isValidWaPhone, waMeUrl } from "@/lib/waLink";
import { Modal } from "@/components/ui/Modal";
import { PageHead, Btn, Card, Field, Empty, Dot, Pager, usePaged, STATUS_TINT } from "@/components/fx/kit";

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
  // the one design: which partner's actions popup is open (view only)
  const [openId, setOpenId] = useState<string | null>(null);

  // "who referred whom" — expandable per affiliate (supreme-only, loaded on demand)
  type Referral = { name: string; arrived: boolean; status: string | null };
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, Referral[]>>({});
  const [refLoading, setRefLoading] = useState("");
  const toggleReferrals = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (refs[id]) return;
    setRefLoading(id);
    try {
      const r = await fetch(`/api/portal/admin/affiliates/${id}/referrals`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      setRefs((m) => ({ ...m, [id]: j.referrals ?? [] }));
    } catch { setRefs((m) => ({ ...m, [id]: [] })); }
    setRefLoading("");
  };

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
      // Not logged in → send to the portal login, which returns here after auth
      // (this is where the affiliate portal's "Borivon team log in" button lands).
      if (!tk) { router.replace("/portal?next=/portal/admin/affiliates"); return; }
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
      } else { alert(L("Couldn't create the affiliate. Please try again.", "Impossible de créer l'affilié. Réessayez.", "Affiliate konnte nicht erstellt werden. Bitte erneut versuchen.")); }
    } catch { alert(L("Couldn't create the affiliate. Please try again.", "Impossible de créer l'affilié. Réessayez.", "Affiliate konnte nicht erstellt werden. Bitte erneut versuchen.")); }
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

  const open = rows.find((a) => a.id === openId) ?? null;
  const short = (u: string) => u.replace(/^https?:\/\//, "");
  const alertRow = (text: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.pending, fontSize: 13, color: "var(--w)" }}>
      <Dot st="pending" />{text}
    </div>
  );

  // the one design (founder 2026-11-13): serif head, one black "new" pill, the partners as hairline rows that flip,
  // the owed sum big in serif; every per-partner action + the forms in the universal popup (LAW #36)
  return (
    <div id="bv-main" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <div className="mx-auto w-full px-4 sm:px-6 py-6" style={{ maxWidth: 760, paddingTop: 88 }}>
        <PageHead back={{ label: L("Back", "Retour", "Zurück"), onClick: () => router.push("/portal/admin") }}
          title={L("Affiliates", "Affiliés", "Affiliates")}
          sub={L("Referral partners · you pay a fixed € per nurse placed in Germany.", "Partenaires · vous payez un montant fixe par infirmière placée en Allemagne.", "Empfehlungspartner · fester € pro in Deutschland vermittelter Pflegekraft.")}
          actions={!forbidden && (<>
            <Btn kind="ghost" size="sm" icon onClick={() => load(token)} aria-label={L("Refresh", "Actualiser", "Aktualisieren")} title={L("Refresh", "Actualiser", "Aktualisieren")}><RefreshCw size={14} /></Btn>
            <Btn kind="primary" size="sm" onClick={() => { setShowForm((v) => !v); setCreated(null); }}><Plus size={14} strokeWidth={2} />{L("New affiliate", "Nouvel affilié", "Neuer Affiliate")}</Btn>
          </>)} />

        {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin" style={{ color: "var(--gold)" }} /></div>}

        {!loading && forbidden && (
          <Card>
            <Empty>
              <span style={{ color: "var(--w)", fontWeight: 500 }}>{L("Supreme admin only", "Admin suprême uniquement", "Nur Super-Admin")}</span>
              <span style={{ fontSize: 12.5, marginTop: -4 }}>{L("Affiliate payouts are restricted to the supreme admin.", "Les paiements d'affiliation sont réservés à l'admin suprême.", "Affiliate-Auszahlungen sind dem Super-Admin vorbehalten.")}</span>
            </Empty>
          </Card>
        )}

        {/* List */}
        {!loading && !forbidden && rows.length === 0 && (
          <Card><Empty>{L("No affiliates yet. Create your first one.", "Aucun affilié. Créez le premier.", "Noch keine Affiliates. Erstellen Sie den ersten.")}</Empty></Card>
        )}

        {rows.length > 0 && (
          <Paged items={rows} per={5} perPhone={3}>
            {(slice) => (
              <Card style={{ padding: "2px 18px" }}>
                {slice.map((a, i) => (
                  <div key={a.id} style={{ padding: "14px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 15, fontWeight: 500, color: "var(--w)" }}>{a.name}</span>
                          {!a.active && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--w3)" }}><Dot st="missing" size={7} />{L("Paused", "En pause", "Pausiert")}</span>}
                          {a.termsAccepted === true && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--w)" }}><Dot st="approved" size={7} />{L("Terms", "CGV", "AGB")}</span>}
                          {a.termsAccepted === false && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--w)" }}><Dot st="pending" size={7} />{L("Terms pending", "CGV en attente", "AGB ausstehend")}</span>}
                        </div>
                        {(a.email || a.phone) && <div style={{ fontSize: 12.5, color: "var(--w3)", marginTop: 2, overflowWrap: "anywhere" }}>{[a.email, a.phone].filter(Boolean).join(" · ")}</div>}
                        <div style={{ fontSize: 12.5, color: "var(--w2)", marginTop: 6 }}>
                          {a.clicks} {L("clicks", "clics", "Klicks")} · {a.referred} {L("referred", "parrainés", "empfohlen")} · {a.placed} {L("placed", "placés", "vermittelt")} · {money(a.commission_eur, a.currency)} / {L("placement", "placement", "Vermittlung")}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flex: "none" }}>
                        <div style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 26, lineHeight: 1, color: "var(--w)" }}>{money(a.owedEur, a.currency)}</div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--w3)", marginTop: 6 }}>
                          {a.owedEur > 0 && <Dot st="pending" size={7} />}{L("owed", "dû", "offen")} · {money(a.paidEur, a.currency)} {L("paid", "payé", "bezahlt")}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                      <Btn kind="ghost" size="sm" onClick={() => copy(a.shareUrl, `s-${a.id}`)} title={a.shareUrl}
                        style={{ flex: "0 1 auto", minWidth: 0, justifyContent: "flex-start" }}>
                        <Link2 size={13} style={{ color: "var(--gold)", flex: "none" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{short(a.shareUrl)}</span>
                        {copied === `s-${a.id}` ? <Check size={13} style={{ flex: "none" }} /> : <Copy size={13} style={{ flex: "none", color: "var(--w3)" }} />}
                      </Btn>
                      <Btn kind="ghost" size="sm" onClick={() => setOpenId(a.id)} style={{ marginLeft: "auto", flex: "none" }}>
                        {L("Manage", "Gérer", "Verwalten")}
                      </Btn>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </Paged>
        )}
      </div>

      {/* One partner: every action, as before — the universal popup */}
      <Modal open={!!open} onClose={() => setOpenId(null)} size="md" chromeless>
        {open && (() => {
          const a = open;
          const wa = a.owedEur > 0 && isValidWaPhone(normalizeWaPhone(a.phone));
          return (
            <div style={{ padding: 22 }}>
              <PopHead title={a.name} sub={`${money(a.owedEur, a.currency)} ${L("owed", "dû", "offen")} · ${money(a.paidEur, a.currency)} ${L("paid", "payé", "bezahlt")}`} onClose={() => setOpenId(null)} closeLabel={L("Close", "Fermer", "Schließen")} />

              {a.owedEur > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                  <Btn kind="primary" size="sm" disabled={busy === `pay-${a.id}`} onClick={() => markPaid(a.id)}>
                    {busy === `pay-${a.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {L("Mark owed as paid", "Marquer dû comme payé", "Als bezahlt markieren")}
                  </Btn>
                  {/* Tell the affiliate on WhatsApp (compose-only — you send it). Shown
                      when there's money owed and a valid phone. */}
                  {wa && (() => {
                    const d = normalizeWaPhone(a.phone);
                    const m = money(a.owedEur, a.currency);
                    const msg = L(
                      `Hi ${a.name}, this is Borivon. Your affiliate commission of ${m} for ${a.placed} placement(s) is ready — let's arrange your payout. Thank you for your referrals!`,
                      `Bonjour ${a.name}, ici Borivon. Votre commission d'affilié de ${m} pour ${a.placed} placement(s) est prête — organisons votre paiement. Merci pour vos parrainages !`,
                      `Hallo ${a.name}, hier ist Borivon. Ihre Affiliate-Provision von ${m} für ${a.placed} Vermittlung(en) ist bereit — wir veranlassen die Auszahlung. Danke für Ihre Empfehlungen!`,
                    );
                    return (
                      <a href={waMeUrl(d, msg)} target="_blank" rel="noopener noreferrer" className="bvk-btn bvk-ghost bvk-sm">
                        <MessageCircle size={13} style={{ color: "#16a34a" }} /> WhatsApp
                      </a>
                    );
                  })()}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn kind="ghost" size="sm" disabled={busy === `t-${a.id}`} onClick={() => patch({ id: a.id, active: !a.active }, `t-${a.id}`)}>
                  {a.active ? <><Pause size={13} /> {L("Pause", "Pause", "Pausieren")}</> : <><Play size={13} /> {L("Activate", "Activer", "Aktivieren")}</>}
                </Btn>
                <Btn kind="ghost" size="sm" disabled={busy === `k-${a.id}`} onClick={() => patch({ id: a.id, regenerateToken: true }, `k-${a.id}`)}>
                  <KeyRound size={13} /> {L("New dashboard link", "Nouveau lien privé", "Neuer Dashboard-Link")}
                </Btn>
              </div>

              {/* commission inline edit */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 16 }}>
                <div style={{ width: 240, maxWidth: "100%" }}>
                  <Field label={L("Commission € / placement", "Commission € / placement", "Provision € / Vermittlung")}>
                    <input type="number" min={0} className="bvk-input" value={commEdit[a.id] ?? String(a.commission_eur)} onChange={(e) => setCommEdit((m) => ({ ...m, [a.id]: e.target.value }))} />
                  </Field>
                </div>
                {commEdit[a.id] !== undefined && Number(commEdit[a.id]) !== a.commission_eur && (
                  <Btn kind="ghost" disabled={busy === `c-${a.id}`} onClick={() => patch({ id: a.id, commission_eur: Number(commEdit[a.id]) || 0 }, `c-${a.id}`)}>
                    <Check size={13} /> {L("Save €", "Enreg. €", "€ speichern")}
                  </Btn>
                )}
              </div>

              {/* Who referred whom — supreme-admin-only visibility (affiliates never see this). */}
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <Btn kind="quiet" size="sm" onClick={() => toggleReferrals(a.id)} aria-expanded={expanded === a.id} style={{ color: "var(--w)", fontWeight: 600 }}>
                  <Users size={13} /> {L("Who referred", "Qui a parrainé", "Wer empfahl")}
                  <ChevronDown size={13} style={{ transition: "transform .18s", transform: expanded === a.id ? "rotate(180deg)" : "none" }} />
                </Btn>
                {expanded === a.id && (
                  <div style={{ marginTop: 10 }}>
                    {refLoading === a.id ? (
                      <div className="flex justify-center py-3"><Loader2 size={15} className="animate-spin" style={{ color: "var(--gold)" }} /></div>
                    ) : (refs[a.id]?.length ?? 0) === 0 ? (
                      <p style={{ fontSize: 12.5, color: "var(--w3)", padding: "4px 0" }}>{L("No referred candidates yet.", "Aucun candidat parrainé pour l'instant.", "Noch keine empfohlenen Kandidaten.")}</p>
                    ) : (
                      <Paged items={refs[a.id].map((c, i) => ({ c, i }))} per={6} perPhone={5}>
                        {(slice) => (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {slice.map(({ c, i }) => {
                              const label = c.status === "paid"
                                ? { t: L("Paid", "Payé", "Bezahlt"), st: "approved" as const }
                                : c.status === "owed"
                                ? { t: L("Owed", "Dû", "Offen"), st: "pending" as const }
                                : c.arrived
                                ? { t: L("Placed", "Placé", "Vermittelt"), st: "pending" as const }
                                : { t: L("Referred", "Parrainé", "Empfohlen"), st: "missing" as const };
                              return (
                                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 14px", borderRadius: 12,
                                  background: STATUS_TINT[label.st], border: label.st === "missing" ? "1px solid var(--border)" : "1px solid transparent" }}>
                                  <span style={{ fontSize: 13.5, color: "var(--w)" }}>{c.name}</span>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: label.st === "missing" ? "var(--w3)" : "var(--w)" }}>{label.t}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </Paged>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Create form — the universal popup */}
      <Modal open={showForm && !forbidden} onClose={() => setShowForm(false)} size="sm" chromeless busy={creating}>
        <div style={{ padding: 22 }}>
          <PopHead title={L("New affiliate", "Nouvel affilié", "Neuer Affiliate")} onClose={() => setShowForm(false)} closeLabel={L("Close", "Fermer", "Schließen")} disabled={creating} />
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={`${L("Name", "Nom", "Name")} *`}><input className="bvk-input" value={fName} onChange={(e) => setFName(e.target.value)} placeholder={L("Affiliate name", "Nom de l'affilié", "Name")} autoFocus /></Field>
            <Field label={`${L("Commission € / placement", "Commission € / placement", "Provision € / Vermittlung")} *`}><input className="bvk-input" type="number" min={0} value={fComm} onChange={(e) => setFComm(e.target.value)} placeholder="0" /></Field>
            <Field label={L("Email", "E-mail", "E-Mail")}><input className="bvk-input" value={fEmail} onChange={(e) => setFEmail(e.target.value)} placeholder="—" /></Field>
            <Field label={L("Phone", "Téléphone", "Telefon")}><input className="bvk-input" value={fPhone} onChange={(e) => setFPhone(e.target.value)} placeholder="—" /></Field>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <Btn kind="ghost" onClick={() => setShowForm(false)} disabled={creating} style={{ flex: 1 }}>{L("Cancel", "Annuler", "Abbrechen")}</Btn>
            <Btn kind="primary" disabled={creating || !fName.trim()} onClick={create} style={{ flex: 1 }}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {L("Create", "Créer", "Erstellen")}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Created / new-link reveal (shown once) — only "Done" closes it */}
      <Modal open={!!created} onClose={() => { /* the private link is shown once: only "Done" closes this */ }} closeOnBackdrop={false} size="sm" chromeless>
        {created && (
          <div style={{ padding: 22 }}>
            <h2 style={{ margin: "0 0 10px", fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, lineHeight: 1.15, color: "var(--w)" }}>{created.name}</h2>
            <div style={{ marginBottom: 14 }}>{alertRow(L("Copy the private dashboard link now — it's shown only once.", "Copiez le lien privé maintenant — affiché une seule fois.", "Kopieren Sie den privaten Link jetzt — nur einmal sichtbar."))}</div>
            {created.shareUrl && (
              <LinkRow label={L("Referral link (share this)", "Lien de parrainage (à partager)", "Empfehlungslink (teilen)")} value={created.shareUrl} k="c-share" copied={copied} onCopy={copy} />
            )}
            <LinkRow label={L("Private dashboard (give to the affiliate)", "Tableau de bord privé (pour l'affilié)", "Privates Dashboard (für den Affiliate)")} value={created.dashUrl} k="c-dash" copied={copied} onCopy={copy} />
            <Btn kind="primary" onClick={() => setCreated(null)} style={{ width: "100%", marginTop: 8 }}>{L("Done", "Terminé", "Fertig")}</Btn>
          </div>
        )}
      </Modal>
    </div>
  );
}

function LinkRow({ label, value, k, copied, onCopy }: { label: string; value: string; k: string; copied: string; onCopy: (v: string, k: string) => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Field label={label}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="bvk-input" style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 13 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
          </span>
          <Btn kind="ghost" icon onClick={() => onCopy(value, k)} aria-label="Copy" style={{ flex: "none" }}>
            {copied === k ? <Check size={14} /> : <Copy size={14} />}
          </Btn>
        </span>
      </Field>
    </div>
  );
}

/** popup head in the one look: serif title, quiet sub, round close */
function PopHead({ title, sub, onClose, closeLabel, disabled }: { title: string; sub?: string; onClose: () => void; closeLabel: string; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, lineHeight: 1.15, color: "var(--w)", overflowWrap: "anywhere" }}>{title}</h2>
        {sub && <div style={{ marginTop: 3, fontSize: 12.5, color: "var(--w3)" }}>{sub}</div>}
      </div>
      <button type="button" onClick={onClose} disabled={disabled} aria-label={closeLabel}
        style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--w3)", cursor: "pointer", flex: "none", fontFamily: "inherit" }}>✕</button>
    </div>
  );
}

/** lists flip instead of scrolling (components/fx/kit usePaged + Pager) */
function Paged<I>({ items, per, perPhone, children }: { items: I[]; per: number; perPhone: number; children: (slice: I[]) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, per, perPhone);
  return <>{children(slice)}<Pager page={page} pages={pages} onPage={setPage} /></>;
}

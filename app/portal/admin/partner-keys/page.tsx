"use client";

/**
 * Partner API keys — issue, see, revoke.
 *
 * Supreme admin only. A key here lets an outside company read the documents of
 * every candidate that has been shared with them, passports included, so the
 * page is written to make that weight obvious rather than to look tidy:
 * creating one takes a deliberate second step, the key is shown once and framed
 * as something to copy NOW, and revoking is one click with no confirmation
 * theatre — cutting access off should never be the slow path.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { ArrowLeft, KeyRound, Copy, Check, Trash2, Loader2, TriangleAlert } from "lucide-react";

type Key = {
  id: string; orgId: string; agency: string | null; prefix: string; label: string;
  createdAt: string; createdBy: string | null; lastUsedAt: string | null; revokedAt: string | null;
};
type Org = { id: string; name: string };

export default function PartnerKeysPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);

  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [keys, setKeys] = useState<Key[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [needsMigration, setNeedsMigration] = useState(false);

  const [orgId, setOrgId] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ key: string; agency: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load(tk: string) {
    const r = await fetch("/api/portal/admin/partner-keys", { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json().catch(() => ({}));
    setKeys((j.keys ?? []) as Key[]);
    setOrgs((j.organizations ?? []) as Org[]);
    setNeedsMigration(!!j.needsMigration);
    if (!orgId && (j.organizations ?? []).length === 1) setOrgId((j.organizations as Org[])[0].id);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      if (cancelled) return;
      setToken(tk);
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } });
      const rj = await roleRes.json().catch(() => ({}));
      // Supreme admin ONLY: minting a key is deciding who may read passports.
      if (rj?.role !== "admin") { router.replace("/portal"); return; }
      await load(tk);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createKey() {
    if (!orgId) return;
    setCreating(true); setErr(null); setFresh(null); setCopied(false);
    try {
      const r = await fetch("/api/portal/admin/partner-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId, label }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.hint ?? j?.error ?? "failed"); }
      else { setFresh({ key: j.key, agency: j.agency }); setLabel(""); await load(token); }
    } catch { setErr("network"); }
    setCreating(false);
  }

  async function revoke(id: string) {
    setBusy(id); setErr(null);
    try {
      const r = await fetch("/api/portal/admin/partner-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      if (r.ok) await load(token); else setErr("revoke_failed");
    } catch { setErr("network"); }
    setBusy(null);
  }

  const fmt = (iso: string | null) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  };

  if (loading) return <PageLoader />;

  const live = keys.filter((k) => !k.revokedAt);
  const dead = keys.filter((k) => k.revokedAt);

  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 780 }}>
      <button onClick={() => router.push("/portal/admin")} className="bv-btn bv-btn-ghost mb-6 inline-flex">
        <ArrowLeft size={15} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
      </button>

      <h1 className="bv-h1">{T("Partner keys", "Partner-Schlüssel", "Clés partenaires")}</h1>
      <p className="bv-body mt-1 mb-6">
        {T("A key lets a partner agency's system pull the documents of every candidate you have sent to them. Nothing else.",
           "Ein Schlüssel erlaubt dem System einer Partneragentur, die Unterlagen aller an sie gesendeten Kandidatinnen abzurufen. Sonst nichts.",
           "Une clé permet au système d'une agence partenaire de récupérer les documents des candidates que vous lui avez envoyées. Rien d'autre.")}
      </p>

      {needsMigration && (
        <div className="p-4 mb-6 rounded-2xl text-[13px]" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
          {T("Run supabase/partner_api.sql first — the tables do not exist yet.",
             "Zuerst supabase/partner_api.sql ausführen — die Tabellen fehlen noch.",
             "Exécutez d'abord supabase/partner_api.sql — les tables n'existent pas encore.")}
        </div>
      )}

      {/* THE KEY, shown once. Deliberately loud and deliberately not dismissible
          by accident: once this box is gone the value is unrecoverable. */}
      {fresh && (
        <div className="p-4 mb-6 rounded-2xl" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
          <p className="text-[13px] font-semibold mb-1 inline-flex items-center gap-1.5" style={{ color: "var(--gold)" }}>
            <TriangleAlert size={14} strokeWidth={2.2} />
            {T(`Key for ${fresh.agency} — copy it now`, `Schlüssel für ${fresh.agency} — jetzt kopieren`, `Clé pour ${fresh.agency} — copiez-la maintenant`)}
          </p>
          <p className="text-[12px] mb-3" style={{ color: "var(--w2)" }}>
            {T("This is the only time it can be seen. If you lose it, revoke this one and make another.",
               "Dies ist das einzige Mal, dass er sichtbar ist. Bei Verlust diesen widerrufen und einen neuen erstellen.",
               "C'est la seule fois où elle est visible. Si vous la perdez, révoquez-la et créez-en une autre.")}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12px] px-3 py-2.5 rounded-xl break-all"
              style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>{fresh.key}</code>
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(fresh.key); setCopied(true); setTimeout(() => setCopied(false), 2000); }
                catch { /* clipboard blocked — the value is on screen to select */ }
              }}
              className="bv-btn bv-btn-ghost bv-tap text-[12px] inline-flex items-center gap-1.5 flex-shrink-0">
              {copied ? <><Check size={13} /> {T("Copied", "Kopiert", "Copié")}</> : <><Copy size={13} /> {T("Copy", "Kopieren", "Copier")}</>}
            </button>
          </div>
          <p className="text-[11.5px] mt-3" style={{ color: "var(--w3)" }}>
            {T("Send it to them privately, with docs/PARTNER_API.md. Never in a group chat.",
               "Privat zusammen mit docs/PARTNER_API.md senden. Niemals in einem Gruppenchat.",
               "Envoyez-la en privé avec docs/PARTNER_API.md. Jamais dans un groupe.")}
          </p>
        </div>
      )}

      {/* Create */}
      <div className="p-4 mb-8 rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-[13px] font-semibold mb-3" style={{ color: "var(--w)" }}>
          {T("New key", "Neuer Schlüssel", "Nouvelle clé")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-xl text-[13px] outline-none"
            style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}>
            <option value="">{T("Which agency?", "Welche Agentur?", "Quelle agence ?")}</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder={T("Note (optional) — e.g. their developer's name", "Notiz (optional)", "Note (optionnel)")}
            className="flex-1 px-3 py-2.5 rounded-xl text-[13px] outline-none"
            style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }} />
          <button onClick={createKey} disabled={!orgId || creating}
            className="bv-glow-gold bv-press px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
            style={{ background: "var(--gold)", color: "#131312" }}>
            {creating ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} strokeWidth={2.2} />}
            {T("Create", "Erstellen", "Créer")}
          </button>
        </div>
        {err && <p className="text-[12px] mt-2" style={{ color: "var(--danger)" }} role="alert">{err}</p>}
      </div>

      {/* Live keys */}
      {live.length === 0 ? (
        <p className="text-[13px] text-center py-8" style={{ color: "var(--w3)" }}>
          {T("No keys yet. Nobody outside Borivon can read anything.",
             "Noch keine Schlüssel. Niemand außerhalb von Borivon kann etwas lesen.",
             "Aucune clé. Personne en dehors de Borivon ne peut rien lire.")}
        </p>
      ) : (
        <div className="space-y-2.5">
          {live.map((k) => (
            <div key={k.id} className="p-4 rounded-2xl flex items-start justify-between gap-3"
              style={{ background: "var(--card)", border: "1px solid var(--border-gold)" }}>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>{k.agency ?? "—"}</p>
                <code className="text-[11.5px]" style={{ color: "var(--w3)" }}>{k.prefix}…</code>
                {k.label && <p className="text-[12px] mt-0.5" style={{ color: "var(--w2)" }}>{k.label}</p>}
                <p className="text-[11px] mt-1" style={{ color: "var(--w3)" }}>
                  {T("Created", "Erstellt", "Créée")} {fmt(k.createdAt)}
                  {" · "}
                  {/* "Never used" is the useful signal: it means their side has
                      not been wired up yet, or the key never reached them. */}
                  {k.lastUsedAt
                    ? `${T("last used", "zuletzt genutzt", "dernière utilisation")} ${fmt(k.lastUsedAt)}`
                    : T("never used", "nie genutzt", "jamais utilisée")}
                </p>
              </div>
              <button onClick={() => revoke(k.id)} disabled={busy === k.id}
                title={T("Revoke — takes effect immediately", "Widerrufen — sofort wirksam", "Révoquer — effet immédiat")}
                className="bv-btn bv-btn-ghost bv-tap text-[12px] inline-flex items-center gap-1.5 flex-shrink-0"
                style={{ color: "var(--danger)" }}>
                {busy === k.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {T("Revoke", "Widerrufen", "Révoquer")}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Revoked keys are kept, not deleted: they are the record of who was ever
          given access, which is the question that matters after the fact. */}
      {dead.length > 0 && (
        <>
          <p className="text-[12px] mt-8 mb-2" style={{ color: "var(--w3)" }}>
            {T("Revoked", "Widerrufen", "Révoquées")} ({dead.length})
          </p>
          <div className="space-y-2">
            {dead.map((k) => (
              <div key={k.id} className="p-3 rounded-xl" style={{ background: "var(--bg2)", border: "1px solid var(--border)", opacity: 0.6 }}>
                <span className="text-[12.5px]" style={{ color: "var(--w2)" }}>{k.agency ?? "—"}</span>
                <code className="text-[11px] ml-2" style={{ color: "var(--w3)" }}>{k.prefix}…</code>
                <span className="text-[11px] ml-2" style={{ color: "var(--w3)" }}>
                  {T("revoked", "widerrufen", "révoquée")} {fmt(k.revokedAt)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

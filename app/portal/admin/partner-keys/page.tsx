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
import { KeyRound, Copy, Check, Trash2, Loader2 } from "lucide-react";
import { PageHead, Btn, Card, Dot, Empty, Pager, usePaged, STATUS_TINT } from "@/components/fx/kit";

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
  const mono: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };

  // the one design (founder 2026-11-13): serif head, the new-key form in one paper card with one black pill,
  // the keys as hairline rows that flip; the fresh key stays loud (orange, shown once) — never a popup that
  // could be closed by accident
  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 720, paddingTop: 88 }}>
      <PageHead back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
        title={T("Partner keys", "Partner-Schlüssel", "Clés partenaires")}
        sub={T("A key lets a partner agency's system pull the documents of the candidates sent to them — nothing else.",
               "Ein Schlüssel lässt das System einer Partneragentur die Unterlagen der an sie gesendeten Kandidatinnen abrufen — sonst nichts.",
               "Une clé permet au système d'une agence partenaire de récupérer les documents des candidates envoyées — rien d'autre.")} />

      {needsMigration && (
        <div role="alert" style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)" }}>
          {T("Run supabase/partner_api.sql first — the tables do not exist yet.",
             "Zuerst supabase/partner_api.sql ausführen — die Tabellen fehlen noch.",
             "Exécutez d'abord supabase/partner_api.sql — les tables n'existent pas encore.")}
        </div>
      )}

      {/* THE KEY, shown once. Deliberately loud and deliberately not dismissible
          by accident: once this box is gone the value is unrecoverable. */}
      {fresh && (
        <div style={{ marginBottom: 14, padding: 16, borderRadius: 16, background: STATUS_TINT.pending }}>
          <p style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: "var(--w)" }}>
            <Dot st="pending" />
            {T(`Key for ${fresh.agency} — copy it now`, `Schlüssel für ${fresh.agency} — jetzt kopieren`, `Clé pour ${fresh.agency} — copiez-la maintenant`)}
          </p>
          <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--w2)" }}>
            {T("This is the only time it can be seen. If you lose it, revoke this one and make another.",
               "Dies ist das einzige Mal, dass er sichtbar ist. Bei Verlust diesen widerrufen und einen neuen erstellen.",
               "C'est la seule fois où elle est visible. Si vous la perdez, révoquez-la et créez-en une autre.")}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code className="bvk-input" style={{ ...mono, display: "flex", alignItems: "center", flex: 1, minWidth: 0, height: "auto", minHeight: 42, padding: "9px 12px", fontSize: 12.5, wordBreak: "break-all", background: "var(--card)", userSelect: "all" }}>{fresh.key}</code>
            <Btn kind="primary" style={{ flex: "none" }}
              onClick={async () => {
                try { await navigator.clipboard.writeText(fresh.key); setCopied(true); setTimeout(() => setCopied(false), 2000); }
                catch { /* clipboard blocked — the value is on screen to select */ }
              }}>
              {copied ? <><Check size={14} /> {T("Copied", "Kopiert", "Copié")}</> : <><Copy size={14} /> {T("Copy", "Kopieren", "Copier")}</>}
            </Btn>
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--w3)" }}>
            {T("Send it to them privately, with docs/PARTNER_API.md. Never in a group chat.",
               "Privat zusammen mit docs/PARTNER_API.md senden. Niemals in einem Gruppenchat.",
               "Envoyez-la en privé avec docs/PARTNER_API.md. Jamais dans un groupe.")}
          </p>
        </div>
      )}

      {/* Create */}
      <Card style={{ padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--w)", marginBottom: 10 }}>{T("New key", "Neuer Schlüssel", "Nouvelle clé")}</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="bvk-input" style={{ flex: 1, minHeight: 42 }}>
            <option value="">{T("Which agency?", "Welche Agentur?", "Quelle agence ?")}</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder={T("Note (optional) — e.g. their developer's name", "Notiz (optional)", "Note (optionnel)")}
            className="bvk-input" style={{ flex: 1, minHeight: 42 }} />
          <Btn kind="primary" onClick={createKey} disabled={!orgId || creating} style={{ flex: "none" }}>
            {creating ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} strokeWidth={2.2} />}
            {T("Create", "Erstellen", "Créer")}
          </Btn>
        </div>
        {err && <div role="alert" style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)" }}>{err}</div>}
      </Card>

      {/* Live keys */}
      {live.length === 0 ? (
        <Card><Empty>{T("No keys yet. Nobody outside Borivon can read anything.",
             "Noch keine Schlüssel. Niemand außerhalb von Borivon kann etwas lesen.",
             "Aucune clé. Personne en dehors de Borivon ne peut rien lire.")}</Empty></Card>
      ) : (
        <Paged items={live} per={5} perPhone={3}>
          {(slice) => (
            <Card style={{ padding: "2px 16px" }}>
              {slice.map((k, i) => (
                <div key={k.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "13px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {/* green = in use · orange = never used yet (their side may not be wired up) */}
                      <Dot st={k.lastUsedAt ? "approved" : "pending"} size={8} />
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--w)" }}>{k.agency ?? "—"}</span>
                      <code style={{ ...mono, fontSize: 12, color: "var(--w3)" }}>{k.prefix}…</code>
                    </div>
                    {k.label && <div style={{ fontSize: 12.5, marginTop: 2, color: "var(--w2)" }}>{k.label}</div>}
                    <div style={{ fontSize: 12, marginTop: 3, color: "var(--w3)" }}>
                      {T("Created", "Erstellt", "Créée")} {fmt(k.createdAt)}
                      {" · "}
                      {/* "Never used" is the useful signal: it means their side has
                          not been wired up yet, or the key never reached them. */}
                      {k.lastUsedAt
                        ? `${T("last used", "zuletzt genutzt", "dernière utilisation")} ${fmt(k.lastUsedAt)}`
                        : T("never used", "nie genutzt", "jamais utilisée")}
                    </div>
                  </div>
                  <Btn kind="danger" size="sm" onClick={() => revoke(k.id)} disabled={busy === k.id} style={{ flex: "none" }}
                    title={T("Revoke — takes effect immediately", "Widerrufen — sofort wirksam", "Révoquer — effet immédiat")}>
                    {busy === k.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    {T("Revoke", "Widerrufen", "Révoquer")}
                  </Btn>
                </div>
              ))}
            </Card>
          )}
        </Paged>
      )}

      {/* Revoked keys are kept, not deleted: they are the record of who was ever
          given access, which is the question that matters after the fact. */}
      {dead.length > 0 && (
        <>
          <div style={{ fontSize: 12.5, color: "var(--w3)", margin: "18px 0 8px 2px" }}>
            {T("Revoked", "Widerrufen", "Révoquées")} ({dead.length})
          </div>
          <Paged items={dead} per={3} perPhone={2}>
            {(slice) => (
              <Card style={{ padding: "2px 16px" }}>
                {slice.map((k, i) => (
                  <div key={k.id} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 10px", padding: "10px 0", borderTop: i ? "1px solid var(--border)" : "none", opacity: 0.6 }}>
                    <Dot st="missing" size={8} />
                    <span style={{ fontSize: 13, color: "var(--w2)" }}>{k.agency ?? "—"}</span>
                    <code style={{ ...mono, fontSize: 11.5, color: "var(--w3)" }}>{k.prefix}…</code>
                    <span style={{ fontSize: 12, color: "var(--w3)" }}>{T("revoked", "widerrufen", "révoquée")} {fmt(k.revokedAt)}</span>
                  </div>
                ))}
              </Card>
            )}
          </Paged>
        </>
      )}
    </main>
  );
}

/** lists flip instead of scrolling (components/fx/kit usePaged + Pager) */
function Paged<I>({ items, per, perPhone, children }: { items: I[]; per: number; perPhone: number; children: (slice: I[]) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, per, perPhone);
  return <>{children(slice)}<Pager page={page} pages={pages} onPage={setPage} /></>;
}

"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Search, KeyRound, Copy, Check, X, Eye } from "lucide-react";
import { PageHead, Btn, Card, Dot, Field, Empty, Pager, usePaged, STATUS_TINT } from "@/components/fx/kit";

type U = { id: string; email: string; name: string; role: string; kind: "borivon" | "org" | "candidate"; photo: string | null };
type ResetResult = { email: string; password: string; sessionsRevoked: number };

export default function ResetPasswordPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);

  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [users, setUsers] = useState<U[]>([]);
  const [q, setQ] = useState("");
  const [confirmUser, setConfirmUser] = useState<U | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(ResetResult & { name: string }) | null>(null);
  // Keep every password generated THIS PAGE SESSION (in memory only — never the
  // DB) so closing the modal isn't a dead end: re-open any of them from the list.
  const [lastResults, setLastResults] = useState<Record<string, ResetResult & { name: string }>>({});
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      // Server confirms supreme-admin — never trust a client email compare.
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } });
      const { role } = await roleRes.json().catch(() => ({ role: null }));
      if (role !== "admin") { router.replace("/portal"); return; }
      setToken(tk);
      const uRes = await fetch("/api/portal/admin/users", { headers: { Authorization: `Bearer ${tk}` } });
      const uJson = await uRes.json().catch(() => ({ users: [] }));
      setUsers(uJson.users ?? []);
      setLoading(false);
    });
  }, [router]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users.slice(0, 50);
    return users.filter(u => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)).slice(0, 50);
  }, [q, users]);

  async function doReset() {
    if (!confirmUser) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/portal/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: confirmUser.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || T("Reset failed", "Zurücksetzen fehlgeschlagen", "Échec")); setBusy(false); return; }
      const r = { name: confirmUser.name || confirmUser.email, email: j.email, password: j.password, sessionsRevoked: j.sessionsRevoked ?? 0 };
      setLastResults(prev => ({ ...prev, [confirmUser.id]: r }));
      setResult(r);
      setConfirmUser(null);
    } catch {
      setErr(T("Reset failed", "Zurücksetzen fehlgeschlagen", "Échec"));
    }
    setBusy(false);
  }

  // the account type as a quiet small word (the one design: no bordered micro-badges)
  const kindTag = (k: U["kind"]) => {
    const map = { borivon: T("Borivon", "Borivon", "Borivon"), org: T("Org", "Org", "Org"), candidate: T("Candidate", "Kandidat", "Candidat") };
    return <span style={{ fontSize: 12, fontWeight: 600, color: "var(--w3)", flex: "none" }}>{map[k]}</span>;
  };

  if (loading) return <PageLoader />;

  // popup panel in the one look (LAW #36: z-1100, blur 8, radius 20)
  const panel: CSSProperties = { borderRadius: 20, border: "1px solid var(--border)", background: "var(--card)", boxShadow: "var(--shadow-lg)" };
  const h2: CSSProperties = { margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, lineHeight: 1.15, color: "var(--w)" };

  // the one design (founder 2026-11-13): serif head, one search field, the people as hairline rows that flip
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6" style={{ paddingTop: 88 }}>
      <PageHead back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.back() }}
        title={T("Reset a password", "Passwort zurücksetzen", "Réinitialiser un mot de passe")}
        sub={T("A new password without email — the user is signed out everywhere. Shown once.",
               "Neues Passwort ohne E-Mail — der Nutzer wird überall abgemeldet. Wird einmal angezeigt.",
               "Nouveau mot de passe sans e-mail — l'utilisateur est déconnecté partout. Affiché une fois.")} />

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
        <input className="bvk-input" value={q} onChange={e => setQ(e.target.value)} placeholder={T("Search by name or email…", "Nach Name oder E-Mail suchen…", "Rechercher par nom ou e-mail…")}
          style={{ paddingLeft: 36 }} autoFocus />
      </div>

      {/* User list */}
      {filtered.length === 0 ? (
        <Card><Empty>{T("No users match.", "Keine Treffer.", "Aucun résultat.")}</Empty></Card>
      ) : (
        <Paged items={filtered} per={8} perPhone={6}>
          {(slice) => (
            <Card style={{ padding: "2px 16px" }}>
              {slice.map((u, i) => (
                <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name || T("(no name)", "(kein Name)", "(sans nom)")}</span>
                      {kindTag(u.kind)}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--w3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
                    {lastResults[u.id] && (
                      <Btn kind="quiet" size="sm" onClick={() => { setCopied(false); setResult(lastResults[u.id]); }}
                        title={T("Show the password set this session", "Diese Sitzung gesetztes Passwort anzeigen", "Voir le mot de passe défini cette session")}>
                        <Eye size={13} /> {T("Show", "Anzeigen", "Voir")}
                      </Btn>
                    )}
                    <Btn kind="ghost" size="sm" onClick={() => { setErr(""); setConfirmUser(u); }}>
                      <KeyRound size={13} /> {T("Reset", "Zurücksetzen", "Réinit.")}
                    </Btn>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </Paged>
      )}
      {users.length > 50 && !q.trim() && (
        <p style={{ fontSize: 12, marginTop: 8, color: "var(--w3)" }}>{T("Showing first 50 — search to narrow.", "Erste 50 — zum Eingrenzen suchen.", "50 premiers — affinez la recherche.")}</p>
      )}

      {/* Confirm modal */}
      {confirmUser && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }} onClick={() => !busy && setConfirmUser(null)}>
          <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ ...panel, maxWidth: 420, width: "100%", padding: 22 }}>
            <h2 style={{ ...h2, marginBottom: 10 }}>{T("Reset this password?", "Passwort zurücksetzen?", "Réinitialiser ?")}</h2>
            <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--w2)", margin: "0 0 10px", overflowWrap: "anywhere" }}>
              {T("A new password will be generated for", "Es wird ein neues Passwort erstellt für", "Un nouveau mot de passe sera généré pour")}{" "}
              <b style={{ color: "var(--w)", fontWeight: 600 }}>{confirmUser.name || confirmUser.email}</b> ({confirmUser.email}).
            </p>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.pending, fontSize: 13, lineHeight: 1.45, color: "var(--w)", marginBottom: 14 }}>
              <span style={{ marginTop: 5 }}><Dot st="pending" size={8} /></span>
              {T("Their old password stops working immediately and they'll be signed out of every device.",
                 "Das alte Passwort funktioniert sofort nicht mehr und der Nutzer wird von allen Geräten abgemeldet.",
                 "Son ancien mot de passe cesse de fonctionner et il sera déconnecté de tous ses appareils.")}
            </div>
            {err && <div role="alert" style={{ padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)", marginBottom: 12 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <Btn kind="ghost" onClick={() => setConfirmUser(null)} disabled={busy} style={{ flex: 1 }}>{T("Cancel", "Abbrechen", "Annuler")}</Btn>
              <Btn kind="primary" onClick={doReset} disabled={busy} style={{ flex: 1 }}>
                <KeyRound size={14} /> {busy ? T("Resetting…", "Wird zurückgesetzt…", "En cours…") : T("Reset password", "Zurücksetzen", "Réinitialiser")}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* Result modal — password shown once */}
      {result && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div role="dialog" aria-modal="true" style={{ ...panel, maxWidth: 440, width: "100%", padding: 22 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
              <h2 style={{ ...h2, display: "flex", alignItems: "center", gap: 10 }}><Dot st="approved" />{T("Password reset", "Passwort zurückgesetzt", "Mot de passe réinitialisé")}</h2>
              <button type="button" onClick={() => { setResult(null); setCopied(false); }} aria-label="close"
                style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--w3)", cursor: "pointer", flex: "none", display: "grid", placeItems: "center" }}><X size={15} /></button>
            </div>
            <p style={{ fontSize: 13.5, margin: "0 0 2px", color: "var(--w2)", overflowWrap: "anywhere" }}>{result.name} · {result.email}</p>
            <p style={{ fontSize: 12.5, margin: "0 0 14px", color: "var(--w3)" }}>
              {result.sessionsRevoked > 0
                ? T(`Signed out of ${result.sessionsRevoked} device(s).`, `Von ${result.sessionsRevoked} Gerät(en) abgemeldet.`, `Déconnecté de ${result.sessionsRevoked} appareil(s).`)
                : T("No active devices to sign out.", "Keine aktiven Geräte abzumelden.", "Aucun appareil actif à déconnecter.")}
            </p>

            <Field label={T("New password", "Neues Passwort", "Nouveau mot de passe")}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code className="bvk-input" style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, height: "auto", minHeight: 42, padding: "9px 12px", lineHeight: 1.35, fontSize: 16, fontWeight: 600, letterSpacing: 1, color: "var(--w)", overflowWrap: "anywhere", userSelect: "all" }}>{result.password}</code>
                <Btn kind={copied ? "ghost" : "primary"} onClick={async () => { try { await navigator.clipboard.writeText(result.password); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} }} style={{ flex: "none" }}>
                  {copied ? <><Check size={14} style={{ color: "#16a34a" }} /> {T("Copied", "Kopiert", "Copié")}</> : <><Copy size={14} /> {T("Copy", "Kopieren", "Copier")}</>}
                </Btn>
              </span>
            </Field>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.pending, fontSize: 12.5, lineHeight: 1.45, color: "var(--w)", marginTop: 14 }}>
              <span style={{ marginTop: 4 }}><Dot st="pending" size={8} /></span>
              {T("Share it with the user securely. You can re-open it with “Show” from the list until you leave this page — then it's gone for good (never stored).",
                 "Sicher an den Nutzer weitergeben. Bis Sie die Seite verlassen, können Sie es über „Anzeigen“ in der Liste erneut öffnen — danach ist es endgültig weg (nie gespeichert).",
                 "Partagez-le de façon sécurisée. Vous pouvez le rouvrir via « Voir » dans la liste jusqu'à ce que vous quittiez la page — ensuite il est perdu (jamais stocké).")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** lists flip instead of scrolling (components/fx/kit usePaged + Pager) */
function Paged<I>({ items, per, perPhone, children }: { items: I[]; per: number; perPhone: number; children: (slice: I[]) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, per, perPhone);
  return <>{children(slice)}<Pager page={page} pages={pages} onPage={setPage} /></>;
}

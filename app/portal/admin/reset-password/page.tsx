"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { ArrowLeft, Search, KeyRound, Copy, Check, ShieldAlert, X } from "lucide-react";

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
      setResult({ name: confirmUser.name || confirmUser.email, email: j.email, password: j.password, sessionsRevoked: j.sessionsRevoked ?? 0 });
      setConfirmUser(null);
    } catch {
      setErr(T("Reset failed", "Zurücksetzen fehlgeschlagen", "Échec"));
    }
    setBusy(false);
  }

  const kindTag = (k: U["kind"]) => {
    const map = { borivon: { t: T("Borivon", "Borivon", "Borivon"), c: "var(--w2)" }, org: { t: T("Org", "Org", "Org"), c: "#ef4444" }, candidate: { t: T("Candidate", "Kandidat", "Candidat"), c: "var(--gold)" } };
    const m = map[k];
    return <span style={{ fontSize: 10, fontWeight: 700, color: m.c, border: `1px solid ${m.c}`, borderRadius: 6, padding: "1px 6px", opacity: 0.85 }}>{m.t}</span>;
  };

  if (loading) return <PageLoader />;

  const card: CSSProperties = { borderRadius: 16, border: "1px solid var(--border)", background: "var(--card)" };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <button onClick={() => router.back()} className="bv-row-hover flex items-center gap-2 text-xs px-2 py-1 mb-4" style={{ color: "var(--w3)" }}>
        <ArrowLeft size={14} /> {T("Back", "Zurück", "Retour")}
      </button>

      <div className="flex items-center gap-2.5 mb-1.5">
        <KeyRound size={20} style={{ color: "var(--gold)" }} />
        <h1 className="text-[19px] font-bold" style={{ color: "var(--w)" }}>{T("Reset a password", "Passwort zurücksetzen", "Réinitialiser un mot de passe")}</h1>
      </div>
      <p className="text-[12.5px] mb-5" style={{ color: "var(--w3)" }}>
        {T("Set a new password for any user without email, and sign them out of every device. The new password is shown once.",
           "Neues Passwort für jeden Nutzer ohne E-Mail setzen und ihn von allen Geräten abmelden. Das neue Passwort wird einmal angezeigt.",
           "Définir un nouveau mot de passe pour tout utilisateur sans e-mail, et le déconnecter de tous ses appareils. Le mot de passe est affiché une fois.")}
      </p>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
        <input className="bv-input" value={q} onChange={e => setQ(e.target.value)} placeholder={T("Search by name or email…", "Nach Name oder E-Mail suchen…", "Rechercher par nom ou e-mail…")}
          style={{ width: "100%", paddingLeft: 36, fontSize: 13.5 }} autoFocus />
      </div>

      {/* User list */}
      <div style={card}>
        {filtered.length === 0 ? (
          <p className="text-[12.5px] text-center py-8" style={{ color: "var(--w3)" }}>{T("No users match.", "Keine Treffer.", "Aucun résultat.")}</p>
        ) : filtered.map((u, i) => (
          <div key={u.id} className="flex items-center gap-3 px-3.5 py-2.5" style={{ borderTop: i ? "1px solid var(--border)" : "none" }}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold truncate" style={{ color: "var(--w)" }}>{u.name || T("(no name)", "(kein Name)", "(sans nom)")}</span>
                {kindTag(u.kind)}
              </div>
              <div className="text-[11.5px] truncate" style={{ color: "var(--w3)" }}>{u.email}</div>
            </div>
            <button onClick={() => { setErr(""); setConfirmUser(u); }} className="bv-press flex-shrink-0 inline-flex items-center gap-1.5 text-[12px] font-bold px-3 py-2 rounded-lg"
              style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
              <KeyRound size={13} /> {T("Reset", "Zurücksetzen", "Réinit.")}
            </button>
          </div>
        ))}
      </div>
      {users.length > 50 && !q.trim() && (
        <p className="text-[11px] mt-2" style={{ color: "var(--w3)" }}>{T("Showing first 50 — search to narrow.", "Erste 50 — zum Eingrenzen suchen.", "50 premiers — affinez la recherche.")}</p>
      )}

      {/* Confirm modal */}
      {confirmUser && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }} onClick={() => !busy && setConfirmUser(null)}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, borderRadius: 20, maxWidth: 420, width: "100%", padding: 22 }}>
            <div className="flex items-center gap-2.5 mb-2">
              <ShieldAlert size={20} style={{ color: "#f59e0b" }} />
              <h2 className="text-[16px] font-bold" style={{ color: "var(--w)" }}>{T("Reset this password?", "Passwort zurücksetzen?", "Réinitialiser ?")}</h2>
            </div>
            <p className="text-[12.5px] leading-relaxed mb-1" style={{ color: "var(--w2)" }}>
              {T("A new password will be generated for", "Es wird ein neues Passwort erstellt für", "Un nouveau mot de passe sera généré pour")}{" "}
              <b style={{ color: "var(--w)" }}>{confirmUser.name || confirmUser.email}</b> ({confirmUser.email}).
            </p>
            <p className="text-[12.5px] leading-relaxed mb-4" style={{ color: "var(--w3)" }}>
              {T("Their old password stops working immediately and they'll be signed out of every device.",
                 "Das alte Passwort funktioniert sofort nicht mehr und der Nutzer wird von allen Geräten abgemeldet.",
                 "Son ancien mot de passe cesse de fonctionner et il sera déconnecté de tous ses appareils.")}
            </p>
            {err && <p className="text-[12px] mb-3" style={{ color: "var(--danger)" }}>{err}</p>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setConfirmUser(null)} disabled={busy} className="bv-press text-[13px] font-medium px-4 py-2.5" style={{ color: "var(--w3)" }}>{T("Cancel", "Abbrechen", "Annuler")}</button>
              <button onClick={doReset} disabled={busy} className="bv-press inline-flex items-center gap-1.5 text-[13px] font-bold px-4 py-2.5 rounded-xl disabled:opacity-60" style={{ background: "var(--gold)", color: "#131312" }}>
                <KeyRound size={14} /> {busy ? T("Resetting…", "Wird zurückgesetzt…", "En cours…") : T("Reset password", "Zurücksetzen", "Réinitialiser")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result modal — password shown once */}
      {result && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}>
          <div style={{ ...card, borderRadius: 20, maxWidth: 440, width: "100%", padding: 22 }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <Check size={20} style={{ color: "var(--success)" }} />
                <h2 className="text-[16px] font-bold" style={{ color: "var(--w)" }}>{T("Password reset", "Passwort zurückgesetzt", "Mot de passe réinitialisé")}</h2>
              </div>
              <button onClick={() => { setResult(null); setCopied(false); }} className="bv-press p-1" style={{ color: "var(--w3)" }} aria-label="close"><X size={18} /></button>
            </div>
            <p className="text-[12.5px] mb-1" style={{ color: "var(--w2)" }}>{result.name} · {result.email}</p>
            <p className="text-[11.5px] mb-3" style={{ color: "var(--w3)" }}>
              {result.sessionsRevoked > 0
                ? T(`Signed out of ${result.sessionsRevoked} device(s).`, `Von ${result.sessionsRevoked} Gerät(en) abgemeldet.`, `Déconnecté de ${result.sessionsRevoked} appareil(s).`)
                : T("No active devices to sign out.", "Keine aktiven Geräte abzumelden.", "Aucun appareil actif à déconnecter.")}
            </p>

            <label className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: "var(--w3)" }}>{T("New password", "Neues Passwort", "Nouveau mot de passe")}</label>
            <div className="flex items-center gap-2 mt-1.5">
              <code className="flex-1 text-[16px] font-bold tracking-wide px-3 py-3 rounded-xl" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--gold)", letterSpacing: 1 }}>{result.password}</code>
              <button onClick={async () => { try { await navigator.clipboard.writeText(result.password); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} }}
                className="bv-press flex-shrink-0 inline-flex items-center gap-1.5 text-[12.5px] font-bold px-3 py-3 rounded-xl" style={{ background: copied ? "var(--success-bg)" : "var(--gold)", color: copied ? "var(--success)" : "#131312", border: copied ? "1px solid var(--success-border)" : "none" }}>
                {copied ? <><Check size={14} /> {T("Copied", "Kopiert", "Copié")}</> : <><Copy size={14} /> {T("Copy", "Kopieren", "Copier")}</>}
              </button>
            </div>
            <p className="text-[11.5px] mt-3 leading-relaxed" style={{ color: "#f59e0b" }}>
              {T("Copy it now — it won't be shown again. Share it with the user securely.",
                 "Jetzt kopieren — es wird nicht erneut angezeigt. Sicher an den Nutzer weitergeben.",
                 "Copiez-le maintenant — il ne sera plus affiché. Partagez-le de façon sécurisée.")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

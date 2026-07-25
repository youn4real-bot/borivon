"use client";

/**
 * Bot webhook control (supreme admin only) — the one-click surface for the last
 * step of killing Vercel: SEE where the Telegram bot's webhook points, and
 * REPOINT it at Cloudflare with one button.
 *
 * The bot token is a Worker secret, so this can only be done server-side. The
 * page just carries the admin's session to /api/telegram/webhook-admin (GET to
 * inspect, POST to repoint) — the route hardcodes the target URL, so there is
 * nothing unsafe to configure here.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { ArrowLeft, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";

type Info = {
  configured: boolean; host: string; path: string;
  onCloudflare: boolean; onVercel: boolean;
  pendingUpdates: number; lastError: string | null; canonical: string;
};
/** Read-only Drive connectivity probe — proves the agency mirror can actually reach Drive. */
type DriveInfo = { ok: boolean; connectedAs?: string | null; reason?: string; detail?: string; hint?: string };

export default function AdminBotPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [drive, setDrive] = useState<DriveInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async (tk: string) => {
    const res = await fetch("/api/telegram/webhook-admin", { headers: { Authorization: `Bearer ${tk}` } });
    if (res.status === 401 || res.status === 403) { router.replace("/portal/dashboard"); return; }
    const j = await res.json().catch(() => null);
    if (j && !j.error) setInfo(j as Info);
    else setMsg(j?.hint || j?.error || T("Couldn't read the webhook.", "Webhook nicht lesbar.", "Impossible de lire le webhook."));

    // Drive probe rides the same load — read-only, and it proves the agency
    // mirror can actually REACH Drive. It silently could not on Workers until the
    // enable_nodejs_http_modules flag was added (googleapis -> node:http stub),
    // and a batch sync reported success while copying nothing.
    try {
      const dr = await fetch("/api/portal/admin/batch-drive-sync", { headers: { Authorization: `Bearer ${tk}` } });
      const dj = await dr.json().catch(() => null);
      if (dj) setDrive(dj as DriveInfo);
    } catch { /* leave null — the card just won't render */ }
  }, [router, T]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      let tk = session.access_token ?? "";
      const expMs = (session.expires_at ?? 0) * 1000;
      if (!expMs || expMs - Date.now() < 60_000) {
        try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) tk = r.session.access_token; } catch { /* keep */ }
      }
      if (cancelled) return;
      setToken(tk);
      await load(tk);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router, load]);

  const repoint = useCallback(async () => {
    if (!token) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/telegram/webhook-admin", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok) {
        setMsg(T("Done — the bot now points at Cloudflare.", "Fertig — der Bot zeigt jetzt auf Cloudflare.", "Terminé — le bot pointe maintenant vers Cloudflare."));
        await load(token);
      } else {
        setMsg(T("Repoint failed: ", "Fehlgeschlagen: ", "Échec : ") + (j?.detail || j?.error || res.status));
      }
    } catch { setMsg(T("Network error.", "Netzwerkfehler.", "Erreur réseau.")); }
    finally { setBusy(false); }
  }, [token, load, T]);

  if (loading) return <PageLoader />;

  const good = info?.onCloudflare;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px 80px" }}>
      <button onClick={() => router.push("/portal/admin")} className="mb-6 inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--w3)" }}>
        <ArrowLeft size={15} /> {T("Back", "Zurück", "Retour")}
      </button>

      <h1 className="text-xl font-semibold" style={{ color: "var(--w)" }}>
        {T("Bot connection", "Bot-Verbindung", "Connexion du bot")}
      </h1>
      <p className="mt-1 text-sm" style={{ color: "var(--w3)" }}>
        {T("Where Telegram delivers the bot's messages. It must point at Cloudflare before Vercel is deleted.",
           "Wohin Telegram die Bot-Nachrichten liefert. Muss auf Cloudflare zeigen, bevor Vercel gelöscht wird.",
           "Où Telegram livre les messages du bot. Doit pointer vers Cloudflare avant de supprimer Vercel.")}
      </p>

      {info && (
        <div className="mt-6 rounded-2xl p-5" style={{ background: "var(--card)", border: `1px solid ${good ? "rgba(22,163,74,0.4)" : "rgba(245,158,11,0.45)"}` }}>
          <div className="flex items-center gap-2">
            {good
              ? <CheckCircle2 size={20} style={{ color: "#16a34a" }} />
              : <AlertTriangle size={20} style={{ color: "#f59e0b" }} />}
            <span className="font-medium" style={{ color: "var(--w)" }}>
              {!info.configured
                ? T("No webhook set", "Kein Webhook gesetzt", "Aucun webhook défini")
                : good
                  ? T("Connected to Cloudflare", "Mit Cloudflare verbunden", "Connecté à Cloudflare")
                  : info.onVercel
                    ? T("Still pointing at Vercel", "Zeigt noch auf Vercel", "Pointe encore vers Vercel")
                    : T("Pointing somewhere else", "Zeigt woanders hin", "Pointe ailleurs")}
            </span>
          </div>
          <div className="mt-3 text-sm" style={{ color: "var(--w2)" }}>
            {info.configured
              ? <>{T("Currently: ", "Aktuell: ", "Actuellement : ")}<code style={{ color: "var(--gold)" }}>{info.host}{info.path}</code></>
              : T("The bot has no webhook configured yet.", "Der Bot hat noch keinen Webhook.", "Le bot n'a pas encore de webhook.")}
          </div>
          {info.lastError && (
            <div className="mt-2 text-xs" style={{ color: "#ef4444" }}>
              {T("Last error from Telegram: ", "Letzter Telegram-Fehler: ", "Dernière erreur Telegram : ")}{info.lastError}
            </div>
          )}

          {!good && (
            <button
              onClick={repoint}
              disabled={busy}
              className="mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: "var(--gold-gradient)", color: "#1a1205", opacity: busy ? 0.6 : 1 }}
            >
              <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
              {T("Point the bot at Cloudflare", "Bot auf Cloudflare umstellen", "Pointer le bot vers Cloudflare")}
            </button>
          )}
          {good && (
            <p className="mt-4 text-sm" style={{ color: "#16a34a" }}>
              {T("Nothing to do — Vercel can be safely deleted.", "Nichts zu tun — Vercel kann sicher gelöscht werden.", "Rien à faire — Vercel peut être supprimé en toute sécurité.")}
            </p>
          )}
        </div>
      )}

      {drive && (
        <div className="mt-4 rounded-2xl p-5" style={{ background: "var(--card)", border: `1px solid ${drive.ok ? "rgba(22,163,74,0.4)" : "rgba(239,68,68,0.45)"}` }}>
          <div className="flex items-center gap-2">
            {drive.ok ? <CheckCircle2 size={20} style={{ color: "#16a34a" }} /> : <AlertTriangle size={20} style={{ color: "#ef4444" }} />}
            <span className="font-medium" style={{ color: "var(--w)" }}>
              {drive.ok
                ? T("Google Drive connected", "Google Drive verbunden", "Google Drive connecté")
                : T("Google Drive NOT reachable", "Google Drive NICHT erreichbar", "Google Drive INACCESSIBLE")}
            </span>
          </div>
          <div className="mt-2 text-sm" style={{ color: "var(--w2)" }}>
            {drive.ok
              ? <>{T("Candidate files can be copied to the agency folder.", "Kandidatendateien können in den Agenturordner kopiert werden.", "Les fichiers candidats peuvent être copiés vers le dossier de l'agence.")}{drive.connectedAs ? <> <code style={{ color: "var(--gold)" }}>{drive.connectedAs}</code></> : null}</>
              : T("The batch sync would copy nothing. Tell Claude — this needs a fix.", "Die Batch-Synchronisierung würde nichts kopieren. Sag Claude Bescheid.", "La synchronisation ne copierait rien. Préviens Claude.")}
          </div>
          {!drive.ok && drive.detail && <div className="mt-2 text-xs" style={{ color: "var(--w3)" }}>{drive.detail}</div>}
          {!drive.ok && drive.hint && <div className="mt-2 text-xs" style={{ color: "var(--w3)" }}>{drive.hint}</div>}
        </div>
      )}

      {msg && <p className="mt-4 text-sm" style={{ color: "var(--w2)" }}>{msg}</p>}
    </main>
  );
}

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
import { RefreshCw } from "lucide-react";
import { PageHead, Btn, Card, Dot, STATUS_TINT, type Status } from "@/components/fx/kit";

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

  // Drive probe runs AFTER the page is on screen, deliberately NOT inside load().
  // It calls Google, and when it was awaited during the initial load a slow or
  // hanging Drive call left the whole page on a spinner with nothing rendered.
  // The webhook card must never wait on Google.
  useEffect(() => {
    if (loading || !token || drive !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/portal/admin/batch-drive-sync", { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json().catch(() => null);
        if (!cancelled) setDrive(j ? (j as DriveInfo) : { ok: false, reason: "call_failed", detail: "No response from the Drive check." });
      } catch {
        if (!cancelled) setDrive({ ok: false, reason: "call_failed", detail: "The Drive check could not be reached." });
      }
    })();
    return () => { cancelled = true; };
  }, [loading, token, drive]);

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
  const code: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12.5, color: "var(--w)", overflowWrap: "anywhere" };
  const head = (st: Status, text: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Dot st={st} />
      <span style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 21, lineHeight: 1.2, color: "var(--w)" }}>{text}</span>
    </div>
  );
  const row = (st: Status, text: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, padding: "9px 14px", borderRadius: 12, background: STATUS_TINT[st], fontSize: 13, lineHeight: 1.45, color: "var(--w)" }}>
      <span style={{ marginTop: 5 }}><Dot st={st} size={7} /></span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{text}</span>
    </div>
  );

  // the one design (founder 2026-11-13): serif head, each connection as a paper card with its status as a dot,
  // the one action as the black pill
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "88px 16px 80px" }}>
      <PageHead back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.push("/portal/admin") }}
        title={T("Bot connection", "Bot-Verbindung", "Connexion du bot")}
        sub={T("Where Telegram delivers the bot's messages. It must point at Cloudflare before Vercel is deleted.",
               "Wohin Telegram die Bot-Nachrichten liefert. Muss auf Cloudflare zeigen, bevor Vercel gelöscht wird.",
               "Où Telegram livre les messages du bot. Doit pointer vers Cloudflare avant de supprimer Vercel.")} />

      {info && (
        <Card style={{ padding: "18px 20px" }}>
          {head(good ? "approved" : "pending",
            !info.configured
              ? T("No webhook set", "Kein Webhook gesetzt", "Aucun webhook défini")
              : good
                ? T("Connected to Cloudflare", "Mit Cloudflare verbunden", "Connecté à Cloudflare")
                : info.onVercel
                  ? T("Still pointing at Vercel", "Zeigt noch auf Vercel", "Pointe encore vers Vercel")
                  : T("Pointing somewhere else", "Zeigt woanders hin", "Pointe ailleurs"))}
          <div style={{ marginTop: 10, fontSize: 13.5, color: "var(--w3)" }}>
            {info.configured
              ? <>{T("Currently: ", "Aktuell: ", "Actuellement : ")}<code style={code}>{info.host}{info.path}</code></>
              : T("The bot has no webhook configured yet.", "Der Bot hat noch keinen Webhook.", "Le bot n'a pas encore de webhook.")}
          </div>
          {info.lastError && row("rejected", <>{T("Last error from Telegram: ", "Letzter Telegram-Fehler: ", "Dernière erreur Telegram : ")}{info.lastError}</>)}

          {!good && (
            <Btn kind="primary" onClick={repoint} disabled={busy} style={{ marginTop: 16 }}>
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
              {T("Point the bot at Cloudflare", "Bot auf Cloudflare umstellen", "Pointer le bot vers Cloudflare")}
            </Btn>
          )}
          {good && row("approved", T("Nothing to do — Vercel can be safely deleted.", "Nichts zu tun — Vercel kann sicher gelöscht werden.", "Rien à faire — Vercel peut être supprimé en toute sécurité."))}
        </Card>
      )}

      {!drive && (
        <Card style={{ padding: "18px 20px", marginTop: 12, fontSize: 13, color: "var(--w3)" }}>
          {T("Checking Google Drive…", "Prüfe Google Drive…", "Vérification de Google Drive…")}
        </Card>
      )}
      {drive && (
        <Card style={{ padding: "18px 20px", marginTop: 12 }}>
          {head(drive.ok ? "approved" : "rejected",
            drive.ok
              ? T("Google Drive connected", "Google Drive verbunden", "Google Drive connecté")
              : T("Google Drive NOT reachable", "Google Drive NICHT erreichbar", "Google Drive INACCESSIBLE"))}
          <div style={{ marginTop: 10, fontSize: 13.5, color: "var(--w3)" }}>
            {drive.ok
              ? <>{T("Candidate files can be copied to the agency folder.", "Kandidatendateien können in den Agenturordner kopiert werden.", "Les fichiers candidats peuvent être copiés vers le dossier de l'agence.")}{drive.connectedAs ? <> <code style={code}>{drive.connectedAs}</code></> : null}</>
              : T("The batch sync would copy nothing. Tell Claude — this needs a fix.", "Die Batch-Synchronisierung würde nichts kopieren. Sag Claude Bescheid.", "La synchronisation ne copierait rien. Préviens Claude.")}
          </div>
          {!drive.ok && drive.detail && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--w3)", overflowWrap: "anywhere" }}>{drive.detail}</div>}
          {!drive.ok && drive.hint && <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--w3)", overflowWrap: "anywhere" }}>{drive.hint}</div>}
        </Card>
      )}

      {msg && <p style={{ marginTop: 14, fontSize: 13.5, color: "var(--w2)" }}>{msg}</p>}
    </main>
  );
}

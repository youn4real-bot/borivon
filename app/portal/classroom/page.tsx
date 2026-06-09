"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import ClassroomRoom from "@/components/ClassroomRoom";
import { ArrowLeft, Video, ShieldCheck, Camera, Mic, Activity, CheckCircle2 } from "lucide-react";

type Session = { id: string; room: string; title: string };

export default function CandidateClassroomPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);

  const [loading, setLoading] = useState(true);
  const [authToken, setAuthToken] = useState("");
  const [displayName, setDisplayName] = useState("Teilnehmer");
  const [consented, setConsented] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [conn, setConn] = useState<{ token: string; url: string; sessionId: string | null; room: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [err, setErr] = useState("");
  // Private-test allowlist gate — only the permanent pair (admin host + Soufiane)
  // is on it during testing. Server is the real gate; this hides the page too.
  const [tester, setTester] = useState(true);
  // Deep-link from a "live class" notification → auto-join this room (after consent).
  const [pendingRoom, setPendingRoom] = useState<string | null>(null);

  async function loadSessions(tk: string) {
    try {
      const r = await fetch("/api/portal/classroom/sessions", { headers: { Authorization: `Bearer ${tk}` } });
      const j = await r.json().catch(() => ({}));
      setSessions(j.sessions ?? []);
      setTester(j.tester !== false);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      setAuthToken(tk);
      const meta = session.user.user_metadata as { full_name?: string; first_name?: string } | undefined;
      setDisplayName(meta?.full_name || meta?.first_name || session.user.email?.split("@")[0] || "Teilnehmer");
      const [consentRes] = await Promise.allSettled([
        fetch("/api/portal/classroom/consent", { headers: { Authorization: `Bearer ${tk}` } }).then((r) => r.json()),
        loadSessions(tk),
      ]);
      const consentOk = consentRes.status === "fulfilled" ? !!consentRes.value?.consented : false;
      setConsented(consentOk);
      setLoading(false);

      // Arrived from a "live class" notification (?room=…)? Remember it, strip the
      // URL, and jump straight in if consent is already on; otherwise the consent
      // screen shows and agree() will join right after.
      const room = new URLSearchParams(window.location.search).get("room");
      if (room) {
        setPendingRoom(room);
        window.history.replaceState({}, "", "/portal/classroom");
        if (consentOk) void join(room, tk);
      }
    });
  }, [router]);

  async function agree() {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/portal/classroom/consent", { method: "POST", headers: { Authorization: `Bearer ${authToken}` } });
      if (r.ok) {
        setConsented(true);
        await loadSessions(authToken);
        if (pendingRoom) { void join(pendingRoom); }   // auto-join the class they were invited to
      }
      else setErr(T("Could not save", "Speichern fehlgeschlagen", "Échec de l'enregistrement"));
    } catch { setErr(T("Could not save", "Speichern fehlgeschlagen", "Échec de l'enregistrement")); }
    setBusy(false);
  }

  async function withdraw() {
    setBusy(true);
    try { await fetch("/api/portal/classroom/consent", { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } }); setConsented(false); }
    catch { /* ignore */ }
    setBusy(false);
  }

  async function join(room: string, tkOverride?: string) {
    const tk = tkOverride || authToken;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/portal/classroom/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ room }),
      });
      if (r.status === 503) { setNeedsSetup(true); setBusy(false); return; }
      const j = await r.json().catch(() => ({}));
      if (j.needsConsent) { setConsented(false); setBusy(false); return; }
      if (!r.ok) {
        setErr(j.notOpen ? T("This class isn't open right now.", "Dieser Kurs ist gerade nicht geöffnet.", "Ce cours n'est pas ouvert pour le moment.") : (j.error || T("Could not join", "Beitritt fehlgeschlagen", "Échec")));
        await loadSessions(tk); setBusy(false); return;
      }
      setConn({ token: j.token, url: j.url, sessionId: j.sessionId ?? null, room });
    } catch { setErr(T("Could not join", "Beitritt fehlgeschlagen", "Échec")); }
    setBusy(false);
  }

  if (loading) return <PageLoader />;

  // ── In the room ──
  if (conn) {
    return (
      <ClassroomRoom
        authToken={authToken} connToken={conn.token} url={conn.url}
        roomName={conn.room} sessionId={conn.sessionId} displayName={displayName}
        lang={lang} onLeave={() => { setConn(null); void loadSessions(authToken); }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      <button onClick={() => router.back()} className="bv-row-hover flex items-center gap-2 text-xs px-2 py-1 mb-4" style={{ color: "var(--w3)" }}>
        <ArrowLeft size={14} /> {T("Back", "Zurück", "Retour")}
      </button>
      <div className="flex items-center gap-2.5 mb-1.5">
        <Video size={20} style={{ color: "var(--gold)" }} />
        <h1 className="text-[19px] font-bold" style={{ color: "var(--w)" }}>{T("Live class", "Live-Kurs", "Cours en direct")}</h1>
      </div>

      {/* ── Private-test gate: not on the allowlist → nothing to do here ── */}
      {!tester ? (
        <div className="rounded-2xl p-5 mt-4 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <Video size={26} style={{ color: "var(--w3)", margin: "0 auto 8px" }} />
          <p className="text-[13px] font-semibold" style={{ color: "var(--w2)" }}>{T("Live classes aren't available for your account yet.", "Live-Kurse sind für dein Konto noch nicht verfügbar.", "Les cours en direct ne sont pas encore disponibles pour ton compte.")}</p>
          <p className="text-[11.5px] mt-1" style={{ color: "var(--w3)" }}>{T("We're still testing this with a small group. You'll be notified when it opens.", "Wir testen dies noch mit einer kleinen Gruppe. Du wirst benachrichtigt, sobald es verfügbar ist.", "Nous testons encore avec un petit groupe. Tu seras notifié à l'ouverture.")}</p>
        </div>
      ) : /* ── Consent gate (GDPR) ── */
      consented === false ? (
        <div className="rounded-2xl p-4 mt-4" style={{ background: "var(--card)", border: "1px solid var(--border-gold)" }}>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={17} style={{ color: "var(--gold)" }} />
            <p className="text-[14px] font-bold" style={{ color: "var(--w)" }}>{T("Before you join", "Bevor du beitrittst", "Avant de rejoindre")}</p>
          </div>
          <p className="text-[12.5px] mb-3 leading-relaxed" style={{ color: "var(--w2)" }}>
            {T("Our live classes are interactive, so we measure your participation to build your learner profile — which helps us match you with the right employer in Germany. We never record the class.",
               "Unsere Live-Kurse sind interaktiv. Wir messen deine Teilnahme, um dein Lernprofil zu erstellen — das hilft uns, dich mit dem richtigen Arbeitgeber in Deutschland zusammenzubringen. Wir zeichnen den Kurs nie auf.",
               "Nos cours en direct sont interactifs : nous mesurons ta participation pour construire ton profil d'apprenant — ce qui nous aide à te jumeler avec le bon employeur en Allemagne. Nous n'enregistrons jamais le cours.")}
          </p>
          <div className="flex flex-col gap-1.5 mb-3">
            {[
              { icon: <Camera size={13} />, txt: T("Camera on (required to participate)", "Kamera an (zur Teilnahme erforderlich)", "Caméra activée (requise pour participer)") },
              { icon: <Activity size={13} />, txt: T("Attendance & time present", "Anwesenheit & Anwesenheitszeit", "Présence et temps de présence") },
              { icon: <Mic size={13} />, txt: T("How often you speak", "Wie oft du sprichst", "Fréquence de prise de parole") },
              { icon: <CheckCircle2 size={13} />, txt: T("Exercise actions you take", "Deine Übungsaktionen", "Tes actions d'exercice") },
            ].map((it, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]" style={{ color: "var(--w2)" }}>
                <span style={{ color: "var(--gold)" }}>{it.icon}</span> {it.txt}
              </div>
            ))}
          </div>
          <p className="text-[11px] mb-3 leading-relaxed" style={{ color: "var(--w3)" }}>
            {T("This data may be shared with potential employers for matching. You can withdraw your consent at any time, which stops sharing immediately.",
               "Diese Daten können zur Vermittlung an potenzielle Arbeitgeber weitergegeben werden. Du kannst deine Einwilligung jederzeit widerrufen — die Weitergabe stoppt sofort.",
               "Ces données peuvent être partagées avec des employeurs potentiels pour le jumelage. Tu peux retirer ton consentement à tout moment, ce qui arrête immédiatement le partage.")}
          </p>
          {err && <p className="text-[12px] mb-2" style={{ color: "var(--danger)" }}>{err}</p>}
          <div className="flex items-center gap-2">
            <button onClick={agree} disabled={busy} className="bv-press inline-flex items-center justify-center gap-2 text-[13.5px] font-bold px-4 py-2.5 rounded-xl disabled:opacity-60" style={{ background: "var(--gold)", color: "#131312" }}>
              <ShieldCheck size={15} /> {busy ? T("Saving…", "Wird gespeichert…", "Enregistrement…") : T("I agree & continue", "Ich stimme zu & weiter", "J'accepte et continue")}
            </button>
            <button onClick={() => router.back()} className="bv-row-hover text-[12.5px] font-semibold px-3 py-2.5 rounded-xl" style={{ color: "var(--w3)" }}>
              {T("Not now", "Jetzt nicht", "Pas maintenant")}
            </button>
          </div>
        </div>
      ) : needsSetup ? (
        <div className="rounded-2xl p-4 mt-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <p className="text-[13px]" style={{ color: "var(--w2)" }}>{T("The live class isn't available yet. Please check back shortly.", "Der Live-Kurs ist noch nicht verfügbar. Bitte schau gleich noch einmal vorbei.", "Le cours en direct n'est pas encore disponible. Reviens dans un instant.")}</p>
        </div>
      ) : (
        // ── Consented: pick a live class ──
        <div className="mt-4 flex flex-col gap-3">
          {sessions.length === 0 ? (
            <div className="rounded-2xl p-5 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <Video size={26} style={{ color: "var(--w3)", margin: "0 auto 8px" }} />
              <p className="text-[13px] font-semibold" style={{ color: "var(--w2)" }}>{T("No live class right now", "Gerade kein Live-Kurs", "Aucun cours en direct pour l'instant")}</p>
              <p className="text-[11.5px] mt-1" style={{ color: "var(--w3)" }}>{T("When your teacher opens a class, it'll appear here.", "Sobald dein Lehrer einen Kurs öffnet, erscheint er hier.", "Quand ton professeur ouvre un cours, il apparaîtra ici.")}</p>
            </div>
          ) : (
            sessions.map((s) => (
              <button key={s.id} onClick={() => join(s.room)} disabled={busy} className="bv-press flex items-center justify-between gap-3 rounded-2xl p-4 text-left disabled:opacity-60" style={{ background: "var(--card)", border: "1px solid var(--border-gold)" }}>
                <span>
                  <span className="block text-[14px] font-bold" style={{ color: "var(--w)" }}>🎓 {s.title}</span>
                  <span className="block text-[11.5px] mt-0.5" style={{ color: "var(--gold)" }}>{T("Live now — tap to join", "Jetzt live — zum Beitreten tippen", "En direct — touchez pour rejoindre")}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold px-3 py-2 rounded-xl" style={{ background: "var(--gold)", color: "#131312" }}><Video size={14} /> {T("Join", "Beitreten", "Rejoindre")}</span>
              </button>
            ))
          )}
          {err && <p className="text-[12px]" style={{ color: "var(--danger)" }}>{err}</p>}
          <button onClick={withdraw} disabled={busy} className="text-[11px] underline self-start mt-1" style={{ color: "var(--w3)" }}>
            {T("Withdraw my consent", "Meine Einwilligung widerrufen", "Retirer mon consentement")}
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Hospital Motivationsschreiben editor — minimalist, styled like the CV builder.
 *
 * Fixed structure (only the BODY is candidate-editable):
 *  - Top-right: candidate personal info  → locked, from candidate_profiles
 *  - Left:      UKSH recipient           → locked, by admin-assigned campus
 *  - Right:     "{city}, den DD.MM.YYYY"  → locked
 *  - Betreff                              → locked (defined)
 *  - "Sehr geehrte Damen und Herren,"     → locked
 *  - BODY                                 → editable (the candidate's letter)
 *  - "Mit freundlichen Grüßen" + name     → locked
 */

import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { PageLoader, AutosaveIndicator, Spinner } from "@/components/ui/states";
import { PdfViewer } from "@/components/PdfViewer";
import {
  ArrowLeft, Lock, FileText, Upload, X as XIcon, Download,
  CheckCircle2, AlertTriangle, FilePen, Hourglass,
} from "lucide-react";


const BETREFF_PREFIX = "Betreff: Motivationsschreiben für eine Tätigkeit als Pflegekraft am";

// One-page body budget. Research sweet spot for cover letters is ~250–400
// words (peak callback ≈ 250–300, drops sharply >400). With our fixed
// header/recipient/closing blocks, ~320 words is the max that still fits a
// single A4 page — which also keeps the letter in the optimal range.
const MAX_WORDS = 320;          // hard cap — typing blocked past this
const MIN_RECOMMENDED = 250;    // below this reads thin (research: <150 worst)

function countWords(text: string): number {
  const t = text.replace(/ /g, " ").trim();
  return t ? t.split(/\s+/).length : 0;
}

// ─── i18n (UI chrome only — the letter itself is always German) ───────────────

const T = {
  fr: { buildWith: "Créer ma lettre de motivation avec", back: "Retour au portail",
        print: "Imprimer", ph: "Écrivez ici votre motivation…" },
  en: { buildWith: "Build my cover letter with", back: "Back to portal",
        print: "Print", ph: "Write your motivation here…" },
  de: { buildWith: "Motivationsschreiben erstellen mit", back: "Zurück zum Portal",
        print: "Drucken", ph: "Schreiben Sie hier Ihre Motivation…" },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayDot(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

interface Person {
  firstName: string; lastName: string;
  street: string; number: string;
  postal: string; city: string; country: string;
  phone: string; email: string;
}

const affBtnStyle: React.CSSProperties = {
  width: 20, height: 20, borderRadius: 999, flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "var(--gdim, rgba(201,168,76,0.14))",
  color: "var(--gold, #C9A84C)",
  border: "1px solid var(--border-gold, rgba(201,168,76,0.35))",
  cursor: "pointer",
};

function Locked({ lines, align = "left", bold = false, lockable = false, onLock, lockLead = false, waitable = false, onWait }: {
  lines: string[]; align?: "left" | "right"; bold?: boolean;
  lockable?: boolean; onLock?: () => void; lockLead?: boolean;
  waitable?: boolean; onWait?: () => void;
}) {
  // A line still needs its passport data when the "—" placeholder is present
  // (either the whole line, or embedded — e.g. the city in the date line).
  const needsData = (l: string) => l.trim() === "" || l.includes("—");
  const lockBtn = (
    <button type="button" onClick={onLock} aria-label="Locked — passport data"
      className="bv-noprint" style={affBtnStyle}>
      <Lock size={11} strokeWidth={2} />
    </button>
  );
  const waitBtn = (
    <button type="button" onClick={onWait} aria-label="Waiting for employer assignment"
      className="bv-noprint" style={affBtnStyle}>
      <Hourglass size={11} strokeWidth={2} />
    </button>
  );
  return (
    <div title="locked" style={{
      userSelect: "none", fontWeight: bold ? 700 : 400,
    }}>
      {lines.map((l, i) => {
        const showLock = lockable && needsData(l);
        const showWait = waitable && needsData(l);
        return (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8,
            justifyContent: align === "right" ? "flex-end" : "flex-start",
          }}>
            {showLock && lockLead && lockBtn}
            <span>{l || " "}</span>
            {showLock && !lockLead && lockBtn}
            {showWait && waitBtn}
          </div>
        );
      })}
    </div>
  );
}

/* Same passport-required popup as the CV builder. */
function PassportLockPopup({ open, onClose, passportStatus }: {
  open: boolean;
  onClose: () => void;
  passportStatus: null | "pending" | "approved" | "rejected";
}) {
  const { lang } = useLang();
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  let title: string, body: string;
  if (passportStatus === "pending") {
    title = lang === "de" ? "Wird geprüft" : lang === "en" ? "Under review" : "En cours d'examen";
    body  = lang === "de"
      ? "Ihr Reisepass wurde hochgeladen und wird derzeit von unserem Team geprüft. Sobald die Daten genehmigt sind, können Sie das Motivationsschreiben erstellen. Bitte haben Sie etwas Geduld."
      : lang === "en"
        ? "Your passport has been uploaded and is currently being reviewed by our team. Once the data is approved you'll be able to generate the letter. Please bear with us."
        : "Votre passeport a été téléversé et est en cours d'examen par notre équipe. Une fois les données approuvées, vous pourrez générer la lettre. Merci de patienter.";
  } else if (passportStatus === "approved") {
    title = lang === "de" ? "Daten bestätigt" : lang === "en" ? "Data verified" : "Données vérifiées";
    body  = lang === "de"
      ? "Diese Daten stammen aus Ihrem genehmigten Reisepass und können nicht manuell bearbeitet werden — so bleiben sie immer mit dem Pass identisch."
      : lang === "en"
        ? "This data comes from your approved passport and can't be edited manually — that way it always stays identical to the passport."
        : "Ces données proviennent de votre passeport approuvé et ne peuvent pas être modifiées manuellement — afin qu'elles restent toujours identiques au passeport.";
  } else if (passportStatus === "rejected") {
    title = lang === "de" ? "Pass abgelehnt" : lang === "en" ? "Passport rejected" : "Passeport refusé";
    body  = lang === "de"
      ? "Ihr Reisepass wurde abgelehnt. Bitte laden Sie ihn im Dashboard erneut hoch, damit dieses Feld ausgefüllt werden kann."
      : lang === "en"
        ? "Your passport was rejected. Please re-upload it in the dashboard so this field can be filled."
        : "Votre passeport a été refusé. Veuillez le téléverser à nouveau dans le tableau de bord pour que ce champ soit rempli.";
  } else {
    title = lang === "de" ? "Pass erforderlich" : lang === "en" ? "Passport required" : "Passeport requis";
    body  = lang === "de"
      ? "Dieses Feld wird automatisch ausgefüllt, sobald Sie Ihren Reisepass im Dashboard hochladen. Persönliche Daten können hier nicht manuell bearbeitet werden, um Übereinstimmung mit dem Reisepass zu garantieren."
      : lang === "en"
        ? "This field is filled automatically once you upload your passport in the dashboard. Personal data can't be edited here manually — this ensures it always matches your passport."
        : "Ce champ est rempli automatiquement dès que vous téléversez votre passeport dans le tableau de bord. Les données personnelles ne peuvent pas être modifiées ici manuellement — afin qu'elles correspondent toujours au passeport.";
  }
  const cta   = lang === "de" ? "Zum Dashboard" : lang === "en" ? "Go to dashboard" : "Vers le tableau de bord";
  const close = lang === "de" ? "Schließen" : lang === "en" ? "Close" : "Fermer";
  return (
    <>
      <div className="fixed inset-0 z-[1100]"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", animation: "bvFadeRise 0.2s var(--ease-out)" }}
        onClick={onClose} />
      <div className="fixed inset-0 z-[1101] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-[360px] overflow-hidden flex flex-col pointer-events-auto"
          style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)" }}>
          <div className="px-6 pt-6 pb-2 text-center">
            <span className="mx-auto mb-3 flex items-center justify-center w-12 h-12 rounded-full"
              style={{ background: "var(--gdim)", color: "var(--gold)" }}>
              <Lock size={20} strokeWidth={1.8} />
            </span>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: "var(--w)" }}>{title}</h3>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--w2)" }}>{body}</p>
          </div>
          <div className="flex flex-col gap-2 p-4">
            <a href="/portal/dashboard"
              className="block w-full text-center px-5 py-3 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90"
              style={{ background: "var(--gold)", color: "#131312", borderRadius: "12px", textDecoration: "none" }}>
              {cta}
            </a>
            <button type="button" onClick={onClose}
              className="w-full px-5 py-3 text-[13.5px] font-medium transition-opacity hover:opacity-80"
              style={{ background: "transparent", color: "var(--w2)", border: "none", cursor: "pointer" }}>
              {close}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* "Waiting for employer assignment" popup — shown when the candidate's
   UKSH campus has not been assigned by an admin yet. */
function EmployerPendingPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang } = useLang();
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  const title = lang === "de" ? "Arbeitgeber wird zugewiesen"
    : lang === "fr" ? "Employeur en cours d'attribution"
    : "Employer being assigned";
  const body = lang === "de"
    ? "Die Informationen Ihres Arbeitgebers erscheinen hier automatisch, sobald er zugewiesen wurde."
    : lang === "fr"
      ? "Les informations de votre employeur apparaîtront ici automatiquement une fois attribué."
      : "Your employer's information will appear here once assigned.";
  const cta = lang === "de" ? "Verstanden" : lang === "fr" ? "Compris" : "Got it";

  return (
    <>
      <div className="fixed inset-0 z-[1100]"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", animation: "bvFadeRise 0.2s var(--ease-out)" }}
        onClick={onClose} />
      <div className="fixed inset-0 z-[1101] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-[360px] overflow-hidden flex flex-col pointer-events-auto"
          style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)" }}>
          <div className="px-6 pt-6 pb-2 text-center">
            <span className="mx-auto mb-3 flex items-center justify-center w-12 h-12 rounded-full"
              style={{ background: "var(--gdim)", color: "var(--gold)" }}>
              <Hourglass size={20} strokeWidth={1.8} />
            </span>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: "var(--w)" }}>{title}</h3>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--w2)" }}>{body}</p>
          </div>
          <div className="p-4">
            <button type="button" onClick={onClose}
              className="block w-full text-center px-5 py-3 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90"
              style={{ background: "var(--gold)", color: "#131312", borderRadius: "12px", border: "none", cursor: "pointer" }}>
              {cta}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Person merger (passport-data over cv_draft) ─────────────────────────────
//
// User-stated rule (2026-05):
//   - After a passport is approved, name + address auto-fill from the
//     approved Reisepass data.
//   - Phone number is special: pulled from the CV builder instantly, no
//     admin approval required. Whichever side last typed it wins.
//   - Fields the passport never carries (or that the candidate filled in
//     the CV builder before passport submission) fall back to cv_draft so
//     the cover letter never starts blank.
type ProfileRow = {
  first_name?:           string | null;
  last_name?:            string | null;
  country_of_residence?: string | null;
  address_street?:       string | null;
  address_number?:       string | null;
  address_postal?:       string | null;
  city_of_residence?:    string | null;
  phone?:                string | null;
  passport_status?:      string | null;
  cv_draft?:             Record<string, unknown> | null;
};
type SignupMeta = { first_name?: string; last_name?: string };
function mergePersonFromRow(
  p: ProfileRow | null | undefined,
  email: string,
  meta?: SignupMeta | null,
): Person {
  const d = (p?.cv_draft ?? {}) as Record<string, unknown>;
  const draftStr = (k: string): string => {
    const v = d[k];
    return typeof v === "string" ? v : "";
  };
  // Helper: passport (candidate_profiles) value, else cv_draft value,
  // else signup user_metadata, else "". Signup metadata is the universal
  // fallback — every account has first_name/last_name set at sign-up time,
  // so name is NEVER blank on the cover letter regardless of whether the
  // passport has been approved or the CV builder has been opened.
  const pick = (
    passportV: string | null | undefined,
    draftK:    string,
    metaV?:    string | null,
  ): string =>
    (passportV && String(passportV).trim())
      || draftStr(draftK).trim()
      || (metaV ? String(metaV).trim() : "");

  return {
    firstName: pick(p?.first_name,           "firstName", meta?.first_name),
    lastName:  pick(p?.last_name,            "lastName",  meta?.last_name),
    street:    pick(p?.address_street,       "address"),
    number:    pick(p?.address_number,       "addressNumber"),
    postal:    pick(p?.address_postal,       "postalCode"),
    city:      pick(p?.city_of_residence,    "city"),
    country:   pick(p?.country_of_residence, "countryOfResidence"),
    // Phone — cv_draft FIRST (instant, no admin approval). Fall back to
    // the persisted candidate_profiles.phone if the draft hasn't filled it.
    phone:     (draftStr("phone").trim() || (p?.phone ?? "")).trim(),
    email,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MotivationsschreibenPage() {
  const router  = useRouter();
  const { lang } = useLang();
  const t = T[lang as keyof typeof T] ?? T.en;

  const [loading, setLoading] = useState(true);
  const [userId,  setUserId]  = useState<string | null>(null);
  const [person,  setPerson]  = useState<Person | null>(null);
  const [campusAssigned, setCampusAssigned] = useState(false);
  const [employerLines, setEmployerLines] = useState<string[]>([]);
  const [employerName, setEmployerName] = useState<string>("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [passportStatus, setPassportStatus] = useState<null | "pending" | "approved" | "rejected">(null);
  const [lockedPopupOpen, setLockedPopupOpen] = useState(false);
  const [employerPopupOpen, setEmployerPopupOpen] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrlRaw] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  // Temporary debug payload from /api/portal/me/letter-data — shown inline
  // when the sender block has missing fields so the cause is visible
  // without DevTools (see body block below). Drop once stabilised.
  const [letterDebug, setLetterDebug] = useState<Record<string, unknown> | null>(null);

  const setPdfUrl = useCallback((next: string | null) => {
    setPdfUrlRaw(prev => {
      if (prev) try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const editorRef = useRef<HTMLDivElement>(null);
  const lastGoodHTML = useRef<string>("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftKey = useCallback((uid: string) => `bv_letter_body_${uid}`, []);

  // Keep authToken state fresh across silent JWT refreshes (~55 min). Without
  // this the initial-mount token goes stale during long edits and every
  // subsequent generate / upload fails with "Invalid token".
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.access_token) setAuthToken(session.access_token);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  // ── Live sync of name/address/phone from candidate_profiles ─────────────
  // The cover letter needs to react when:
  //   - admin approves the passport (writes first_name, address_*, …),
  //   - candidate (or admin) edits the CV builder (writes cv_draft.phone,
  //     cv_draft.firstName, etc.).
  // Postgres realtime push fires inside the candidate's own session (their
  // own row, RLS-allowed). A 5 s poll backstops the cases realtime is
  // blocked (suspended tab, channel error, RLS-gated cross-user).
  const personEmailRef  = useRef<string>("");
  const signupMetaRef   = useRef<SignupMeta | null>(null);
  useEffect(() => { if (person?.email) personEmailRef.current = person.email; }, [person?.email]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const pull = async () => {
      if (!authToken) return;
      try {
        const r = await fetch("/api/portal/me/letter-data", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!r.ok) return;
        const j = await r.json() as {
          sender: { firstName: string; lastName: string; street: string; number: string; postal: string; city: string; country: string; phone: string; email: string };
          passportStatus: string | null;
          _debug?: unknown;
        };
        if (typeof window !== "undefined") {
          // eslint-disable-next-line no-console
          console.log("[letter] pull (server)", j.sender, "passport_status:", j.passportStatus, "debug:", j._debug);
        }
        if (j._debug) setLetterDebug(j._debug as Record<string, unknown>);
        if (cancelled) return;
        const merged: Person = { ...j.sender };
        setPerson(prev => {
          if (!prev) return merged;
          if (JSON.stringify(prev) === JSON.stringify(merged)) return prev;
          return merged;
        });
        if (j.passportStatus === "pending" || j.passportStatus === "approved" || j.passportStatus === "rejected") {
          setPassportStatus(j.passportStatus);
        }
      } catch { /* offline */ }
    };
    // Keep the realtime websocket auth in lock-step with our REST JWT —
    // without this, postgres_changes silently doesn't deliver after a
    // session restore from localStorage (same bug we fixed for cv-collab).
    if (authToken) { try { supabase.realtime.setAuth(authToken); } catch { /* offline */ } }
    const ch = supabase
      .channel(`letter-profile-${userId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "candidate_profiles", filter: `user_id=eq.${userId}` },
        () => {
          if (typeof window !== "undefined") {
            // eslint-disable-next-line no-console
            console.log("[letter] realtime UPDATE for user", userId);
          }
          void pull();
        },
      )
      .subscribe((status) => {
        if (typeof window !== "undefined") {
          // eslint-disable-next-line no-console
          console.log("[letter] channel status:", status, `letter-profile-${userId}`);
        }
      });
    // 5 s poll backstop for cases realtime is suppressed.
    const t = setInterval(() => { if (!document.hidden) void pull(); }, 5000);
    const onVis = () => { if (!document.hidden) void pull(); };
    document.addEventListener("visibilitychange", onVis);
    // Fire once immediately so first reveal already has the freshest data.
    void pull();
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      supabase.removeChannel(ch);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, authToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/portal"); return; }
      if (cancelled) return;

      const uid = session.user.id;
      setUserId(uid);
      setAuthToken(session.access_token);

      // Sender block resolved SERVER-SIDE via service-role — the anon
      // supabase client was sometimes returning nulls for the address
      // columns (column-level RLS or a stale row), so this endpoint
      // bypasses any client-RLS uncertainty. Returns the fully merged
      // sender (passport > cv_draft > signup metadata) in one round-trip.
      try {
        const r = await fetch("/api/portal/me/letter-data", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!cancelled && r.ok) {
          const j = await r.json() as {
            sender: { firstName: string; lastName: string; street: string; number: string; postal: string; city: string; country: string; phone: string; email: string };
            passportStatus: string | null;
            _debug?: unknown;
          };
          if (j._debug) setLetterDebug(j._debug as Record<string, unknown>);
          setPerson({
            firstName: j.sender.firstName,
            lastName:  j.sender.lastName,
            street:    j.sender.street,
            number:    j.sender.number,
            postal:    j.sender.postal,
            city:      j.sender.city,
            country:   j.sender.country,
            phone:     j.sender.phone,
            email:     j.sender.email,
          });
          if (j.passportStatus === "pending" || j.passportStatus === "approved" || j.passportStatus === "rejected") {
            setPassportStatus(j.passportStatus);
          }
          // Keep the live-sync effect's refs in step.
          personEmailRef.current = j.sender.email;
        }
      } catch {
        // Fallback: anon client read so the page still hydrates if the
        // dedicated endpoint is offline (shouldn't happen, but defensive).
        const { data: p } = await supabase
          .from("candidate_profiles")
          .select("first_name,last_name,country_of_residence,address_street,address_number,address_postal,city_of_residence,phone,passport_status,cv_draft")
          .eq("user_id", uid)
          .maybeSingle();
        const { data: au2 } = await supabase.auth.getUser();
        const fallbackEmail = au2?.user?.email ?? "";
        const meta = (au2?.user?.user_metadata ?? null) as SignupMeta | null;
        signupMetaRef.current = meta;
        if (!cancelled) {
          setPerson(mergePersonFromRow(p as ProfileRow | null, fallbackEmail, meta));
          const ps = p?.passport_status as string | undefined;
          if (ps === "pending" || ps === "approved" || ps === "rejected") setPassportStatus(ps);
        }
      }

      // Assigned employer comes from the backend (admin assignment →
      // employers table). Single source of truth, server-resolved.
      try {
        const r = await fetch("/api/portal/me/employer", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!cancelled && r.ok) {
          const j = await r.json();
          if (j?.assigned && Array.isArray(j.lines) && j.lines.length) {
            setEmployerLines(j.lines);
            setEmployerName(typeof j.name === "string" ? j.name : "");
            setCampusAssigned(true);
          }
        }
      } catch { /* unassigned — hourglass state */ }

      if (!cancelled) {
        const saved = localStorage.getItem(draftKey(uid));
        if (editorRef.current) {
          editorRef.current.innerHTML = saved?.trim() ? saved : "";
          lastGoodHTML.current = editorRef.current.innerHTML;
          setWordCount(countWords(editorRef.current.textContent ?? ""));
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scheduleSave() {
    if (!userId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (editorRef.current && userId) {
        localStorage.setItem(draftKey(userId), editorRef.current.innerHTML);
        setSavedAt(new Date());
      }
    }, 700);
  }

  // Hard one-page cap: if an edit pushes the body over MAX_WORDS, revert to
  // the last in-budget state (caret to end). Deleting always passes, so the
  // candidate can edit their way back down.
  function handleBodyInput() {
    const el = editorRef.current;
    if (!el) return;
    const words = countWords(el.textContent ?? "");
    if (words > MAX_WORDS) {
      el.innerHTML = lastGoodHTML.current;
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return;
    }
    lastGoodHTML.current = el.innerHTML;
    setWordCount(words);
    scheduleSave();
  }

  async function handleGenerate() {
    if (!authToken || !person) return;

    // Required-field gate — these are the locked/hourglass blocks. Nothing
    // generates until passport personal data is in AND an employer is assigned.
    const personalMissing =
      !person.firstName || !person.lastName || !person.street ||
      !person.postal || !person.city || !person.phone;
    const employerMissing = !campusAssigned;
    const L = (de: string, fr: string, en: string) =>
      lang === "de" ? de : lang === "fr" ? fr : en;
    if (personalMissing || employerMissing) {
      const parts: string[] = [];
      if (personalMissing) parts.push(L("Persönliche Daten (aus dem Reisepass)", "Informations personnelles (du passeport)", "Personal info (from passport)"));
      if (employerMissing) parts.push(L("Arbeitgeber (noch nicht zugewiesen)", "Employeur (pas encore attribué)", "Employer (not yet assigned)"));
      setMissingFields(parts);
      setGenError(L("Erforderliche Angaben fehlen", "Champs requis manquants", "Required fields missing"));
      return;
    }
    setMissingFields([]);

    if (wordCount < MIN_RECOMMENDED) {
      setGenError(lang === "de" ? `Zu kurz — mindestens ${MIN_RECOMMENDED} Wörter.`
        : lang === "fr" ? `Trop court — au moins ${MIN_RECOMMENDED} mots.`
        : `Too short — at least ${MIN_RECOMMENDED} words.`);
      return;
    }
    const bodyText = editorRef.current?.innerText ?? "";
    const bodyParagraphs = bodyText.split(/\n+/).map(p => p.trim()).filter(Boolean);
    if (bodyParagraphs.length === 0) {
      setGenError(lang === "de" ? "Bitte schreiben Sie zuerst Ihren Text."
        : lang === "fr" ? "Veuillez d'abord écrire votre texte."
        : "Please write your letter first.");
      return;
    }
    setGenerating(true); setGenError(""); setMissingFields([]); setPdfBlob(null); setPdfUrl(null); setUploaded(false);
    try {
      const payload = {
        senderName:  [person.firstName, person.lastName].filter(Boolean).join(" "),
        senderStreet: [person.street, person.number ? `Nr. ${person.number}` : ""].filter(Boolean).join(", "),
        senderPlace:  [person.postal, person.city, person.country].filter(Boolean).join(", "),
        senderPhone:  person.phone,
        senderEmail:  person.email,
        recipientLines: employerLines, // server re-resolves authoritatively
        dateLine: `${person.city || ""}, den ${todayDot()}`.replace(/^, /, ""),
        subject: `${BETREFF_PREFIX} ${employerName}`.trim(), // server re-resolves authoritatively
        salutation: "Sehr geehrte Damen und Herren,",
        bodyParagraphs,
        closingName: [person.firstName, person.lastName].filter(Boolean).join(" "),
      };
      // Pull a fresh session token — letter builder is a long-lived edit
      // surface, the JWT in state can be stale after an hour of typing,
      // and the server returns "Invalid token" on regen. Belt-and-braces.
      const { data: { session: freshSess } } = await supabase.auth.getSession();
      const tok = freshSess?.access_token ?? authToken;
      if (freshSess?.access_token && freshSess.access_token !== authToken) setAuthToken(freshSess.access_token);
      const res = await fetch("/api/portal/letter/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || "Generation failed");
      }
      const blob = await res.blob();
      setPdfBlob(blob);
      setPdfUrl(URL.createObjectURL(blob));
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message
        : (lang === "de" ? "Fehler bei der Erstellung." : lang === "fr" ? "Erreur lors de la génération." : "Generation error."));
    } finally {
      setGenerating(false);
    }
  }

  async function handleUpload() {
    if (!pdfBlob || !userId || !authToken || !person) return;
    setUploading(true); setUploadErr("");
    try {
      const fn = [person.firstName, person.lastName].filter(Boolean).join("_").toLowerCase() || "kandidat";
      const file = new File([pdfBlob], `motivationsschreiben_${fn}.pdf`, { type: "application/pdf" });
      const form = new FormData();
      form.append("file", file);
      form.append("fileType", "Anschreiben");
      form.append("fileKey", "letter");
      form.append("userId", userId);
      form.append("firstName", person.firstName);
      form.append("lastName", person.lastName);
      const { data: { session: freshSess } } = await supabase.auth.getSession();
      const tok = freshSess?.access_token ?? authToken;
      if (freshSess?.access_token && freshSess.access_token !== authToken) setAuthToken(freshSess.access_token);
      const res = await fetch("/api/portal/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}` },
        body: form,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || "Upload failed");
      }
      setUploaded(true);
    } catch (err: unknown) {
      setUploadErr(err instanceof Error ? err.message
        : (lang === "de" ? "Fehler beim Senden." : lang === "fr" ? "Erreur d'envoi." : "Upload error."));
    } finally {
      setUploading(false);
    }
  }

  if (loading || !person) return <PageLoader />;

  const fullName  = [person.firstName, person.lastName].filter(Boolean).join(" ") || "—";
  const streetLn  = [person.street, person.number ? `Nr. ${person.number}` : ""]
                      .filter(Boolean).join(", ") || "—";
  const placeLn   = [person.postal, person.city, person.country].filter(Boolean).join(", ") || "—";
  const dateLn    = `${person.city || "—"}, den ${todayDot()}`;
  const recipient = employerLines;

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #bv-doc-sheet, #bv-doc-sheet * { visibility: visible !important; }
          #bv-doc-sheet { position: absolute; left: 0; top: 0; margin: 0;
            box-shadow: none !important; width: 100%;
            background: #fff !important; color: #1C1C1E !important; }
          #bv-doc-sheet * { color: #1C1C1E !important; }
          .bv-noprint { display: none !important; }
        }
        #bv-body:empty:before { content: attr(data-ph); color: #9aa0a6; pointer-events: none; }
        #bv-body:focus { outline: none; }
        #bv-body p  { margin: 0 0 12px; }
        #bv-body ul { list-style: disc; padding-left: 22px; margin: 0 0 12px; }
        #bv-body ol { list-style: decimal; padding-left: 22px; margin: 0 0 12px; }
      `}</style>

      <main id="bv-main" tabIndex={-1}
        className="bv-page-bottom min-h-screen pt-[58px] pb-16 px-4"
        style={{ background: "var(--bg)" }}>
        <PortalTopNav />

        <div className="max-w-[820px] mx-auto bv-enter-soft">

          {/* Header — same hierarchy as the CV builder */}
          <div className="mb-8 bv-noprint">
            <div className="flex items-center justify-between gap-3 mb-5">
              <button onClick={() => router.push("/portal/dashboard")}
                className="bv-row-hover inline-flex items-center gap-1.5 text-[12px] font-medium px-2 py-1"
                style={{ color: "var(--w3)" }}>
                <ArrowLeft size={13} strokeWidth={1.8} /> {t.back}
              </button>
              <div className="flex items-center gap-2">
                {(() => {
                  const atMax  = wordCount >= MAX_WORDS;
                  const tooShort = wordCount < MIN_RECOMMENDED;
                  const ok = !atMax && !tooShort;
                  const color = ok ? "var(--success)" : "var(--danger)";
                  const hint  = atMax
                    ? (lang === "de" ? "Limit – eine Seite" : lang === "fr" ? "limite – une page" : "limit – one page")
                    : tooShort
                      ? (lang === "de" ? `zu kurz – min ${MIN_RECOMMENDED}` : lang === "fr" ? `trop court – min ${MIN_RECOMMENDED}` : `too short – min ${MIN_RECOMMENDED}`)
                      : (lang === "de" ? "ideal" : lang === "fr" ? "idéal" : "ideal");
                  return (
                    <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full"
                      style={{
                        background: ok ? "var(--bg2)" : "var(--danger-bg, rgba(255,69,58,0.12))",
                        color,
                        border: `1px solid ${ok ? "var(--border)" : "var(--danger-border, rgba(255,69,58,0.35))"}`,
                      }}>
                      {wordCount} / {MAX_WORDS} · {hint}
                    </span>
                  );
                })()}
                <AutosaveIndicator savedAt={savedAt} />
              </div>
            </div>
            <div className="text-center">
              <h1 className="font-semibold tracking-[-0.02em] leading-tight" style={{ color: "var(--w)" }}>
                <span className="block text-[18px] font-medium" style={{ color: "var(--w2)" }}>
                  {t.buildWith}
                </span>
                <span className="block font-[family-name:var(--font-dm-serif)] italic font-normal text-[44px] leading-[1.05] mt-1">
                  Borivon<span style={{ color: "var(--gold)" }} className="not-italic">.</span>
                </span>
              </h1>
            </div>
          </div>

          {/* DEBUG — shows raw DB values when sender block has missing fields.
              Visible only to candidates with at least one blank sender field
              so a fully-populated letter doesn't show it. Remove after
              verifying the fill works for everyone. */}
          {letterDebug && (!person?.street || !person?.postal || !person?.city) && (
            <div className="bv-noprint mb-4 mx-auto" style={{ maxWidth: 794 }}>
              <details style={{ background: "var(--card)", border: "1px solid var(--border-gold)", borderRadius: 12, padding: "8px 12px" }}>
                <summary className="text-[11.5px] font-semibold cursor-pointer" style={{ color: "var(--gold)" }}>
                  Sender block is missing fields — click to inspect what the server returned
                </summary>
                <pre style={{
                  fontSize: 10.5,
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  color: "var(--w2)",
                  marginTop: 10,
                  maxHeight: 320,
                  overflow: "auto",
                }}>
                  {String(JSON.stringify(letterDebug, null, 2) ?? "")}
                </pre>
                <p className="text-[10px] mt-2" style={{ color: "var(--w3)" }}>
                  If <code>passport.address_street</code> is <code>null</code> but you entered an address as admin, it means
                  the admin edit didn't persist into the candidate's row. Tell Claude what you see here and the fix
                  follows in one round-trip.
                </p>
              </details>
            </div>
          )}

          {/* Document sheet */}
          <div id="bv-doc-sheet" className="mx-auto"
            style={{ width: "100%", maxWidth: "794px",
              padding: "56px 64px", background: "var(--card)",
              border: "1px solid var(--border)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3), 0 8px 28px rgba(0,0,0,0.45)",
              borderRadius: 4, fontFamily: "'Lexend', system-ui, sans-serif",
              fontSize: 14, lineHeight: 1.55, color: "var(--w)" }}>

            <Locked align="right" lockable onLock={() => setLockedPopupOpen(true)} lines={[
              fullName, streetLn, placeLn,
              person.phone ? `Telefon: ${person.phone}` : "—",
              person.email || "—",
            ]} />

            <div style={{ marginTop: 28 }}>
              {campusAssigned ? (
                <Locked align="left" lines={[...recipient]} />
              ) : (
                <Locked align="left" waitable onWait={() => setEmployerPopupOpen(true)}
                  lines={["—", "—", "—", "—", "—"]} />
              )}
            </div>

            <div style={{ marginTop: 24 }}>
              <Locked align="right" lockable lockLead onLock={() => setLockedPopupOpen(true)} lines={[dateLn]} />
            </div>

            <div style={{ marginTop: 28 }}>
              {campusAssigned ? (
                <Locked align="left" lines={[`${BETREFF_PREFIX} ${employerName}`]} bold />
              ) : (
                <Locked align="left" bold waitable onWait={() => setEmployerPopupOpen(true)}
                  lines={[`${BETREFF_PREFIX} —`]} />
              )}
            </div>

            <div style={{ marginTop: 20 }}>
              <Locked align="left" lines={["Sehr geehrte Damen und Herren,"]} />
            </div>

            <div id="bv-body" ref={editorRef} contentEditable
              suppressContentEditableWarning data-ph={t.ph}
              onInput={handleBodyInput} spellCheck
              style={{ marginTop: 18, minHeight: "200px" }} />

            <div style={{ marginTop: 24 }}>
              <Locked align="left" lockable onLock={() => setLockedPopupOpen(true)}
                lines={["Mit freundlichen Grüßen", fullName]} />
            </div>

          </div>

          {/* ── Generate / Preview / Submit (mirrors the CV builder) ── */}
          <div className="mt-6 bv-noprint">
            {!pdfUrl ? (
              <div className="text-center">
                <button onClick={handleGenerate} disabled={generating}
                  className="inline-flex items-center gap-2 px-8 py-4 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50 w-full sm:w-auto justify-center"
                  style={{ background: "var(--gold)", color: "#131312", borderRadius: "16px", boxShadow: "var(--shadow-gold-lg)" }}>
                  {generating
                    ? <><Spinner size="sm" color="#131312" /> {lang === "de" ? "Wird erstellt…" : lang === "fr" ? "Génération…" : "Generating…"}</>
                    : <><FileText size={15} strokeWidth={1.8} /> {lang === "de" ? "PDF erstellen" : lang === "fr" ? "Générer le PDF" : "Generate PDF"}</>}
                </button>
                {genError && (
                  <div className="mt-4 mx-auto max-w-md rounded-2xl px-4 py-3.5 text-left"
                    style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-border)" }}>
                    <p className="text-[12.5px] font-semibold flex items-center gap-1.5" style={{ color: "var(--danger)" }}>
                      <AlertTriangle size={13} strokeWidth={1.9} /> {genError}
                    </p>
                    {missingFields.length > 0 && (
                      <ul className="space-y-1 mt-2 pl-0.5">
                        {missingFields.map(f => (
                          <li key={f} className="text-[11.5px] flex items-center gap-2" style={{ color: "var(--danger)" }}>
                            <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: "var(--danger)" }} />
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-7 text-center"
                style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>
                <span className="mx-auto mb-3 flex items-center justify-center w-12 h-12 rounded-full"
                  style={{ background: "var(--success-bg)", color: "var(--success)" }}>
                  <CheckCircle2 size={22} strokeWidth={1.6} />
                </span>
                <p className="text-[16px] font-semibold tracking-[-0.01em] mb-1.5" style={{ color: "var(--w)" }}>
                  {lang === "de" ? "Motivationsschreiben erstellt" : lang === "fr" ? "Lettre générée" : "Cover letter ready"}
                </p>
                <p className="text-[12.5px] mb-6" style={{ color: "var(--w3)" }}>
                  {lang === "de" ? "Vorschau ansehen, dann ins Dossier senden." : lang === "fr" ? "Vérifiez l'aperçu, puis envoyez au dossier." : "Check the preview, then submit to your dossier."}
                </p>
                {uploaded ? (
                  <span className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold tracking-tight"
                    style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: "var(--r-md, 12px)" }}>
                    <CheckCircle2 size={14} strokeWidth={1.8} /> {lang === "de" ? "Gesendet" : lang === "fr" ? "Envoyé" : "Submitted"}
                  </span>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <button onClick={() => { setPdfUrl(null); setPdfBlob(null); setUploaded(false); }}
                      className="inline-flex items-center gap-2 px-8 py-4 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] w-full sm:w-auto justify-center"
                      style={{ background: "var(--gold)", color: "#131312", borderRadius: "16px", boxShadow: "var(--shadow-gold-lg)" }}>
                      <FilePen size={15} strokeWidth={1.8} /> {lang === "de" ? "Weiter bearbeiten" : lang === "fr" ? "Continuer à éditer" : "Keep editing"}
                    </button>
                    <div className="flex gap-2.5 justify-center flex-wrap mt-1">
                      <button onClick={() => setShowPreview(true)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold tracking-tight transition-opacity hover:opacity-90"
                        style={{ background: "var(--card2, var(--bg2))", color: "var(--w)", border: "1px solid var(--border)", borderRadius: "var(--r-md, 12px)" }}>
                        <FileText size={14} strokeWidth={1.8} /> {lang === "de" ? "Vorschau" : lang === "fr" ? "Aperçu" : "Preview"}
                      </button>
                      <button onClick={() => setShowSubmitConfirm(true)} disabled={uploading}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold tracking-tight transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: "var(--r-md, 12px)" }}>
                        <Upload size={14} strokeWidth={1.8} /> {uploading ? (lang === "de" ? "Senden…" : lang === "fr" ? "Envoi…" : "Submitting…") : (lang === "de" ? "Ins Dossier senden" : lang === "fr" ? "Envoyer au dossier" : "Submit to dossier")}
                      </button>
                    </div>
                  </div>
                )}
                {uploadErr && <p className="mt-3 text-[12.5px] inline-flex items-center gap-1.5 justify-center" style={{ color: "var(--danger)" }}><AlertTriangle size={12} strokeWidth={1.8} /> {uploadErr}</p>}
              </div>
            )}
          </div>

        </div>
      </main>

      <PassportLockPopup
        open={lockedPopupOpen}
        onClose={() => setLockedPopupOpen(false)}
        passportStatus={passportStatus}
      />

      <EmployerPendingPopup
        open={employerPopupOpen}
        onClose={() => setEmployerPopupOpen(false)}
      />

      {/* ── PDF Preview modal (copied from CV builder) ── */}
      {showPreview && pdfUrl && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-x-0 z-[800] flex items-center justify-center px-2"
          style={{ background: "rgba(0,0,0,0.72)", top: "calc(58px + var(--bv-subnav-h, 0px))", paddingTop: "6px", bottom: 0 }}
          onClick={() => setShowPreview(false)}>
          <div className="w-full max-w-3xl flex flex-col overflow-hidden"
            style={{
              height: "calc(100dvh - 58px - 24px)", maxHeight: "calc(100dvh - 58px - 24px)",
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-2xl, 20px)", boxShadow: "var(--shadow-lg)",
              animation: "bvFadeRise 0.22s var(--ease-out)",
            }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-[13.5px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                {lang === "de" ? "Vorschau" : lang === "fr" ? "Aperçu" : "Preview"}
              </p>
              <div className="flex items-center gap-2">
                <a href={pdfUrl}
                  download={`motivationsschreiben_${[person.firstName, person.lastName].filter(Boolean).join("_").toLowerCase() || "letter"}.pdf`}
                  className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ color: "var(--w2)" }} title="Download">
                  <Download size={14} strokeWidth={1.8} />
                </a>
                <button onClick={() => setShowPreview(false)}
                  className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ color: "var(--w2)" }}>
                  <XIcon size={16} strokeWidth={1.8} />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <PdfViewer src={pdfUrl} />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Submit confirmation modal (copied from CV builder) ── */}
      {showSubmitConfirm && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[800] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.72)" }}
          onClick={() => setShowSubmitConfirm(false)}>
          <div className="w-full max-w-md p-7 flex flex-col items-center text-center"
            style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-2xl, 20px)", boxShadow: "var(--shadow-lg)",
              animation: "bvFadeRise 0.22s var(--ease-out)",
            }}
            onClick={e => e.stopPropagation()}>
            <span className="mb-4 flex items-center justify-center w-12 h-12 rounded-full"
              style={{ background: "rgba(224,176,0,0.12)", color: "var(--gold)" }}>
              <AlertTriangle size={22} strokeWidth={1.6} />
            </span>
            <p className="text-[16px] font-semibold tracking-[-0.01em] mb-2" style={{ color: "var(--w)" }}>
              {lang === "de" ? "Ins Dossier senden?" : lang === "fr" ? "Envoyer au dossier ?" : "Submit to dossier?"}
            </p>
            <p className="text-[13px] leading-relaxed mb-7" style={{ color: "var(--w3)" }}>
              {lang === "de" ? "Ihr Motivationsschreiben wird in Ihr Dossier hochgeladen und vom Team geprüft."
                : lang === "fr" ? "Votre lettre sera envoyée dans votre dossier et examinée par l'équipe."
                : "Your cover letter will be uploaded to your dossier and reviewed by the team."}
            </p>
            <button onClick={() => setShowSubmitConfirm(false)}
              className="inline-flex items-center gap-2 px-8 py-4 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] w-full justify-center mb-3"
              style={{ background: "var(--gold)", color: "#131312", borderRadius: "16px", boxShadow: "var(--shadow-gold-lg)" }}>
              <FilePen size={15} strokeWidth={1.8} /> {lang === "de" ? "Weiter bearbeiten" : lang === "fr" ? "Continuer à éditer" : "Keep editing"}
            </button>
            <button onClick={async () => { setShowSubmitConfirm(false); await handleUpload(); }} disabled={uploading}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold tracking-tight transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: "var(--r-md, 12px)" }}>
              <Upload size={14} strokeWidth={1.8} /> {uploading ? (lang === "de" ? "Senden…" : lang === "fr" ? "Envoi…" : "Submitting…") : (lang === "de" ? "Senden" : lang === "fr" ? "Envoyer" : "Submit")}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

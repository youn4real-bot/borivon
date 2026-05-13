"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Plus, Minus, X as XIcon, Building2, CheckCircle, Clock, Users, FileText, Calendar, Pencil, ChevronDown, ChevronUp, Save, Video, Phone, MapPin } from "lucide-react";
import { PageLoader, Spinner } from "@/components/ui/states";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";

const t = {
  en: {
    ourNeeds: "Our needs",
    addNeed: "Add need",
    addFirstNeed: "Add your first need",
    newRequirement: "New requirement",
    typeOfFacility: "Type of facility *",
    bundesland: "Bundesland",
    optional: "— optional —",
    city: "City",
    cityPlaceholder: "e.g. Berlin",
    slotsNeeded: "Slots needed",
    startDate: "Official work start date",
    startDateHint: "The day they officially begin working at your facility",
    flightDate: "Flight to Germany",
    flightDateHint: "Expected arrival date in Germany",
    visaDocsDate: "Morocco papers ready (Visa)",
    visaDocsDateHint: "Deadline for all docs to be ready in Morocco to apply for the Visa",
    b2Deadline: "B2 certificate deadline",
    b2ExpectedExam: "Expected B2 exam",
    b2ActualExam: "B2 exam (confirmed date)",
    additionalNotes: "Additional notes (optional)",
    anySpecificReqs: "Any specific requirements…",
    tlMilestone0: "Visa docs ready",
    tlMilestone1: "Flight",
    tlMilestone2: "Work start",
    tlMilestone3: "B2 deadline",
    searchingCandidates: "Borivon received your request and is matching candidates",
    timelineHint: "Fill in the dates above to help us plan the arrival journey",
    saving: "Saving…",
    submitRequirement: "Submit requirement",
    cancel: "Cancel",
    noOpenRequirements: "No open requirements",
    tellUsWhatFacility: "Tell us what type of facility you need staff for. We'll match the right candidates automatically.",
    closedRequirements: (n: number) => `+ ${n} closed requirement${n !== 1 ? "s" : ""}`,
    openBadge: "open",
    slots: (n: number) => `${n} slot${n !== 1 ? "s" : ""}`,
    headerStats: (r: number, c: number) =>
      `${r} open requirement${r !== 1 ? "s" : ""} · ${c} candidate${c !== 1 ? "s" : ""}`,
    ourCandidates: "Our candidates",
    noCandidatesYet: "No candidates yet",
    oncWeMatch: "Once we match a candidate to your org, they'll appear here.",
    profileVerified: "Profile verified",
    verificationInProgress: "Verification in progress",
    pleaseSelectFacility: "Please select a facility type.",
    couldNotSave: "Could not save.",
    month: "Month",
    day: "Day",
    year: "Year",
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    closeReq: "Close requirement",
    institutionName: "Institution name",
    institutionNamePh: "e.g. Charité Berlin, St. Marien Krankenhaus",
    nationality: "Preferred nationality",
    nationalityPh: "Any",
    sectionInstitution: "Institution",
    sectionLocation: "Location",
    sectionCandidate: "Candidate preferences",
    sectionTimeline: "Timeline",
    sectionNotes: "Notes",
    timelineToggle: "+ Add dates (optional)",
    timelineHide: "− Hide dates",
    saveChanges: "Save changes",
    edit: "Edit",
    gesprachTitle: "Interview",
    gesprachLink: "Interview link",
    gesprachLinkPh: "https://meet.google.com/…",
    gesprachDate: "Interview date",
    gesprachType: "Type",
    gesprachTypeVideo: "Video",
    gesprachTypePhone: "Phone",
    gesprachTypePerson: "In-person",
    gesprachStatus: "Result",
    gesprachPassed: "Passed",
    gesprachFailed: "Failed",
    gesprachPending: "Pending",
    gesprachNotes: "Internal notes",
    gesprachNotesPh: "Confidential — not visible to candidate",
    gesprachSave: "Save",
    gesprachSaving: "Saving…",
    gesprachSaved: "Saved",
    gesprachError: "Could not save",
  },
  fr: {
    ourNeeds: "Nos besoins",
    addNeed: "Ajouter un besoin",
    addFirstNeed: "Ajouter votre premier besoin",
    newRequirement: "Nouveau besoin",
    typeOfFacility: "Type d'établissement *",
    bundesland: "Bundesland",
    optional: "— optionnel —",
    city: "Ville",
    cityPlaceholder: "ex. Berlin",
    slotsNeeded: "Places nécessaires",
    startDate: "Date officielle de début de travail",
    startDateHint: "Le jour où ils commencent officiellement dans votre établissement",
    flightDate: "Vol vers l'Allemagne",
    flightDateHint: "Date d'arrivée prévue en Allemagne",
    visaDocsDate: "Documents Maroc prêts (Visa)",
    visaDocsDateHint: "Date limite pour avoir tous les documents prêts au Maroc pour le Visa",
    b2Deadline: "Date limite certificat B2",
    b2ExpectedExam: "Examen B2 prévu",
    b2ActualExam: "Examen B2 (date confirmée)",
    additionalNotes: "Notes supplémentaires (optionnel)",
    anySpecificReqs: "Exigences spécifiques…",
    tlMilestone0: "Docs Visa prêts",
    tlMilestone1: "Vol",
    tlMilestone2: "Début travail",
    tlMilestone3: "Deadline B2",
    searchingCandidates: "Borivon a reçu votre demande et recherche des candidats",
    timelineHint: "Renseignez les dates ci-dessus pour nous aider à planifier l'arrivée",
    saving: "Enregistrement…",
    submitRequirement: "Soumettre le besoin",
    cancel: "Annuler",
    noOpenRequirements: "Aucun besoin ouvert",
    tellUsWhatFacility: "Dites-nous de quel type d'établissement vous avez besoin. Nous trouverons les bons candidats automatiquement.",
    closedRequirements: (n: number) => `+ ${n} besoin${n !== 1 ? "s" : ""} fermé${n !== 1 ? "s" : ""}`,
    openBadge: "ouvert",
    slots: (n: number) => `${n} poste${n !== 1 ? "s" : ""}`,
    headerStats: (r: number, c: number) =>
      `${r} besoin${r !== 1 ? "s" : ""} ouvert${r !== 1 ? "s" : ""} · ${c} candidat${c !== 1 ? "s" : ""}`,
    ourCandidates: "Nos candidats",
    noCandidatesYet: "Aucun candidat pour l'instant",
    oncWeMatch: "Dès qu'un candidat est associé à votre organisation, il apparaîtra ici.",
    profileVerified: "Profil vérifié",
    verificationInProgress: "Vérification en cours",
    pleaseSelectFacility: "Veuillez sélectionner un type d'établissement.",
    couldNotSave: "Impossible d'enregistrer.",
    month: "Mois",
    day: "Jour",
    year: "Année",
    months: ["Jan", "Fév", "Mar", "Avr", "Mai", "Jui", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"],
    closeReq: "Fermer le besoin",
    institutionName: "Nom de l'établissement",
    institutionNamePh: "ex. Charité Berlin, St. Marien Krankenhaus",
    nationality: "Nationalité préférée",
    nationalityPh: "Indifférent",
    sectionInstitution: "Établissement",
    sectionLocation: "Localisation",
    sectionCandidate: "Préférences candidat",
    sectionTimeline: "Calendrier",
    sectionNotes: "Notes",
    timelineToggle: "+ Ajouter des dates (optionnel)",
    timelineHide: "− Masquer les dates",
    saveChanges: "Enregistrer",
    edit: "Modifier",
    gesprachTitle: "Entretien",
    gesprachLink: "Lien de l'entretien",
    gesprachLinkPh: "https://meet.google.com/…",
    gesprachDate: "Date de l'entretien",
    gesprachType: "Type",
    gesprachTypeVideo: "Vidéo",
    gesprachTypePhone: "Téléphone",
    gesprachTypePerson: "Présentiel",
    gesprachStatus: "Résultat",
    gesprachPassed: "Réussi",
    gesprachFailed: "Échoué",
    gesprachPending: "En attente",
    gesprachNotes: "Notes internes",
    gesprachNotesPh: "Confidentiel — non visible par le candidat",
    gesprachSave: "Enregistrer",
    gesprachSaving: "Enregistrement…",
    gesprachSaved: "Enregistré",
    gesprachError: "Impossible d'enregistrer",
  },
  de: {

    ourNeeds: "Unser Bedarf",
    addNeed: "Bedarf hinzufügen",
    addFirstNeed: "Ersten Bedarf hinzufügen",
    newRequirement: "Neuer Bedarf",
    typeOfFacility: "Art der Einrichtung *",
    bundesland: "Bundesland",
    optional: "— optional —",
    city: "Stadt",
    cityPlaceholder: "z. B. Berlin",
    slotsNeeded: "Benötigte Stellen",
    startDate: "Offizieller Arbeitsbeginn",
    startDateHint: "Der Tag, an dem sie offiziell in Ihrer Einrichtung beginnen",
    flightDate: "Flug nach Deutschland",
    flightDateHint: "Voraussichtliches Ankunftsdatum in Deutschland",
    visaDocsDate: "Marokko-Unterlagen bereit (Visum)",
    visaDocsDateHint: "Frist, bis alle Unterlagen in Marokko für die Visum-Beantragung bereit sein müssen",
    b2Deadline: "B2-Zertifikat-Deadline",
    b2ExpectedExam: "Erwartete B2-Prüfung",
    b2ActualExam: "B2-Prüfung (bestätigtes Datum)",
    additionalNotes: "Zusätzliche Notizen (optional)",
    anySpecificReqs: "Besondere Anforderungen…",
    tlMilestone0: "Visa-Unterlagen bereit",
    tlMilestone1: "Flug",
    tlMilestone2: "Arbeitsbeginn",
    tlMilestone3: "B2-Deadline",
    searchingCandidates: "Borivon hat Ihre Anfrage erhalten und sucht passende Kandidaten",
    timelineHint: "Füllen Sie die Daten oben aus, damit wir die Anreise planen können",
    saving: "Speichern…",
    submitRequirement: "Anforderung einreichen",
    cancel: "Abbrechen",
    noOpenRequirements: "Keine offenen Anforderungen",
    tellUsWhatFacility: "Sagen Sie uns, welche Art von Einrichtung Sie benötigen. Wir finden automatisch passende Kandidaten.",
    closedRequirements: (n: number) => `+ ${n} geschlossene Anforderung${n !== 1 ? "en" : ""}`,
    openBadge: "offen",
    slots: (n: number) => `${n} Stelle${n !== 1 ? "n" : ""}`,
    headerStats: (r: number, c: number) =>
      `${r} offene Anforderung${r !== 1 ? "en" : ""} · ${c} Kandidat${c !== 1 ? "en" : ""}`,
    ourCandidates: "Unsere Kandidaten",
    noCandidatesYet: "Noch keine Kandidaten",
    oncWeMatch: "Sobald wir einen Kandidaten Ihrer Organisation zuordnen, erscheint er hier.",
    profileVerified: "Profil verifiziert",
    verificationInProgress: "Überprüfung läuft",
    pleaseSelectFacility: "Bitte wählen Sie einen Einrichtungstyp aus.",
    couldNotSave: "Konnte nicht gespeichert werden.",
    month: "Monat",
    day: "Tag",
    year: "Jahr",
    months: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
    closeReq: "Anforderung schließen",
    institutionName: "Name der Einrichtung",
    institutionNamePh: "z. B. Charité Berlin, St. Marien Krankenhaus",
    nationality: "Bevorzugte Nationalität",
    nationalityPh: "Egal",
    sectionInstitution: "Einrichtung",
    sectionLocation: "Standort",
    sectionCandidate: "Kandidatenpräferenzen",
    sectionTimeline: "Zeitplan",
    sectionNotes: "Notizen",
    timelineToggle: "+ Daten hinzufügen (optional)",
    timelineHide: "− Daten ausblenden",
    saveChanges: "Änderungen speichern",
    edit: "Bearbeiten",
    gesprachTitle: "Gespräch",
    gesprachLink: "Interview-Link",
    gesprachLinkPh: "https://meet.google.com/…",
    gesprachDate: "Gesprächsdatum",
    gesprachType: "Typ",
    gesprachTypeVideo: "Video",
    gesprachTypePhone: "Telefon",
    gesprachTypePerson: "Persönlich",
    gesprachStatus: "Ergebnis",
    gesprachPassed: "Bestanden",
    gesprachFailed: "Nicht bestanden",
    gesprachPending: "Ausstehend",
    gesprachNotes: "Interne Notizen",
    gesprachNotesPh: "Vertraulich — für Kandidat nicht sichtbar",
    gesprachSave: "Speichern",
    gesprachSaving: "Speichern…",
    gesprachSaved: "Gespeichert",
    gesprachError: "Speichern fehlgeschlagen",
  },
};

const BUNDESLAENDER = [
  "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen",
  "Hamburg", "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen",
  "Nordrhein-Westfalen", "Rheinland-Pfalz", "Saarland", "Sachsen",
  "Sachsen-Anhalt", "Schleswig-Holstein", "Thüringen",
];

const FACILITY_TYPES = ["Klinik", "Altenheim", "Ambulante Pflegedienst"] as const;
const YEARS = Array.from({ length: 7 }, (_, i) => String(new Date().getFullYear() + i));
const DAYS  = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

/* ── Notes codec ─────────────────────────────────────────────────────────────
   We store B2 info alongside notes as a lightweight JSON envelope so we don't
   need new DB columns. Plain-text legacy notes are detected and preserved.
*/
function parseNotes(raw: string | null) {
  if (!raw) return { text: "", b2d: "", b2e: "", b2x: "", flt: "", vis: "", inst: "", nat: "" };
  if (raw.startsWith("{")) {
    try {
      const j = JSON.parse(raw) as { text?: string; b2d?: string; b2e?: string; b2x?: string; flt?: string; vis?: string; inst?: string; nat?: string };
      return {
        text: j.text ?? "", b2d: j.b2d ?? "", b2e: j.b2e ?? "", b2x: j.b2x ?? "",
        flt: j.flt ?? "", vis: j.vis ?? "",
        inst: j.inst ?? "", nat: j.nat ?? "",
      };
    } catch { /* fall through */ }
  }
  return { text: raw, b2d: "", b2e: "", b2x: "", flt: "", vis: "", inst: "", nat: "" };
}
function serializeNotes(text: string, b2d: string, b2e: string, b2x: string, flt: string, vis: string, inst: string, nat: string): string | null {
  const t2 = text.trim(), d2 = b2d.trim(), e2 = b2e.trim(), x2 = b2x.trim(), f2 = flt.trim(), v2 = vis.trim();
  const i2 = inst.trim(), n2 = nat.trim();
  if (!t2 && !d2 && !e2 && !x2 && !f2 && !v2 && !i2 && !n2) return null;
  if (!d2 && !e2 && !x2 && !f2 && !v2 && !i2 && !n2) return t2 || null;
  const obj: Record<string, string> = {};
  if (t2) obj.text = t2;
  if (d2) obj.b2d  = d2;
  if (e2) obj.b2e  = e2;
  if (x2) obj.b2x  = x2;
  if (f2) obj.flt  = f2;
  if (v2) obj.vis  = v2;
  if (i2) obj.inst = i2;
  if (n2) obj.nat  = n2;
  return JSON.stringify(obj);
}

/* ── Compact date input — single native input, premium minimal ─────────────── */
function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "5px 10px",
        color: value ? "var(--w)" : "var(--w3)",
        fontSize: "12px",
        colorScheme: "dark",
        outline: "none",
        cursor: "pointer",
        minWidth: 0,
        flexShrink: 0,
      }}
    />
  );
}

/* ── Format a YYYY-MM-DD string for display ─────────────────────────────────── */
function fmtDate(iso: string, months: string[]) {
  const [y, m, d] = iso.split("-");
  const lbl = months[parseInt(m) - 1] ?? m;
  return `${parseInt(d)} ${lbl} ${y}`;
}

type Req = {
  id: string;
  facility_type: string | null;
  bundesland: string | null;
  city: string | null;
  slots: number;
  start_date: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

type Candidate = { userId: string; name: string; email: string; verified: boolean; profilePhoto: string | null };

type OrgData = {
  org: { id: string; name: string; logo_filename: string | null; footer_text: string | null; notes: string | null; memberRole: string };
  requirements: Req[];
  candidates: Candidate[];
};

type CandidatePipeline = {
  interview_link: string;
  interview_date: string;
  interview_type: string;
  interview_status: string;
  interview_notes: string;
};

export default function OrgDashboardPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = t[lang as keyof typeof t] ?? t.en;

  const [loading, setLoading] = useState(true);
  const [token, setToken]     = useState("");
  const [data, setData]       = useState<OrgData | null>(null);

  // Form state
  const [showForm, setShowForm]         = useState(false);
  const [facilityType, setFacilityType] = useState<string>("");
  const [bundesland, setBundesland]     = useState("");
  const [city, setCity]                 = useState("");
  const [slots, setSlots]               = useState("1");
  const [startDate, setStartDate]       = useState("");
  const [flightDate, setFlightDate]         = useState("");
  const [visaDocsDate, setVisaDocsDate]     = useState("");
  const [b2Deadline, setB2Deadline]         = useState("");
  const [b2ExpectedExam, setB2ExpectedExam] = useState(""); // date — approx when they hope to sit B2
  const [b2ActualExam, setB2ActualExam]     = useState(""); // date — confirmed exam date
  const [notes, setNotes]               = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [nationality, setNationality]   = useState("Marokko");
  const [showTimeline, setShowTimeline] = useState(false);
  const [saving, setSaving]             = useState(false);
  const [formError, setFormError]       = useState("");

  // Edit existing requirement
  const [editReqId, setEditReqId]       = useState<string | null>(null);

  // Gespräch (interview) pipeline per candidate
  const [expandedCandidate, setExpandedCandidate] = useState<string | null>(null);
  const [candidatePipelines, setCandidatePipelines] = useState<Record<string, CandidatePipeline>>({});
  const [pipelineLoading, setPipelineLoading] = useState<Record<string, boolean>>({});
  const [pipelineSaving, setPipelineSaving] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});

  // Dynamic phase slots (Bearbeitung / Visum) — org-scoped
  type PhaseSlot = { id: string; org_id: string | null; phase: string; type: "simple" | "dual"; label: string; label_trans: string | null; position: number };
  const [orgSlots, setOrgSlots] = useState<{ bea: PhaseSlot[]; vis: PhaseSlot[] }>({ bea: [], vis: [] });
  const [orgSlotsLoaded, setOrgSlotsLoaded] = useState(false);
  const [activeSlotTab, setActiveSlotTab] = useState<"bea" | "vis">("bea");
  const [addSlotPhase, setAddSlotPhase] = useState<string | null>(null);
  const [addSlotType, setAddSlotType]   = useState<"simple" | "dual">("simple");
  const [addSlotLabel, setAddSlotLabel] = useState("");
  const [addSlotLabelTrans, setAddSlotLabelTrans] = useState("");
  const [addSlotSaving, setAddSlotSaving] = useState(false);
  const orgDragIdx = useRef<number | null>(null);

  async function loadData(tk: string) {
    const res = await fetch("/api/portal/org/me", { headers: { Authorization: `Bearer ${tk}` } });
    if (!res.ok) { router.replace("/portal"); return; }
    const json = await res.json();
    setData(json);
    // Load org-specific phase slots
    const orgId = json?.org?.id;
    if (orgId && !orgSlotsLoaded) {
      setOrgSlotsLoaded(true);
      const [beaRes, visRes] = await Promise.all([
        fetch(`/api/portal/phase-slots?phase=bearbeitung&orgId=${orgId}`, { headers: { Authorization: `Bearer ${tk}` } }),
        fetch(`/api/portal/phase-slots?phase=visum&orgId=${orgId}`,       { headers: { Authorization: `Bearer ${tk}` } }),
      ]);
      const beaJ = beaRes.ok ? await beaRes.json() : { slots: [] };
      const visJ = visRes.ok ? await visRes.json() : { slots: [] };
      setOrgSlots({ bea: beaJ.slots ?? [], vis: visJ.slots ?? [] });
    }
  }

  async function addOrgSlot(phase: string, type: "simple" | "dual", label: string, labelTrans: string, orgId: string) {
    if (!token || !label.trim()) return;
    setAddSlotSaving(true);
    const res = await fetch("/api/portal/phase-slots", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phase, type, label: label.trim(), label_trans: labelTrans.trim() || undefined, orgId }),
    });
    if (res.ok) {
      const j = await res.json();
      const key = phase === "bearbeitung" ? "bea" : "vis";
      setOrgSlots(prev => ({ ...prev, [key]: [...prev[key], j.slot] }));
      setAddSlotPhase(null);
      setAddSlotLabel("");
      setAddSlotLabelTrans("");
    }
    setAddSlotSaving(false);
  }

  async function deleteOrgSlot(slotId: string, phase: string) {
    if (!token) return;
    await fetch("/api/portal/phase-slots", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: slotId }),
    });
    const key = phase === "bearbeitung" ? "bea" : "vis";
    setOrgSlots(prev => ({ ...prev, [key]: prev[key].filter(s => s.id !== slotId) }));
  }

  async function saveOrgSlotOrder(phase: string, slotList: { id: string; position: number }[]) {
    if (!token) return;
    await fetch("/api/portal/phase-slots", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ positions: slotList }),
    });
  }

  async function loadCandidatePipeline(userId: string) {
    if (candidatePipelines[userId] || pipelineLoading[userId]) return;
    setPipelineLoading(prev => ({ ...prev, [userId]: true }));
    const res = await fetch(`/api/portal/pipeline?userId=${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const j = await res.json();
      const p = j.pipeline ?? {};
      setCandidatePipelines(prev => ({
        ...prev,
        [userId]: {
          interview_link:   p.interview_link   ?? "",
          interview_date:   p.interview_date   ?? "",
          interview_type:   p.interview_type   ?? "",
          interview_status: p.interview_status ?? "",
          interview_notes:  p.interview_notes  ?? "",
        },
      }));
    }
    setPipelineLoading(prev => ({ ...prev, [userId]: false }));
  }

  async function saveCandidatePipeline(userId: string) {
    const pl = candidatePipelines[userId];
    if (!pl) return;
    setPipelineSaving(prev => ({ ...prev, [userId]: "saving" }));
    const res = await fetch("/api/portal/pipeline", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userId,
        interview_link:   pl.interview_link   || null,
        interview_date:   pl.interview_date   || null,
        interview_type:   pl.interview_type   || null,
        interview_status: pl.interview_status || null,
        interview_notes:  pl.interview_notes  || null,
      }),
    });
    setPipelineSaving(prev => ({ ...prev, [userId]: res.ok ? "saved" : "error" }));
    if (res.ok) {
      setTimeout(() => setPipelineSaving(prev => ({ ...prev, [userId]: "idle" })), 2000);
    }
  }

  function updatePipeline(userId: string, patch: Partial<CandidatePipeline>) {
    setCandidatePipelines(prev => ({
      ...prev,
      [userId]: { ...prev[userId], ...patch },
    }));
    setPipelineSaving(prev => ({ ...prev, [userId]: "idle" }));
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      setToken(tk);
      await loadData(tk);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setFacilityType(""); setBundesland(""); setCity(""); setSlots("1");
    setStartDate(""); setFlightDate(""); setVisaDocsDate("");
    setB2Deadline(""); setB2ExpectedExam(""); setB2ActualExam(""); setNotes("");
    setInstitutionName(""); setNationality("Marokko");
    setShowTimeline(false);
    setFormError("");
  }

  async function addRequirement() {
    if (!facilityType) { setFormError(T.pleaseSelectFacility); return; }
    setFormError("");
    setSaving(true);
    const serializedNotes = serializeNotes(notes, b2Deadline, b2ExpectedExam, b2ActualExam, flightDate, visaDocsDate, institutionName, nationality);
    const res = await fetch("/api/portal/org/requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        facility_type: facilityType,
        bundesland:    bundesland || null,
        city:          city || null,
        slots:         parseInt(slots) || 1,
        start_date:    startDate || null,
        notes:         serializedNotes,
      }),
    });
    if (res.ok) {
      const j = await res.json();
      setData(prev => prev ? { ...prev, requirements: [j.requirement, ...prev.requirements] } : prev);
      resetForm();
      setShowForm(false);
    } else {
      const j = await res.json().catch(() => ({}));
      setFormError(j?.error ?? T.couldNotSave);
    }
    setSaving(false);
  }

  async function closeRequirement(reqId: string) {
    await fetch("/api/portal/org/requirements", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requirementId: reqId }),
    });
    setData(prev => prev ? {
      ...prev,
      requirements: prev.requirements.map(r => r.id === reqId ? { ...r, active: false } : r),
    } : prev);
  }

  function openEditForm(r: Req) {
    const nb = parseNotes(r.notes);
    setEditReqId(r.id);
    setFacilityType(r.facility_type ?? "");
    setBundesland(r.bundesland ?? "");
    setCity(r.city ?? "");
    setSlots(String(r.slots));
    setStartDate(r.start_date ?? "");
    setFlightDate(nb.flt ?? "");
    setVisaDocsDate(nb.vis ?? "");
    setB2Deadline(nb.b2d ?? "");
    setB2ExpectedExam(nb.b2e ?? "");
    setB2ActualExam(nb.b2x ?? "");
    setNotes(nb.text ?? "");
    setInstitutionName(nb.inst ?? "");
    setNationality(nb.nat || "Marokko");
    // Auto-expand timeline section if any timeline date is filled
    setShowTimeline(!!(nb.vis || nb.flt || r.start_date || nb.b2d || nb.b2e || nb.b2x));
    setFormError("");
    setShowForm(false);
  }

  async function saveEditRequirement() {
    if (!editReqId || !facilityType) { setFormError(T.pleaseSelectFacility); return; }
    setFormError("");
    setSaving(true);
    const serializedNotes = serializeNotes(notes, b2Deadline, b2ExpectedExam, b2ActualExam, flightDate, visaDocsDate, institutionName, nationality);
    const res = await fetch("/api/portal/org/requirements", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requirementId: editReqId,
        facility_type: facilityType,
        bundesland:    bundesland || null,
        city:          city || null,
        slots:         parseInt(slots) || 1,
        start_date:    startDate || null,
        notes:         serializedNotes,
      }),
    });
    if (res.ok) {
      setData(prev => prev ? {
        ...prev,
        requirements: prev.requirements.map(r =>
          r.id === editReqId
            ? { ...r, facility_type: facilityType, bundesland: bundesland || null, city: city || null, slots: parseInt(slots) || 1, start_date: startDate || null, notes: serializedNotes }
            : r
        ),
      } : prev);
      setEditReqId(null);
      resetForm();
    } else {
      const j = await res.json().catch(() => ({}));
      setFormError(j?.error ?? T.couldNotSave);
    }
    setSaving(false);
  }

  const inp: React.CSSProperties = {
    background: "var(--bg2)",
    border: "1px solid var(--border)",
    color: "var(--w)",
    borderRadius: "10px",
    width: "100%",
    padding: "10px 13px",
    fontSize: "13px",
    outline: "none",
  };

  const labelCls = "block text-[10.5px] font-semibold uppercase tracking-wide mb-1.5";

  if (loading) return <PageLoader />;
  if (!data) return null;

  const { org, requirements, candidates } = data;
  const openReqs   = requirements.filter(r => r.active);
  const closedReqs = requirements.filter(r => !r.active);

  // ── Section header (small gold uppercase divider) ──────────────────
  const SectionHeader = ({ label }: { label: string }) => (
    <div className="flex items-center gap-2.5 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--gold)" }}>
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
    </div>
  );

  // ── Shared form fields (used by both add + edit forms) ─────────────
  const formFieldsBlock = (
    <>
      {/* SECTION: Institution */}
      <SectionHeader label={T.sectionInstitution} />

      <div>
        <label className={labelCls} style={{ color: "var(--w3)" }}>{T.institutionName}</label>
        <input type="text" value={institutionName} onChange={e => setInstitutionName(e.target.value)}
          placeholder={T.institutionNamePh} style={inp} />
      </div>

      <div>
        <label className={labelCls} style={{ color: "var(--w3)" }}>{T.typeOfFacility}</label>
        <div className="grid grid-cols-3 gap-2 min-w-0">
          {FACILITY_TYPES.map(ft => (
            <button key={ft} type="button" onClick={() => setFacilityType(ft)}
              className="py-2 px-2 text-[12px] font-semibold text-center transition-all"
              style={{
                background: facilityType === ft ? "var(--gdim)" : "var(--bg2)",
                color:      facilityType === ft ? "var(--gold)" : "var(--w2)",
                border:     `1.5px solid ${facilityType === ft ? "var(--border-gold)" : "var(--border)"}`,
                borderRadius: "10px",
              }}>
              {ft}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls} style={{ color: "var(--w3)" }}>{T.slotsNeeded}</label>
        <div className="flex items-center rounded-[10px] overflow-hidden w-32"
          style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
          <button type="button" onClick={() => setSlots(s => String(Math.max(1, parseInt(s || "1") - 1)))}
            className="w-10 h-10 flex items-center justify-center transition-colors hover:opacity-70"
            style={{ background: "transparent", border: "none", color: "var(--w2)", cursor: "pointer" }}>
            <Minus size={13} strokeWidth={2} />
          </button>
          <span className="flex-1 text-center text-[13px] font-semibold" style={{ color: "var(--w)" }}>
            {parseInt(slots) || 1}
          </span>
          <button type="button" onClick={() => setSlots(s => String(Math.min(99, parseInt(s || "1") + 1)))}
            className="w-10 h-10 flex items-center justify-center transition-colors hover:opacity-70"
            style={{ background: "transparent", border: "none", color: "var(--w2)", cursor: "pointer" }}>
            <Plus size={13} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* SECTION: Location */}
      <SectionHeader label={T.sectionLocation} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls} style={{ color: "var(--w3)" }}>{T.bundesland}</label>
          <select value={bundesland} onChange={e => setBundesland(e.target.value)}
            style={{ ...inp, appearance: "none" as const, cursor: "pointer" }}>
            <option value="">{T.optional}</option>
            {BUNDESLAENDER.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} style={{ color: "var(--w3)" }}>{T.city}</label>
          <input type="text" value={city} onChange={e => setCity(e.target.value)}
            placeholder={T.cityPlaceholder} style={inp} />
        </div>
      </div>

      {/* SECTION: Candidate preferences */}
      <SectionHeader label={T.sectionCandidate} />

      <div>
        <label className={labelCls} style={{ color: "var(--w3)" }}>{T.nationality}</label>
        <select value={nationality || "Marokko"} onChange={e => setNationality(e.target.value)}
          style={{ ...inp, appearance: "none" as const, cursor: "pointer" }}>
          {["Marokko", "Tunesien", "Algerien", "Ägypten", "Philippinen", "Indien", "Vietnam", "Mexiko", "Kosovo", "Bosnien", "Albanien", "Serbien", "Türkei", "Syrien", "Iran", "Irak", "Pakistan", "Bangladesh", "Nigeria", "Kamerun"].map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      {/* SECTION: Timeline (collapsible) */}
      <SectionHeader label={T.sectionTimeline} />

      <button type="button" onClick={() => setShowTimeline(v => !v)}
        className="w-full text-left text-[12px] font-medium px-3.5 py-2.5 rounded-xl transition-all flex items-center justify-between"
        style={{
          background: showTimeline ? "var(--gdim)" : "var(--bg2)",
          color: showTimeline ? "var(--gold)" : "var(--w3)",
          border: `1px solid ${showTimeline ? "var(--border-gold)" : "var(--border)"}`,
        }}>
        <span>{showTimeline ? T.timelineHide : T.timelineToggle}</span>
        <Calendar size={12} strokeWidth={1.8} />
      </button>

      {showTimeline && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {([
            { num: 1, emoji: "📝", label: T.b2ExpectedExam, value: b2ExpectedExam, set: setB2ExpectedExam },
            { num: 2, emoji: "✏️", label: T.b2ActualExam,   value: b2ActualExam,   set: setB2ActualExam },
            { num: 3, emoji: "📚", label: T.b2Deadline,     value: b2Deadline,     set: setB2Deadline },
            { num: 4, emoji: "🗂",  label: T.visaDocsDate,   value: visaDocsDate,   set: setVisaDocsDate },
            { num: 5, emoji: "🏥", label: T.startDate,      value: startDate,      set: setStartDate },
          ] as { num: number; emoji: string; label: string; value: string; set: (v: string) => void }[]).map((row, idx) => (
            <div key={row.num}
              className="flex items-center gap-3 px-3.5 py-2.5"
              style={{ borderTop: idx > 0 ? "1px solid var(--border)" : "none" }}>
              {/* Step number */}
              <span className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                style={{
                  background: row.value ? "var(--gdim)" : "var(--bg2)",
                  color:      row.value ? "var(--gold)"           : "var(--w3)",
                  border:     `1px solid ${row.value ? "var(--border-gold)" : "var(--border)"}`,
                }}>
                {row.num}
              </span>
              {/* Label */}
              <span className="flex-1 text-[12px] truncate" style={{ color: "var(--w2)" }}>
                {row.emoji} {row.label}
              </span>
              {/* Native date input — minimal */}
              <DateInput value={row.value} onChange={row.set} />
            </div>
          ))}
        </div>
      )}

      {/* SECTION: Notes */}
      <SectionHeader label={T.sectionNotes} />

      <div>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value.slice(0, 300))}
          maxLength={300} placeholder={T.anySpecificReqs} style={inp} />
      </div>
    </>
  );

  return (
    <>
    <PortalTopNav />
    <main className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "calc(58px + var(--bv-subnav-h, 44px) + 2rem)", paddingBottom: "4rem" }}>
      <div className="max-w-[720px] mx-auto px-4 pt-8">

        {/* Org header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
            {org.logo_filename?.startsWith("data:")
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={org.logo_filename} alt={org.name} className="w-12 h-12 object-contain" />
              : <Building2 size={22} strokeWidth={1.6} style={{ color: "var(--gold)" }} />
            }
          </div>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{org.name}</h1>
            <p className="text-[12.5px] mt-0.5" style={{ color: "var(--w3)" }}>
              {T.headerStats(openReqs.length, candidates.length)}
            </p>
          </div>
        </div>

        {/* ── Requirements section ── */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText size={15} strokeWidth={1.8} style={{ color: "var(--gold)" }} />
              <h2 className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>{T.ourNeeds}</h2>
              {openReqs.length > 0 && (
                <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: "var(--info-bg)", color: "var(--info)", border: "1px solid var(--info-border)" }}>
                  {openReqs.length} {T.openBadge}
                </span>
              )}
            </div>
            <button
              onClick={() => { setShowForm(v => !v); if (showForm) resetForm(); }}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 transition-all"
              style={{
                background: showForm ? "var(--bg2)" : "var(--gold)",
                color: showForm ? "var(--w2)" : "#131312",
                borderRadius: "10px",
                border: showForm ? "1px solid var(--border)" : "none",
              }}>
              {showForm ? <XIcon size={12} strokeWidth={2} /> : <Plus size={12} strokeWidth={2.2} />}
              {showForm ? T.cancel : T.addNeed}
            </button>
          </div>

          {/* ── Add form ── */}
          {showForm && (
            <div className="mb-4 p-5 rounded-2xl space-y-4"
              style={{ background: "var(--card)", border: "1px solid var(--border-gold)" }}>
              <div className="flex items-center gap-2 pb-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--gold)" }} />
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--gold)" }}>
                  {T.newRequirement}
                </p>
              </div>

              {formFieldsBlock}

              {formError && (
                <p className="text-[12px] px-3 py-2 rounded-lg"
                  style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                  {formError}
                </p>
              )}

              <button onClick={addRequirement} disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold transition-opacity disabled:opacity-50"
                style={{ background: "var(--gold)", color: "#131312", borderRadius: "10px" }}>
                {saving ? <Spinner size="xs" color="#131312" /> : <Plus size={13} strokeWidth={2.2} />}
                {saving ? T.saving : T.submitRequirement}
              </button>
            </div>
          )}

          {/* Empty state */}
          {openReqs.length === 0 && !showForm && (
            <div className="py-10 text-center rounded-2xl"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <FileText size={32} strokeWidth={1.2} style={{ color: "var(--w3)", margin: "0 auto 12px" }} />
              <p className="text-[13.5px] font-medium" style={{ color: "var(--w2)" }}>{T.noOpenRequirements}</p>
              <p className="text-[12px] mt-1.5 max-w-[280px] mx-auto" style={{ color: "var(--w3)" }}>
                {T.tellUsWhatFacility}
              </p>
              <button onClick={() => setShowForm(true)}
                className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-4 py-2"
                style={{ background: "var(--gold)", color: "#131312", borderRadius: "10px" }}>
                <Plus size={12} strokeWidth={2.2} />
                {T.addFirstNeed}
              </button>
            </div>
          )}

          {/* Open requirements */}
          {openReqs.length > 0 && (
            <div className="space-y-3">
              {openReqs.map(r => {
                const nb = parseNotes(r.notes);
                const isEditing = editReqId === r.id;
                return (
                  <div key={r.id} className="rounded-2xl overflow-hidden"
                    style={{ background: "var(--card)", border: `1px solid ${isEditing ? "var(--border-gold)" : "var(--border)"}` }}>
                    {/* Card header — always visible */}
                    <div className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: "var(--info-bg)", border: "1px solid var(--info-border)" }}>
                          <Clock size={14} strokeWidth={1.8} style={{ color: "var(--info)" }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* Institution name (if set) — bold heading */}
                          {nb.inst ? (
                            <p className="text-[14px] font-semibold leading-tight mb-0.5" style={{ color: "var(--w)" }}>
                              {nb.inst}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={`${nb.inst ? "text-[12px]" : "text-[13.5px] font-semibold"}`} style={{ color: nb.inst ? "var(--w2)" : "var(--w)" }}>
                              {r.facility_type}
                            </span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                              style={{ background: "var(--info-bg)", color: "var(--info)", border: "1px solid var(--info-border)" }}>
                              {T.slots(r.slots)}
                            </span>
                          </div>
                          {(r.bundesland || r.city) && (
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                              {r.bundesland && <span className="text-[11.5px]" style={{ color: "var(--w3)" }}>📍 {r.bundesland}</span>}
                              {r.city && <span className="text-[11.5px]" style={{ color: "var(--w3)" }}>{r.city}</span>}
                            </div>
                          )}
                          {(nb.nat || nb.b2d || nb.b2e || nb.b2x || nb.text) && (
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                              {nb.nat && (
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
                                  style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                                  🌍 {nb.nat}
                                </span>
                              )}
                              {nb.b2e && (
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
                                  style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                                  📝 {fmtDate(nb.b2e, T.months)}
                                </span>
                              )}
                              {nb.b2x && (
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
                                  style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                                  ✏️ {fmtDate(nb.b2x, T.months)}
                                </span>
                              )}
                              {nb.b2d && (
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium"
                                  style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                                  B2 ≤ {fmtDate(nb.b2d, T.months)}
                                </span>
                              )}
                              {nb.text && <span className="text-[11px]" style={{ color: "var(--w3)" }}>{nb.text}</span>}
                            </div>
                          )}
                        </div>
                        {/* Edit + Close buttons */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => isEditing ? (setEditReqId(null), resetForm()) : openEditForm(r)}
                            title={isEditing ? T.cancel : "Edit"}
                            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                            style={{ background: isEditing ? "var(--gdim)" : "transparent", color: isEditing ? "var(--gold)" : "var(--w3)", border: isEditing ? "1px solid var(--border-gold)" : "none" }}>
                            {isEditing ? <XIcon size={11} strokeWidth={2} /> : <Pencil size={11} strokeWidth={1.8} />}
                          </button>
                          {!isEditing && (
                            <button onClick={() => closeRequirement(r.id)} title={T.closeReq}
                              className="bv-icon-btn bv-icon-btn--reject w-7 h-7 rounded-full flex items-center justify-center">
                              <XIcon size={12} strokeWidth={1.8} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Inline edit form */}
                    {isEditing && (
                      <div className="px-4 pb-4 pt-4 space-y-4 border-t" style={{ borderColor: "var(--border-gold)" }}>
                        {formFieldsBlock}
                        {formError && (
                          <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                            {formError}
                          </p>
                        )}
                        <button onClick={saveEditRequirement} disabled={saving}
                          className="inline-flex items-center gap-2 px-5 py-2.5 text-[12.5px] font-semibold transition-opacity disabled:opacity-50"
                          style={{ background: "var(--gold)", color: "#131312", borderRadius: "10px" }}>
                          {saving ? <Spinner size="xs" color="#131312" /> : null}
                          {saving ? T.saving : T.saveChanges}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {closedReqs.length > 0 && (
            <p className="mt-3 text-[11.5px]" style={{ color: "var(--w3)" }}>
              {T.closedRequirements(closedReqs.length)}
            </p>
          )}
        </div>

        {/* ── Candidates section ── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Users size={15} strokeWidth={1.8} style={{ color: "var(--gold)" }} />
            <h2 className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>{T.ourCandidates}</h2>
            {candidates.length > 0 && (
              <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
                {candidates.length}
              </span>
            )}
          </div>

          {candidates.length === 0 ? (
            <div className="py-10 text-center rounded-2xl"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <Users size={32} strokeWidth={1.2} style={{ color: "var(--w3)", margin: "0 auto 12px" }} />
              <p className="text-[13.5px] font-medium" style={{ color: "var(--w2)" }}>{T.noCandidatesYet}</p>
              <p className="text-[12px] mt-1.5" style={{ color: "var(--w3)" }}>{T.oncWeMatch}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {candidates.map(c => {
                const isOpen = expandedCandidate === c.userId;
                const pl = candidatePipelines[c.userId];
                const plLoading = pipelineLoading[c.userId];
                const saveState = pipelineSaving[c.userId] ?? "idle";
                const btnInp: React.CSSProperties = {
                  background: "var(--bg2)", border: "1px solid var(--border)",
                  borderRadius: "8px", padding: "6px 10px", color: "var(--w)",
                  fontSize: "12.5px", outline: "none", width: "100%",
                };
                return (
                  <div key={c.userId} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "16px", overflow: "hidden" }}>
                    {/* Header row */}
                    <button type="button"
                      onClick={() => {
                        if (isOpen) { setExpandedCandidate(null); return; }
                        setExpandedCandidate(c.userId);
                        loadCandidatePipeline(c.userId);
                      }}
                      className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:opacity-90">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
                        style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
                        {c.profilePhoto
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={c.profilePhoto} alt={c.name} className="w-full h-full object-cover" />
                          : <span className="text-[13px] font-semibold" style={{ color: "var(--gold)" }}>
                              {c.name.charAt(0).toUpperCase()}
                            </span>
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[13.5px] font-semibold" style={{ color: "var(--w)" }}>{c.name}</p>
                          {c.verified && <VerifiedBadge verified={true} size="xs" color="gold" />}
                        </div>
                        <p className="text-[11.5px] mt-0.5"
                          style={{ color: c.verified ? "var(--success)" : "var(--w3)" }}>
                          {c.verified
                            ? <><CheckCircle size={10} strokeWidth={2} style={{ display: "inline", marginRight: 4 }} />{T.profileVerified}</>
                            : T.verificationInProgress
                          }
                        </p>
                      </div>
                      {isOpen ? <ChevronUp size={16} style={{ color: "var(--w3)", flexShrink: 0 }} /> : <ChevronDown size={16} style={{ color: "var(--w3)", flexShrink: 0 }} />}
                    </button>

                    {/* Gespräch panel */}
                    {isOpen && (
                      <div style={{ borderTop: "1px solid var(--border)", padding: "16px 16px 20px" }}>
                        {plLoading && !pl ? (
                          <div className="flex justify-center py-4"><Spinner /></div>
                        ) : pl ? (
                          <div className="space-y-3">
                            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--gold)" }}>{T.gesprachTitle}</p>

                            {/* Link */}
                            <div>
                              <label className="block text-[11.5px] mb-1" style={{ color: "var(--w3)" }}>{T.gesprachLink}</label>
                              <input style={btnInp} type="url" placeholder={T.gesprachLinkPh}
                                value={pl.interview_link}
                                onChange={e => updatePipeline(c.userId, { interview_link: e.target.value })} />
                            </div>

                            {/* Date */}
                            <div>
                              <label className="block text-[11.5px] mb-1" style={{ color: "var(--w3)" }}>{T.gesprachDate}</label>
                              <input style={{ ...btnInp, colorScheme: "dark", cursor: "pointer" }} type="date"
                                value={pl.interview_date}
                                onChange={e => updatePipeline(c.userId, { interview_date: e.target.value })} />
                            </div>

                            {/* Type */}
                            <div>
                              <label className="block text-[11.5px] mb-1.5" style={{ color: "var(--w3)" }}>{T.gesprachType}</label>
                              <div className="flex gap-2">
                                {(["video", "phone", "in-person"] as const).map(tp => {
                                  const label = tp === "video" ? T.gesprachTypeVideo : tp === "phone" ? T.gesprachTypePhone : T.gesprachTypePerson;
                                  const Icon = tp === "video" ? Video : tp === "phone" ? Phone : MapPin;
                                  const active = pl.interview_type === tp;
                                  return (
                                    <button key={tp} type="button"
                                      onClick={() => updatePipeline(c.userId, { interview_type: active ? "" : tp })}
                                      style={{
                                        padding: "5px 10px", borderRadius: "8px", fontSize: "12px",
                                        display: "flex", alignItems: "center", gap: "5px",
                                        background: active ? "var(--gdim)" : "var(--bg2)",
                                        border: `1px solid ${active ? "var(--border-gold)" : "var(--border)"}`,
                                        color: active ? "var(--gold)" : "var(--w3)",
                                        cursor: "pointer",
                                      }}>
                                      <Icon size={12} />{label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Status */}
                            <div>
                              <label className="block text-[11.5px] mb-1.5" style={{ color: "var(--w3)" }}>{T.gesprachStatus}</label>
                              <div className="flex gap-2">
                                {(["passed", "failed", ""] as const).map(st => {
                                  const label = st === "passed" ? T.gesprachPassed : st === "failed" ? T.gesprachFailed : T.gesprachPending;
                                  const active = pl.interview_status === st;
                                  const color = st === "passed" ? "var(--success)" : st === "failed" ? "var(--error, #ef4444)" : "var(--w3)";
                                  const bg = st === "passed" ? "var(--success-bg, rgba(34,197,94,0.1))" : st === "failed" ? "rgba(239,68,68,0.1)" : "var(--bg2)";
                                  const border = st === "passed" ? "var(--success-border, rgba(34,197,94,0.3))" : st === "failed" ? "rgba(239,68,68,0.3)" : "var(--border)";
                                  return (
                                    <button key={st} type="button"
                                      onClick={() => updatePipeline(c.userId, { interview_status: active ? "" : st })}
                                      style={{
                                        padding: "5px 12px", borderRadius: "8px", fontSize: "12px",
                                        background: active ? bg : "var(--bg2)",
                                        border: `1px solid ${active ? border : "var(--border)"}`,
                                        color: active ? color : "var(--w3)",
                                        cursor: "pointer",
                                      }}>
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Notes */}
                            <div>
                              <label className="block text-[11.5px] mb-1" style={{ color: "var(--w3)" }}>{T.gesprachNotes}</label>
                              <textarea style={{ ...btnInp, resize: "vertical", minHeight: "72px" }}
                                placeholder={T.gesprachNotesPh}
                                value={pl.interview_notes}
                                onChange={e => updatePipeline(c.userId, { interview_notes: e.target.value })} />
                            </div>

                            {/* Save */}
                            <div className="flex items-center justify-between pt-1">
                              <button type="button"
                                onClick={() => saveCandidatePipeline(c.userId)}
                                disabled={saveState === "saving"}
                                style={{
                                  display: "flex", alignItems: "center", gap: "6px",
                                  padding: "7px 16px", borderRadius: "10px", fontSize: "12.5px", fontWeight: 600,
                                  background: saveState === "saved" ? "var(--success-bg, rgba(34,197,94,0.1))" : "var(--gdim)",
                                  border: `1px solid ${saveState === "saved" ? "var(--success-border, rgba(34,197,94,0.3))" : "var(--border-gold)"}`,
                                  color: saveState === "saved" ? "var(--success)" : "var(--gold)",
                                  cursor: saveState === "saving" ? "not-allowed" : "pointer",
                                  opacity: saveState === "saving" ? 0.6 : 1,
                                }}>
                                <Save size={13} />
                                {saveState === "saving" ? T.gesprachSaving : saveState === "saved" ? T.gesprachSaved : T.gesprachSave}
                              </button>
                              {saveState === "error" && (
                                <span className="text-[11.5px]" style={{ color: "var(--error, #ef4444)" }}>{T.gesprachError}</span>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Document Templates — Bearbeitung & Visum ─────────────────────── */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>
              Dokument-Templates
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
              style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
              Admin only
            </span>
          </div>

          {/* Tab selector */}
          <div className="flex gap-2 mb-3">
            {(["bea", "vis"] as const).map(tab => (
              <button key={tab} type="button" onClick={() => setActiveSlotTab(tab)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all"
                style={{
                  background: activeSlotTab === tab ? "var(--gdim)" : "var(--card)",
                  color: activeSlotTab === tab ? "var(--gold)" : "var(--w2)",
                  border: `1px solid ${activeSlotTab === tab ? "var(--border-gold)" : "var(--border)"}`,
                }}>
                {tab === "bea" ? "Bearbeitung" : "Visum"}
              </button>
            ))}
          </div>

          {/* Slot list */}
          {(() => {
            const phase = activeSlotTab === "bea" ? "bearbeitung" : "visum";
            const slotList = orgSlots[activeSlotTab];
            const orgId = org.id;
            return (
              <div className="overflow-hidden rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                  <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--w3)" }}>
                    {slotList.length} document{slotList.length !== 1 ? "s" : ""} configured
                  </span>
                  <button
                    onClick={() => { setAddSlotPhase(phase); setAddSlotType("simple"); setAddSlotLabel(""); setAddSlotLabelTrans(""); }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                    <Plus size={11} strokeWidth={2.2} /> Add document
                  </button>
                </div>

                {slotList.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-[12px]" style={{ color: "var(--w3)" }}>
                      No documents yet. Click "+ Add document" to configure what candidates must upload.
                    </p>
                  </div>
                ) : (
                  <div>
                    {slotList.map((slot, si) => (
                      <div key={slot.id}
                        draggable
                        onDragStart={() => { orgDragIdx.current = si; }}
                        onDragOver={e => e.preventDefault()}
                        onDrop={async () => {
                          const from = orgDragIdx.current;
                          if (from === null || from === si) return;
                          const reordered = [...slotList];
                          const [moved] = reordered.splice(from, 1);
                          reordered.splice(si, 0, moved);
                          const withPos = reordered.map((s, i) => ({ ...s, position: i }));
                          setOrgSlots(prev => ({ ...prev, [activeSlotTab]: withPos }));
                          await saveOrgSlotOrder(phase, withPos.map(s => ({ id: s.id, position: s.position })));
                          orgDragIdx.current = null;
                        }}>
                        {si > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                        <div className="flex items-center gap-2.5 px-4 py-3 cursor-grab active:cursor-grabbing">
                          <span style={{ color: "var(--w3)", fontSize: 14, cursor: "grab", userSelect: "none" }}>⠿</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ background: slot.type === "dual" ? "var(--info-bg)" : "var(--bg2)", color: slot.type === "dual" ? "var(--info)" : "var(--w3)", border: "1px solid var(--border)" }}>
                            {slot.type === "dual" ? "DUAL" : "DOC"}
                          </span>
                          <span className="flex-1 text-[12.5px] font-medium min-w-0 truncate" style={{ color: "var(--w)" }}>
                            {slot.label}{slot.type === "dual" && slot.label_trans ? <span style={{ color: "var(--w3)" }}> / {slot.label_trans}</span> : null}
                          </span>
                          <button onClick={() => deleteOrgSlot(slot.id, phase)} title="Delete"
                            className="w-7 h-7 flex items-center justify-center rounded-full transition-opacity hover:opacity-70 flex-shrink-0"
                            style={{ color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
                            <XIcon size={13} strokeWidth={1.8} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Add slot modal (LAW #36) */}
          {addSlotPhase && (
            <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4"
              style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
              onClick={() => setAddSlotPhase(null)}>
              <div className="w-full max-w-sm rounded-[20px] p-5 space-y-4"
                onClick={e => e.stopPropagation()}
                style={{ background: "var(--card)", border: "1px solid var(--border-gold)", boxShadow: "var(--shadow-lg)", animation: "bvFadeRise .28s var(--ease-out)" }}>
                <p className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>Add document slot</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["simple", "dual"] as const).map(tp => (
                    <button key={tp} type="button" onClick={() => setAddSlotType(tp)}
                      className="py-3 rounded-xl text-[12px] font-semibold text-center transition-all"
                      style={{ background: addSlotType === tp ? "var(--gdim)" : "var(--bg2)", color: addSlotType === tp ? "var(--gold)" : "var(--w2)", border: `1.5px solid ${addSlotType === tp ? "var(--border-gold)" : "var(--border)"}` }}>
                      {tp === "simple" ? "📄 Simple" : "📄📄 Dual (Original + Translated)"}
                    </button>
                  ))}
                </div>
                <input type="text"
                  placeholder={addSlotType === "dual" ? "Label (original)" : "Label (e.g. Dokument 1)"}
                  value={addSlotLabel} onChange={e => setAddSlotLabel(e.target.value)}
                  className="w-full px-3 py-2.5 text-[12.5px] outline-none"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--w)" }}
                />
                {addSlotType === "dual" && (
                  <input type="text"
                    placeholder="Label translated"
                    value={addSlotLabelTrans} onChange={e => setAddSlotLabelTrans(e.target.value)}
                    className="w-full px-3 py-2.5 text-[12.5px] outline-none"
                    style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--w)" }}
                  />
                )}
                <div className="flex gap-2">
                  <button onClick={() => setAddSlotPhase(null)} disabled={addSlotSaving}
                    className="flex-1 py-2.5 rounded-xl text-[12.5px] font-semibold"
                    style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                    Cancel
                  </button>
                  <button
                    onClick={() => addOrgSlot(addSlotPhase!, addSlotType, addSlotLabel, addSlotLabelTrans, org.id)}
                    disabled={addSlotSaving || !addSlotLabel.trim()}
                    className="flex-1 py-2.5 rounded-xl text-[12.5px] font-semibold disabled:opacity-40"
                    style={{ background: "var(--gold)", color: "#131312" }}>
                    {addSlotSaving ? "Saving…" : "Add"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
    </>
  );
}

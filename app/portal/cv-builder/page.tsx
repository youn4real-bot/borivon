"use client";

/**
 * CV Builder — creates a professional German Lebenslauf PDF.
 * Protected: accessible only to logged-in candidates (and admins via the same auth).
 * Opens in a new tab from the portal dashboard.
 *
 * Features:
 *  - Auto-fill personal data from candidate_profiles (passport data)
 *  - localStorage draft persistence (auto-save per user)
 *  - Field-level validation with red border on required fields
 *  - Gap detection modal
 *  - Download + upload-to-dossier flow
 */

import * as React from "react";
import { useState, useRef, useEffect, ChangeEvent } from "react";
import { PortalTopNav } from "@/components/PortalTopNav";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import type { CVData, WorkEntry, EduEntry, MonthYear } from "@/components/CVDocument";
import { COUNTRY_MAP, natToLang, ISO3_TO_ISO2, ISO3_TO_PHONE } from "@/lib/countries";
import {
  SectionIcon, type SectionKind,
  IdCard, Sparkles, FileText, CheckCircle2, AlertTriangle, User,
} from "@/components/PortalIcons";
import { Upload, FilePen, Ban, Check, Plus, X as XIcon, ArrowLeft, Info, Download, Lock, Briefcase, Smartphone, Car, BookOpen, Dumbbell, Plane, Music } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageLoader, Spinner, AutosaveIndicator } from "@/components/ui/states";
import { PhotoCropModal } from "@/components/PhotoCropModal";
import { PdfViewer } from "@/components/PdfViewer";

// ─── Constants ──────────────────────────────────────────────────────────────

const MONTHS: Record<string, { v: string; l: string }[]> = {
  fr: [
    { v: "01", l: "Janvier" },  { v: "02", l: "Février" },  { v: "03", l: "Mars" },
    { v: "04", l: "Avril" },    { v: "05", l: "Mai" },       { v: "06", l: "Juin" },
    { v: "07", l: "Juillet" },  { v: "08", l: "Août" },      { v: "09", l: "Septembre" },
    { v: "10", l: "Octobre" },  { v: "11", l: "Novembre" },  { v: "12", l: "Décembre" },
  ],
  en: [
    { v: "01", l: "January" },  { v: "02", l: "February" }, { v: "03", l: "March" },
    { v: "04", l: "April" },    { v: "05", l: "May" },      { v: "06", l: "June" },
    { v: "07", l: "July" },     { v: "08", l: "August" },   { v: "09", l: "September" },
    { v: "10", l: "October" },  { v: "11", l: "November" }, { v: "12", l: "December" },
  ],
  de: [
    { v: "01", l: "Januar" },   { v: "02", l: "Februar" },  { v: "03", l: "März" },
    { v: "04", l: "April" },    { v: "05", l: "Mai" },      { v: "06", l: "Juni" },
    { v: "07", l: "Juli" },     { v: "08", l: "August" },   { v: "09", l: "September" },
    { v: "10", l: "Oktober" },  { v: "11", l: "November" }, { v: "12", l: "Dezember" },
  ],
};

// 2030 → 1950 (newest first so the most-relevant years are at the top)
const YEARS = Array.from({ length: 2030 - 1950 + 1 }, (_, i) => String(2030 - i));

// Nursing departments — fr/en shown in the UI chips, de = value stored & shown on CV
const NURSING_DEPTS: { fr: string; en: string; de: string }[] = [
  { fr: "Médecine interne",              en: "Internal Medicine",        de: "Innere Medizin" },
  { fr: "Chirurgie générale",            en: "General Surgery",          de: "Allgemeinchirurgie" },
  { fr: "Urgences",                      en: "Emergency Department",     de: "Notaufnahme" },
  { fr: "Réanimation / Soins intensifs", en: "ICU / Intensive Care",     de: "Intensivstation" },
  { fr: "Pédiatrie",                     en: "Pediatrics",               de: "Pädiatrie" },
  { fr: "Maternité / Obstétrique",       en: "Maternity / Obstetrics",   de: "Geburtshilfe" },
  { fr: "Psychiatrie",                   en: "Psychiatry",               de: "Psychiatrie" },
  { fr: "Cardiologie",                   en: "Cardiology",               de: "Kardiologie" },
  { fr: "Neurologie",                    en: "Neurology",                de: "Neurologie" },
  { fr: "Oncologie",                     en: "Oncology",                 de: "Onkologie" },
  { fr: "Orthopédie",                    en: "Orthopedics",              de: "Orthopädie" },
  { fr: "Radiologie",                    en: "Radiology",                de: "Radiologie" },
  { fr: "Bloc opératoire",               en: "Operating Room (OR)",      de: "Operationssaal (OP)" },
  { fr: "Dialyse",                       en: "Dialysis",                 de: "Dialyse" },
  { fr: "Soins palliatifs",              en: "Palliative Care",          de: "Palliativmedizin" },
  { fr: "Gériatrie",                     en: "Geriatrics",               de: "Geriatrie" },
  { fr: "Pneumologie",                   en: "Pulmonology",              de: "Pneumologie" },
  { fr: "Gastro-entérologie",            en: "Gastroenterology",         de: "Gastroenterologie" },
  { fr: "Urologie",                      en: "Urology",                  de: "Urologie" },
  { fr: "Hématologie",                   en: "Hematology",               de: "Hämatologie" },
  { fr: "ORL",                           en: "ENT (Ear, Nose & Throat)", de: "HNO (Hals-Nasen-Ohren)" },
  { fr: "Ophtalmologie",                 en: "Ophthalmology",            de: "Augenheilkunde" },
];

/** Realistic EDV-Kenntnisse for a German nursing CV. The DE term is what
   gets saved + printed on the CV; FR/EN are display-only equivalents. */
const EDV_DEFAULTS: { de: string; fr: string; en: string }[] = [
  { de: "Microsoft Word",                       fr: "Microsoft Word",                       en: "Microsoft Word" },
  { de: "Microsoft Excel",                      fr: "Microsoft Excel",                      en: "Microsoft Excel" },
  { de: "Microsoft PowerPoint",                 fr: "Microsoft PowerPoint",                 en: "Microsoft PowerPoint" },
  { de: "Microsoft Outlook",                    fr: "Microsoft Outlook",                    en: "Microsoft Outlook" },
  { de: "Krankenhausinformationssystem (KIS)",  fr: "Dossier Patient Informatisé (DPI)",    en: "Hospital Information System (HIS)" },
  { de: "ORBIS",                                fr: "ORBIS",                                en: "ORBIS" },
  { de: "SAP IS-H",                             fr: "SAP IS-H",                             en: "SAP IS-H" },
];

const LANG_LEVELS = ["Muttersprache", "C2", "C1", "B2", "B1", "A2", "A1", "Grundkenntnisse"];

/** Per-level labels: short code shown in the box, full description shown in
   the popup (CEFR + common term). Saved value stays the German term. */
const LANG_LEVEL_DETAILS: Record<string, { short: string; de: string; en: string; fr: string }> = {
  Muttersprache: { short: "Native", de: "Muttersprache (Native)", en: "Native (Mother tongue)", fr: "Langue maternelle (Native)" },
  C2:            { short: "C2",     de: "C2 — Beherrschung",      en: "C2 — Mastery",            fr: "C2 — Maîtrise" },
  C1:            { short: "C1",     de: "C1 — Fortgeschritten",   en: "C1 — Advanced",           fr: "C1 — Avancé" },
  B2:            { short: "B2",     de: "B2 — Gute Mittelstufe",  en: "B2 — Upper-intermediate", fr: "B2 — Intermédiaire+" },
  B1:            { short: "B1",     de: "B1 — Mittelstufe",       en: "B1 — Intermediate",       fr: "B1 — Intermédiaire" },
  A2:            { short: "A2",     de: "A2 — Grundlagen",        en: "A2 — Elementary",         fr: "A2 — Élémentaire" },
  A1:              { short: "A1",    de: "A1 — Anfänger",          en: "A1 — Beginner",           fr: "A1 — Débutant" },
  Grundkenntnisse: { short: "Grund", de: "Grundkenntnisse",        en: "Basic Knowledge",         fr: "Notions de base" },
};

// Required fields for validation
const REQUIRED_FIELDS: (keyof CVData)[] = ["firstName", "lastName", "birthDate", "birthPlace"];

// ─── Types / helpers ─────────────────────────────────────────────────────────

interface SmartGap {
  gapStart: MonthYear;
  gapEnd: MonthYear;
  monthCount: number;
}

// Per-render unique IDs for new entries. Uses crypto.randomUUID when available
// (browsers + Node 19+) so IDs never collide with ones already in a restored
// localStorage draft (the previous `e${++counter}` reset to 0 on every page
// load and produced "e1" twice → React key collisions, lost edits).
function uid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `e-${crypto.randomUUID()}`;
    }
  } catch { /* fall through */ }
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toNum(my: MonthYear): number {
  return parseInt(my.year || "0") * 12 + parseInt(my.month || "0");
}

function numToMY(n: number): MonthYear {
  const year = Math.floor((n - 1) / 12);
  const month = n - year * 12;
  return { month: String(month).padStart(2, "0"), year: String(year) };
}

function todayMY(): MonthYear {
  const d = new Date();
  return { month: String(d.getMonth() + 1).padStart(2, "0"), year: String(d.getFullYear()) };
}

function detectSmartGaps(workEntries: WorkEntry[], eduEntries: EduEntry[]): SmartGap[] {
  // 1. Find nursing training end — the key reference
  const nursing = eduEntries.find(e => e.type === "nursing");
  if (!nursing || !nursing.start.year) return [];
  // If nursing is still in progress treat today as the effective end so the
  // covered-set is correctly built; gapCheckStart will exceed todayNum and
  // the function returns [] naturally (no post-nursing gaps possible yet).
  const nursingEnd: MonthYear = nursing.end ?? todayMY();

  const nursingStartY = parseInt(nursing.start.year);
  const nursingStart: MonthYear = { month: nursing.start.month || "09", year: nursing.start.year };
  const nursingStartNum = toNum(nursingStart);
  const nursingEndNum   = toNum(nursingEnd);

  // 2. Build set of ALL covered months
  const covered = new Set<number>();

  // Nursing training period is always covered (internships during training are expected)
  for (let n = nursingStartNum; n <= nursingEndNum; n++) covered.add(n);

  // Abitur + summer grace
  const abitur = eduEntries.find(e => e.type === "abitur");
  if (abitur && abitur.start.year) {
    const abiturStartNum = toNum({ month: abitur.start.month || "09", year: abitur.start.year });
    const abiturEndNum   = abitur.end ? toNum(abitur.end) : nursingStartNum - 1;
    for (let n = abiturStartNum; n <= abiturEndNum; n++) covered.add(n);
    // Grace: June/July/August of nursing start year (summer before nursing)
    covered.add(nursingStartY * 12 + 6);  // June
    covered.add(nursingStartY * 12 + 7);  // July
    covered.add(nursingStartY * 12 + 8);  // August
  }

  // Other education entries
  for (const edu of eduEntries) {
    if (!edu.start.month || !edu.start.year) continue;
    const startN = toNum(edu.start);
    const endN   = edu.end ? toNum(edu.end) : toNum(todayMY());
    for (let n = startN; n <= endN; n++) covered.add(n);
  }

  // Work experience (during AND after nursing — internships during training are fine)
  for (const work of workEntries) {
    if (!work.start.month || !work.start.year) continue;
    const startN = toNum(work.start);
    const endN   = work.end ? toNum(work.end) : toNum(todayMY());
    for (let n = startN; n <= endN; n++) covered.add(n);
  }

  // 3. Find uncovered months ONLY after nursing end, up to today
  const todayNum      = toNum(todayMY());
  const gapCheckStart = nursingEndNum + 1;
  if (gapCheckStart > todayNum) return [];

  const uncovered: number[] = [];
  for (let n = gapCheckStart; n <= todayNum; n++) {
    if (!covered.has(n)) uncovered.push(n);
  }
  if (uncovered.length === 0) return [];

  // 4. Group consecutive uncovered months into gap ranges
  const gaps: SmartGap[] = [];
  let i = 0;
  while (i < uncovered.length) {
    const startN = uncovered[i];
    let   endN   = startN;
    while (i + 1 < uncovered.length && uncovered[i + 1] === uncovered[i] + 1) { i++; endN = uncovered[i]; }
    gaps.push({ gapStart: numToMY(startN), gapEnd: numToMY(endN), monthCount: endN - startN + 1 });
    i++;
  }
  return gaps;
}

// Country names from shared @/lib/countries (single source of truth across the app)
const CV_NAT_MAP = COUNTRY_MAP;

/** Convert ISO code, any-language country name, or legacy German adjective → German country name (used in the German CV PDF) */
function toNatDe(v: string | null | undefined): string {
  return natToLang(v, "de");
}

/** Compute the Familienstand string for the CV from profile fields */
function computeFamilienstand(marital_status: string | null | undefined, children_ages: string | null | undefined): string {
  if (!marital_status) return "";
  if (marital_status === "ledig") return "ledig";
  let ages: number[] = [];
  try { ages = JSON.parse(children_ages || "[]"); } catch { ages = []; }
  if (!Array.isArray(ages) || ages.length === 0) return marital_status;
  const sorted = [...ages].filter(a => typeof a === "number" && a >= 0).sort((a, b) => b - a);
  if (sorted.length === 0) return marital_status;
  const kindStr = sorted.length === 1 ? "1 Kind" : `${sorted.length} Kinder`;
  return `${marital_status}, ${kindStr} (${sorted.join(", ")})`;
}

/** Parse a Familienstand string back into its parts. */
function parseMaritalStatus(s: string): { base: string; ages: number[] } {
  const base = (s || "").split(",")[0].trim();
  const m = (s || "").match(/\(([^)]+)\)/);
  if (!m) return { base, ages: [] };
  const ages = m[1].split(",")
    .map(x => parseInt(x.trim(), 10))
    .filter(n => Number.isFinite(n) && n >= 0);
  return { base, ages };
}

/** Build a Familienstand string from base + ages (e.g. "verheiratet, 2 Kinder (8, 5)"). */
function composeMaritalStatus(base: string, ages: number[]): string {
  if (!base) return "";
  if (base === "ledig") return "ledig";
  const clean = ages.filter(a => Number.isFinite(a) && a >= 0);
  if (clean.length === 0) return base;
  const sorted = [...clean].sort((a, b) => b - a);
  const word = sorted.length === 1 ? "1 Kind" : `${sorted.length} Kinder`;
  return `${base}, ${word} (${sorted.join(", ")})`;
}

function makeCVData(email = ""): CVData {
  return {
    photo: null,
    firstName: "", lastName: "", birthDate: "", birthPlace: "",
    // Country of birth + residence stay empty by default. They fill in
    // automatically when passport OCR extracts them on the dashboard.
    countryOfBirth: "", countryOfResidence: "",
    nationality: "", maritalStatus: "",
    address: "", postalCode: "", city: "", phone: "", email,
    workEntries: [
      { id: `work-default-${Date.now()}`, isGap: false, title: "", employer: "", location: "", country: "Marokko", departments: [], start: { month: "", year: "" }, end: { month: "", year: "" }, gapReason: "" },
    ],
    eduEntries: [
      { id: "edu-abitur",  type: "abitur",  institution: "", location: "", start: { month: "09", year: "" }, end: { month: "06", year: "" }, degree: "Abitur", nursingStatus: "complete", country: "Marokko" },
      { id: "edu-nursing", type: "nursing", institution: "", location: "", start: { month: "09", year: "" }, end: { month: "06", year: "" }, degree: "Abschluss in der Krankenpflege", nursingStatus: "year2", country: "Marokko" },
    ],
    langs: [
      { name: "Arabisch",    level: "Muttersprache" },
      { name: "Französisch", level: "" },
      { name: "Deutsch",     level: "" },
      { name: "Englisch",    level: "" },
    ],
    edvSelected: ["Microsoft Word", "Microsoft Excel"],
    edvCustomInputs: [],
    // "unset" = candidate hasn't picked Yes/No yet; validation blocks
    // generation until they do. "B" = has class B license; "" = none.
    driverLicense: "unset",
    hobbies: "",
  };
}

/** Convert ISO date YYYY-MM-DD → DD.MM.YYYY for display in form */
function isoToDDMMYYYY(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return iso;
}

// ─── Primitive UI components ─────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode; required?: boolean }) {
  // Required asterisks are suppressed — every visible field is mandatory and
  // validated at generation time. Showing red stars on every label felt noisy.
  return (
    <label className="block text-[12px] font-normal mb-1.5" style={{ color: "var(--w3)", letterSpacing: "0" }}>
      {children}
    </label>
  );
}

function Input({ value, onChange, placeholder, type = "text", className = "", hasError = false, onBlur, lettersOnly, numericOnly }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string; hasError?: boolean;
  onBlur?: () => void;
  lettersOnly?: boolean;
  numericOnly?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  function clean(raw: string): string {
    if (lettersOnly) return raw.replace(/[0-9]/g, "");
    if (numericOnly) return raw.replace(/\D/g, "");
    return raw;
  }
  return (
    <input
      type={type}
      inputMode={numericOnly ? "numeric" : undefined}
      value={value}
      onChange={e => onChange(clean(e.target.value))}
      placeholder={placeholder}
      className={`w-full px-4 py-3.5 text-[15px] font-medium outline-none transition-all ${className}`}
      style={{
        background: "var(--bg2)",
        border: `1px solid ${hasError ? "var(--danger)" : focused ? "var(--gold)" : "transparent"}`,
        color: "var(--w)",
        borderRadius: "12px",
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); onBlur?.(); }}
    />
  );
}

/** German-style date input: auto-inserts dots → "01.01.1995". Numeric keyboard.
    Placeholder localized: DD.MM.YYYY (en) / TT.MM.JJJJ (de) / JJ.MM.AAAA (fr). */
function DateInput({ value, onChange, hasError, onBlur }: {
  value: string; onChange: (v: string) => void; hasError?: boolean; onBlur?: () => void;
}) {
  const { lang } = useLang();
  const [focused, setFocused] = useState(false);
  const ph = lang === "de" ? "TT.MM.JJJJ" : lang === "fr" ? "JJ.MM.AAAA" : "DD.MM.YYYY";
  function format(raw: string): string {
    const d = raw.replace(/\D/g, "").slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0,2)}.${d.slice(2)}`;
    return `${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4)}`;
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={e => onChange(format(e.target.value))}
      placeholder={ph}
      maxLength={10}
      className="w-full px-4 py-3.5 text-[15px] font-medium outline-none transition-all"
      style={{
        background: "var(--bg2)",
        border: `1px solid ${hasError ? "var(--danger)" : focused ? "var(--gold)" : "transparent"}`,
        color: "var(--w)",
        borderRadius: "12px",
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); onBlur?.(); }}
    />
  );
}

function Sel({ value, onChange, children, className = "" }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full px-4 py-3.5 text-[15px] font-medium outline-none appearance-none cursor-pointer transition-all ${className}`}
      style={{
        background: "var(--bg2)",
        border: "1px solid transparent",
        color: value ? "var(--w)" : "var(--w3)",
        borderRadius: "12px",
      }}
      onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
      onBlur={e => (e.currentTarget.style.borderColor = "transparent")}
    >
      {children}
    </select>
  );
}

/* PickerPopup — generic centered modal picker matching the country code picker style.
   Used by MonthYearPicker so month/year selection feels consistent across the form. */
function PickerPopup({ open, title, options, selectedValue, onPick, onClose }: {
  open: boolean;
  title: string;
  options: { value: string; label: string }[];
  selectedValue: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[1100]"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", animation: "bvFadeRise 0.2s var(--ease-out)" }}
        onClick={onClose} />
      <div className="fixed inset-0 z-[1101] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-[320px] max-h-[70vh] overflow-hidden flex flex-col pointer-events-auto"
          style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)" }}>
          <div className="flex items-center justify-between px-5 py-4">
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>{title}</h3>
            <button type="button" onClick={onClose}
              aria-label="Close"
              className="flex items-center justify-center w-8 h-8 transition-opacity hover:opacity-70"
              style={{ background: "var(--bg2)", border: "none", borderRadius: "10px", color: "var(--w2)", cursor: "pointer" }}>
              <XIcon size={15} strokeWidth={2} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {options.map(o => (
              <button key={o.value} type="button" onClick={() => onPick(o.value)}
                onMouseEnter={e => { if (o.value !== selectedValue) e.currentTarget.style.background = "var(--bg2)"; }}
                onMouseLeave={e => { if (o.value !== selectedValue) e.currentTarget.style.background = "transparent"; }}
                className="w-full px-3 py-3 text-[14px] text-left transition-colors"
                style={{ background: o.value === selectedValue ? "var(--bg2)" : "transparent", border: "none", color: "var(--w)", borderRadius: "10px", cursor: "pointer" }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function MonthYearPicker({ value, onChange, label, allowNull = false, isPresent = false, onPresentToggle, lang, required = false, hasError = false }: {
  value: MonthYear; onChange: (v: MonthYear) => void; label: string;
  allowNull?: boolean; isPresent?: boolean; onPresentToggle?: () => void; lang: string;
  required?: boolean; hasError?: boolean;
}) {
  const months = MONTHS[lang] ?? MONTHS.fr;
  const { t } = useLang();
  const [openMonth, setOpenMonth] = useState(false);
  const [openYear, setOpenYear] = useState(false);

  const monthLabel = months.find(m => m.v === value.month)?.l ?? t.cvb_month;
  const yearLabel  = value.year || t.cvb_year;

  const buttonStyle: React.CSSProperties = {
    background: "var(--bg2)",
    border: `1px solid ${hasError ? "var(--danger)" : "transparent"}`,
    color: "var(--w)",
    borderRadius: "12px",
  };

  return (
    <div>
      {/* Label + minimalist Currently toggle inline on the right.
          Only rendered when allowNull is set (e.g. End date for in-progress training). */}
      <div className="flex items-center justify-between mb-2.5">
        <Label required={required}>{label}</Label>
        {allowNull && (
          <button type="button" onClick={onPresentToggle}
            className="text-[11px] font-medium tracking-tight transition-opacity hover:opacity-80 inline-flex items-center gap-1"
            style={{ background: "transparent", border: "none", color: isPresent ? "var(--gold)" : "var(--w3)", cursor: "pointer", padding: 0, marginBottom: "0px" }}>
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px]"
              style={{ background: isPresent ? "var(--gold)" : "transparent", border: isPresent ? "none" : "1px solid var(--border2)" }}>
              {isPresent && <Check size={9} strokeWidth={3} style={{ color: "#131312" }} />}
            </span>
            {t.cvb_inProgress}
          </button>
        )}
      </div>
      {isPresent ? (
        // Single muted pill in place of the month/year so the row footprint stays the same.
        <div className="px-4 py-3.5 text-[14px] font-medium"
          style={{ background: "var(--bg2)", color: "var(--gold)", borderRadius: "12px", opacity: 0.85 }}>
          {t.cvb_inProgress}
        </div>
      ) : (
        <div className="flex gap-3">
          <button type="button" onClick={() => setOpenMonth(true)}
            className="flex-1 flex items-center justify-between px-4 py-3.5 text-[15px] font-medium outline-none cursor-pointer transition-all"
            style={{ ...buttonStyle, color: value.month ? "var(--w)" : "var(--w3)" }}>
            <span className="truncate">{monthLabel}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0, marginLeft: 8 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <button type="button" onClick={() => setOpenYear(true)}
            className="flex-1 flex items-center justify-between px-4 py-3.5 text-[15px] font-medium outline-none cursor-pointer transition-all"
            style={{ ...buttonStyle, color: value.year ? "var(--w)" : "var(--w3)" }}>
            <span className="truncate">{yearLabel}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0, marginLeft: 8 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </div>
      )}
      <PickerPopup
        open={openMonth}
        title={t.cvb_month}
        options={months.map(m => ({ value: m.v, label: m.l }))}
        selectedValue={value.month}
        onPick={v => { onChange({ ...value, month: v }); setOpenMonth(false); }}
        onClose={() => setOpenMonth(false)}
      />
      <PickerPopup
        open={openYear}
        title={t.cvb_year}
        options={YEARS.map(y => ({ value: y, label: y }))}
        selectedValue={value.year}
        onPick={v => { onChange({ ...value, year: v }); setOpenYear(false); }}
        onClose={() => setOpenYear(false)}
      />
    </div>
  );
}

/* PhoneInput — country code dropdown with SVG flags + number input with auto-spacing.
   COUNTRY_CODES is derived from COUNTRY_MAP + ISO3_TO_PHONE so it stays in sync
   automatically whenever a new country is added to lib/countries.ts. */
const COUNTRY_CODES: { code: string; iso: string; iso3: string; name: string }[] =
  Object.entries(COUNTRY_MAP)
    .filter(([iso3]) => ISO3_TO_PHONE[iso3] && ISO3_TO_ISO2[iso3])
    .map(([iso3, names]) => ({
      iso3,
      iso: ISO3_TO_ISO2[iso3],
      code: ISO3_TO_PHONE[iso3],
      name: names.en, // sort key — UI re-localizes via lang at render time
    }));

function formatPhoneNumber(digits: string): string {
  // Morocco numbers are 9 digits (after +212). Cap to 9 and group into 3s.
  // e.g. "600000000" → "600 000 000"
  const clean = digits.replace(/\D/g, "").slice(0, 9);
  return clean.match(/.{1,3}/g)?.join(" ") ?? clean;
}

function CountryFlag({ iso, size = 22 }: { iso: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://flagcdn.com/${iso}.svg`} alt={iso}
      width={size} height={size * 0.72} style={{ display: "inline-block", borderRadius: "3px", objectFit: "cover", flexShrink: 0 }} />
  );
}

function PhoneInput({ value, onChange, hasError = false }: { value: string; onChange: (v: string) => void; hasError?: boolean }) {
  const { lang } = useLang();
  // Localize the names + sort alphabetically by current language (A-Z).
  const sortedCountries = COUNTRY_CODES
    .map(c => {
      const names = COUNTRY_MAP[c.iso3];
      return { ...c, name: names ? (names[lang as "fr"|"en"|"de"] ?? c.name) : c.name };
    })
    .sort((a, b) => a.name.localeCompare(b.name, lang));
  // Track the chosen country by ISO (so when 2 countries share a code like +1, we remember which).
  const [selectedIso, setSelectedIso] = useState<string>(() => {
    // Initialize from existing value if present, else default Morocco.
    const m = value.match(/^(\+\d+)\s*/);
    if (m) {
      const found = COUNTRY_CODES.find(c => c.code === m[1]);
      return found?.iso ?? "ma";
    }
    return "ma";
  });
  const [open, setOpen] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const selected = COUNTRY_CODES.find(c => c.iso === selectedIso) ?? COUNTRY_CODES[0];

  // Parse number portion of saved value.
  const m = value.match(/^(\+\d+)\s*(.*)$/);
  const currentNum = m?.[2] ?? "";

  // Morocco gets the helpful triple-digit grouping + placeholder example;
  // every other country keeps its number raw so we don't impose a wrong format.
  const isMorocco = selected.iso === "ma";

  function pickCountry(iso: string) {
    const c = COUNTRY_CODES.find(x => x.iso === iso);
    if (!c) return;
    setSelectedIso(iso);
    setOpen(false);
    // When leaving/entering Morocco, strip spaces so we don't carry over formatting.
    const stripped = currentNum.replace(/\s+/g, "");
    const next = c.iso === "ma" ? formatPhoneNumber(stripped) : stripped;
    onChange(`${c.code} ${next}`.trim());
  }
  function setNum(raw: string) {
    const next = isMorocco ? formatPhoneNumber(raw) : raw.replace(/\D/g, "");
    onChange(`${selected.code} ${next}`.trim());
  }

  return (
    <div className="flex gap-2 relative">
      <button type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-3.5 text-[15px] font-medium outline-none cursor-pointer transition-all"
        style={{ background: "var(--bg2)", border: "1px solid transparent", color: "var(--w)", borderRadius: "12px", flexShrink: 0 }}
        onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
        onBlur={e => (e.currentTarget.style.borderColor = "transparent")}
      >
        <CountryFlag iso={selected.iso} size={20} />
        <span>{selected.code}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <input
        type="tel"
        inputMode="numeric"
        value={currentNum}
        onChange={e => setNum(e.target.value)}
        placeholder={isMorocco ? "600 000 000" : ""}
        className="flex-1 w-full px-4 py-3.5 text-[15px] font-medium outline-none transition-all"
        style={{ background: "var(--bg2)", border: `1px solid ${hasError ? "var(--danger)" : "transparent"}`, color: "var(--w)", borderRadius: "12px" }}
        onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
        onBlur={e => (e.currentTarget.style.borderColor = hasError ? "var(--danger)" : "transparent")}
      />
      {open && (
        <>
          {/* Backdrop — closes the popup on click outside */}
          <div className="fixed inset-0 z-[1100]"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", animation: "bvFadeRise 0.2s var(--ease-out)" }}
            onClick={() => setOpen(false)} />
          {/* Centered popup */}
          <div className="fixed inset-0 z-[1101] flex items-center justify-center p-4 pointer-events-none">
            <div className="w-full max-w-[360px] max-h-[70vh] overflow-hidden flex flex-col pointer-events-auto"
              style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)" }}>
              <div className="flex items-center justify-between px-5 py-4">
                <h3 className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>
                  {lang === "de" ? "Land auswählen" : lang === "en" ? "Select country" : "Choisir un pays"}
                </h3>
                <button type="button" onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex items-center justify-center w-8 h-8 transition-opacity hover:opacity-70"
                  style={{ background: "var(--bg2)", border: "none", borderRadius: "10px", color: "var(--w2)", cursor: "pointer" }}>
                  <XIcon size={15} strokeWidth={2} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2">
                {sortedCountries.map(c => (
                  <button key={c.iso} type="button" onClick={() => pickCountry(c.iso)}
                    onMouseEnter={e => { if (c.iso !== selectedIso) e.currentTarget.style.background = "var(--bg2)"; }}
                    onMouseLeave={e => { if (c.iso !== selectedIso) e.currentTarget.style.background = "transparent"; }}
                    className="w-full flex items-center gap-3 px-3 py-3 text-[14px] text-left transition-colors"
                    style={{ background: c.iso === selectedIso ? "var(--bg2)" : "transparent", border: "none", color: "var(--w)", borderRadius: "10px", cursor: "pointer" }}>
                    <CountryFlag iso={c.iso} size={22} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span style={{ color: "var(--w3)" }}>{c.code}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* LangLevelButton — compact level selector. The closed pill shows just the
   short code (A1…C2 / "Native"); the popup shows the full CEFR description. */
function LangLevelButton({ level, onChange, hasError = false }: {
  level: string;
  onChange: (v: string) => void;
  hasError?: boolean;
}) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const detail = level ? LANG_LEVEL_DETAILS[level] : null;
  // Localize the short code for "Muttersprache" since it has no CEFR letter.
  const shortLabel = !detail ? "—"
    : level === "Muttersprache"
      ? (lang === "de" ? "Muttersprache" : lang === "en" ? "Native" : "Natif")
      : detail.short;

  const options = [
    { value: "", label: t.cvb_notIncluded },
    ...LANG_LEVELS.filter(lv => LANG_LEVEL_DETAILS[lv]).map(lv => ({
      value: lv,
      label: LANG_LEVEL_DETAILS[lv][lang as "fr"|"en"|"de"] ?? LANG_LEVEL_DETAILS[lv].de,
    })),
  ];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center justify-center px-4 py-2.5 text-[13px] font-semibold outline-none cursor-pointer transition-all hover:opacity-100"
        style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${hasError ? "var(--danger)" : "transparent"}`, color: detail ? "var(--w)" : "var(--w3)", borderRadius: "10px", minWidth: "84px", opacity: 0.95, flexShrink: 0 }}>
        {shortLabel}
      </button>
      <PickerPopup
        open={open}
        title={t.cvb_levelLabel}
        options={options}
        selectedValue={level}
        onPick={v => { onChange(v); setOpen(false); }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/* ExtraNationalityPickerHost — wraps the country picker popup for picking
   an additional nationality. Inline because we need to skip values the user
   has already chosen. Opens its own scrollable list and dismisses on pick. */
function ExtraNationalityPickerHost({ existing, onPick, onClose }: {
  existing: string[];
  onPick: (de: string) => void;
  onClose: () => void;
}) {
  const { lang } = useLang();
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options = Object.entries(COUNTRY_MAP)
    .filter(([, n]) => !existing.includes(n.de))
    .map(([iso3, names]) => ({
      iso3,
      iso2: ISO3_TO_ISO2[iso3] ?? iso3.slice(0,2).toLowerCase(),
      label: names[lang as "fr"|"en"|"de"] ?? names.de,
      de: names.de,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const title = lang === "de" ? "Weitere Staatsangehörigkeit"
              : lang === "en" ? "Additional nationality"
              : "Nationalité supplémentaire";

  return (
    <>
      <div className="fixed inset-0 z-[1100]"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", animation: "bvFadeRise 0.2s var(--ease-out)" }}
        onClick={onClose} />
      <div className="fixed inset-0 z-[1101] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-[360px] max-h-[70vh] overflow-hidden flex flex-col pointer-events-auto"
          style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)" }}>
          <div className="flex items-center justify-between px-5 py-4">
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>{title}</h3>
            <button type="button" onClick={onClose}
              aria-label="Close"
              className="flex items-center justify-center w-8 h-8 transition-opacity hover:opacity-70"
              style={{ background: "var(--bg2)", border: "none", borderRadius: "10px", color: "var(--w2)", cursor: "pointer" }}>
              <XIcon size={15} strokeWidth={2} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {options.map(o => (
              <button key={o.iso3} type="button" onClick={() => onPick(o.de)}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--bg2)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                className="w-full flex items-center gap-3 px-3 py-3 text-[14px] text-left transition-colors"
                style={{ background: "transparent", border: "none", color: "var(--w)", borderRadius: "10px", cursor: "pointer" }}>
                <CountryFlag iso={o.iso2} size={22} />
                <span className="flex-1 truncate">{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* InternshipInfoPopup — friendly guidance popup for the mandatory nursing
   internship. Explains that the start/end dates cover ALL hospital
   placements during the nursing training as one combined period, and
   reminds the user to add every hospital they trained at. */
function InternshipInfoPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang } = useLang();
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  const title = lang === "de" ? "Hinweis zum Praktikum" : lang === "en" ? "About this internship" : "À propos du stage";

  const dosTitle    = lang === "de" ? "Mach das" : lang === "en" ? "Do this" : "Fais ceci";
  const dontsTitle  = lang === "de" ? "Mach das nicht" : lang === "en" ? "Don't do this" : "Ne fais pas ceci";

  const dos: string[] = lang === "de"
    ? [
        "Füge JEDES Krankenhaus hinzu, in dem du gelernt hast — auch in verschiedenen Städten.",
        "Nutze die Schaltfläche „Weiteres Krankenhaus“ für jedes weitere.",
        "Setze EIN Startdatum (Beginn der Ausbildung) und EIN Enddatum (Ende der Ausbildung).",
      ]
    : lang === "en"
      ? [
          "Add EVERY hospital where you trained — even in different cities.",
          "Use the \"Add another hospital\" button for each one.",
          "Set ONE start date (when training began) and ONE end date (when training finished).",
        ]
      : [
          "Ajoute CHAQUE hôpital où tu as fait un stage — même dans des villes différentes.",
          "Utilise le bouton « Ajouter un autre hôpital » pour chacun.",
          "Mets UNE date de début (début de la formation) et UNE date de fin (fin de la formation).",
        ];

  const donts: string[] = lang === "de"
    ? [
        "Keine Praktika eintragen, die NACH der Ausbildung waren.",
        "Keine Praktika eintragen, die VOR der Ausbildung waren.",
        "Keine separaten Daten pro Krankenhaus — alle Praktika teilen sich denselben Zeitraum.",
      ]
    : lang === "en"
      ? [
          "Don't add internships you did AFTER your training.",
          "Don't add internships you did BEFORE your training.",
          "Don't write separate dates per hospital — they all share the same period.",
        ]
      : [
          "N'ajoute pas les stages effectués APRÈS la formation.",
          "N'ajoute pas les stages effectués AVANT la formation.",
          "Ne mets pas de dates séparées par hôpital — tous partagent la même période.",
        ];

  const close = lang === "de" ? "Verstanden" : lang === "en" ? "Got it" : "Compris";

  return (
    <>
      <div className="fixed inset-0 z-[1100]"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", animation: "bvFadeRise 0.2s var(--ease-out)" }}
        onClick={onClose} />
      <div className="fixed inset-0 z-[1101] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-[400px] max-h-[85vh] overflow-y-auto flex flex-col pointer-events-auto"
          style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)" }}>
          <div className="px-6 pt-6 pb-2 text-center">
            <span className="mx-auto mb-3 flex items-center justify-center w-12 h-12 rounded-full"
              style={{ background: "var(--info-bg)", color: "var(--info)" }}>
              <Info size={20} strokeWidth={1.8} />
            </span>
            <h3 className="text-[16px] font-semibold mb-4" style={{ color: "var(--w)" }}>{title}</h3>
          </div>
          <div className="px-6 pb-2 space-y-4">
            {/* DO list — green checks */}
            <div className="rounded-2xl p-4" style={{ background: "var(--success-bg)" }}>
              <div className="text-[12px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--success)" }}>
                {dosTitle}
              </div>
              <ul className="space-y-2.5">
                {dos.map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed" style={{ color: "var(--w)" }}>
                    <span className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
                      style={{ background: "var(--success-bg)", color: "var(--success)" }}>
                      <Check size={11} strokeWidth={2.5} />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* DON'T list — red ×'s */}
            <div className="rounded-2xl p-4" style={{ background: "var(--danger-bg)" }}>
              <div className="text-[12px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--danger)" }}>
                {dontsTitle}
              </div>
              <ul className="space-y-2.5">
                {donts.map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed" style={{ color: "var(--w)" }}>
                    <span className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
                      style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
                      <XIcon size={11} strokeWidth={2.5} />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="p-4">
            <button type="button" onClick={onClose}
              className="block w-full text-center px-5 py-3 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90"
              style={{ background: "var(--gold)", color: "#131312", borderRadius: "12px", border: "none", cursor: "pointer" }}>
              {close}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* OtherChipInput — reusable inline "Other…" chip that, on click, transforms
   into a text input with a small minimalist checkmark to confirm. Used by
   Hobbies, IT Skills, and Hospital Departments to keep one consistent UX. */
function OtherChipInput({ onAdd, placeholder, label }: {
  onAdd: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLSpanElement>(null);

  function commit() {
    const v = draft.trim();
    if (v) onAdd(v);
    setDraft("");
    setAdding(false);
  }

  // Click outside the editor → commit any typed draft and collapse back to
  // the "+ Other…" chip. Empty drafts simply close. Same behaviour as
  // pressing Enter so the editor never gets stranded open.
  useEffect(() => {
    if (!adding) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        commit();
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, draft]);

  if (adding) {
    return (
      <span ref={wrapRef} className="inline-flex items-center gap-1 text-[13px] rounded-full"
        style={{ background: "var(--bg2)", border: "1px solid var(--gold)", paddingLeft: "14px", paddingRight: "4px" }}>
        <input
          type="text"
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(""); setAdding(false); } }}
          placeholder={placeholder}
          className="bg-transparent outline-none text-[13px] font-medium py-2 min-w-[80px] max-w-[180px]"
          style={{ color: "var(--w)" }}
        />
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); commit(); }}
          aria-label="Confirm"
          disabled={!draft.trim()}
          className="inline-flex items-center justify-center w-6 h-6 rounded-full transition-opacity hover:opacity-80 disabled:opacity-30"
          style={{ background: "transparent", border: "none", color: "var(--w2)", cursor: "pointer" }}>
          <Check size={13} strokeWidth={2.2} />
        </button>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setAdding(true)}
      className="inline-flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-full transition-all hover:opacity-90"
      style={{ background: "var(--bg2)", color: "var(--w2)", border: "none" }}>
      <Plus size={13} strokeWidth={1.8} />{label}
    </button>
  );
}

/* AbiturInfoPopup — friendly guidance popup for the Abitur (Baccalaureate)
   entry. Same layout / look as the InternshipInfoPopup so the help system
   feels consistent. */
function AbiturInfoPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang } = useLang();
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  const title = lang === "de" ? "Hinweis zum Abitur" : lang === "en" ? "About the Baccalaureate" : "À propos du Baccalauréat";
  const dosTitle   = lang === "de" ? "Mach das" : lang === "en" ? "Do this" : "Fais ceci";
  const dontsTitle = lang === "de" ? "Mach das nicht" : lang === "en" ? "Don't do this" : "Ne fais pas ceci";

  const dos: string[] = lang === "de"
    ? [
        "Trage NUR das letzte Schuljahr ein (meistens September bis Juni).",
        "Schreibe in „Einrichtung“ den Namen deines Lycée / Gymnasiums.",
        "Wähle das Land, in dem die Schule steht.",
      ]
    : lang === "en"
      ? [
          "Enter ONLY the last year of high school (most of the time September to June).",
          "In \"Establishment\", write the name of your lycée / high school.",
          "Pick the country where your school is.",
        ]
      : [
          "Entre UNIQUEMENT la dernière année de lycée (le plus souvent septembre à juin).",
          "Dans « Établissement », écris le nom de ton lycée.",
          "Choisis le pays où se trouve ton lycée.",
        ];

  const donts: string[] = lang === "de"
    ? [
        "Trage nicht alle Jahre der Schule ein — nur das Abschlussjahr.",
        "Schreibe nicht „Abitur“ in das Schulnamen-Feld.",
      ]
    : lang === "en"
      ? [
          "Don't list every year of school — only the final year.",
          "Don't put \"Baccalaureate\" in the school-name field.",
        ]
      : [
          "Ne liste pas toutes les années de lycée — uniquement l'année du Bac.",
          "Ne mets pas « Baccalauréat » dans le nom du lycée.",
        ];

  const close = lang === "de" ? "Verstanden" : lang === "en" ? "Got it" : "Compris";

  return (
    <>
      <div className="fixed inset-0 z-[1100]"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", animation: "bvFadeRise 0.2s var(--ease-out)" }}
        onClick={onClose} />
      <div className="fixed inset-0 z-[1101] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-[400px] max-h-[85vh] overflow-y-auto flex flex-col pointer-events-auto"
          style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)" }}>
          <div className="px-6 pt-6 pb-2 text-center">
            <span className="mx-auto mb-3 flex items-center justify-center w-12 h-12 rounded-full"
              style={{ background: "var(--info-bg)", color: "var(--info)" }}>
              <Info size={20} strokeWidth={1.8} />
            </span>
            <h3 className="text-[16px] font-semibold mb-4" style={{ color: "var(--w)" }}>{title}</h3>
          </div>
          <div className="px-6 pb-2 space-y-4">
            <div className="rounded-2xl p-4" style={{ background: "var(--success-bg)" }}>
              <div className="text-[12px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--success)" }}>
                {dosTitle}
              </div>
              <ul className="space-y-2.5">
                {dos.map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed" style={{ color: "var(--w)" }}>
                    <span className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
                      style={{ background: "var(--success-bg)", color: "var(--success)" }}>
                      <Check size={11} strokeWidth={2.5} />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl p-4" style={{ background: "var(--danger-bg)" }}>
              <div className="text-[12px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--danger)" }}>
                {dontsTitle}
              </div>
              <ul className="space-y-2.5">
                {donts.map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed" style={{ color: "var(--w)" }}>
                    <span className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
                      style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
                      <XIcon size={11} strokeWidth={2.5} />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="p-4">
            <button type="button" onClick={onClose}
              className="block w-full text-center px-5 py-3 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90"
              style={{ background: "var(--gold)", color: "#131312", borderRadius: "12px", border: "none", cursor: "pointer" }}>
              {close}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* Hobbies — 4 default selectable chips with minimalist line icons + a free
   text field for custom additions. Saved as a comma-separated string in
   cvData.hobbies (CV stays in German). */
const HOBBY_DEFAULTS: { de: string; fr: string; en: string; Icon: LucideIcon }[] = [
  { de: "Lesen",   fr: "Lecture",  en: "Reading", Icon: BookOpen },
  { de: "Sport",   fr: "Sport",    en: "Sport",   Icon: Dumbbell },
  { de: "Reisen",  fr: "Voyage",   en: "Travel",  Icon: Plane    },
  { de: "Musik",   fr: "Musique",  en: "Music",   Icon: Music    },
];

function HobbiesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { lang } = useLang();
  const items = value.split(",").map(s => s.trim()).filter(Boolean);
  const itemsSet = new Set(items);
  const customs = items.filter(it => !HOBBY_DEFAULTS.some(d => d.de === it));

  function toggleDefault(de: string) {
    const next = itemsSet.has(de) ? items.filter(i => i !== de) : [...items, de];
    onChange(next.join(", "));
  }
  function addCustom(v: string) {
    if (!items.includes(v)) onChange([...items, v].join(", "));
  }
  function removeCustom(c: string) {
    onChange(items.filter(i => i !== c).join(", "));
  }

  const otherLabel = lang === "de" ? "Andere…" : lang === "en" ? "Other…" : "Autre…";

  return (
    <div className="flex flex-wrap gap-2">
      {HOBBY_DEFAULTS.map(h => {
        const selected = itemsSet.has(h.de);
        const label = h[lang as "fr"|"en"|"de"] ?? h.de;
        return (
          <button key={h.de} type="button" onClick={() => toggleDefault(h.de)}
            className="inline-flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-full transition-all"
            style={{
              background: selected ? "var(--gdim)" : "var(--bg2)",
              color: selected ? "var(--gold)" : "var(--w2)",
              border: "none",
              fontWeight: selected ? 600 : 400,
            }}>
            <h.Icon size={13} strokeWidth={1.7} />{label}
          </button>
        );
      })}
      {customs.map(c => (
        <span key={c} className="inline-flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-full font-semibold"
          style={{ background: "var(--gdim)", color: "var(--gold)" }}>
          {c}
          <button onClick={() => removeCustom(c)} aria-label="Remove"
            className="inline-flex items-center justify-center w-4 h-4 rounded-full transition-opacity hover:opacity-70"
            style={{ background: "transparent", border: "none", color: "var(--gold)", cursor: "pointer" }}>
            <XIcon size={10} strokeWidth={2} />
          </button>
        </span>
      ))}
      <OtherChipInput
        label={otherLabel}
        placeholder={lang === "de" ? "Hobby…" : lang === "en" ? "Hobby…" : "Passion…"}
        onAdd={addCustom}
      />
    </div>
  );
}

/* Schwerpunkt (Abitur specialization track) — top-10 Moroccan baccalaureate
   tracks. Saves the German term to cvData (CV stays in German); display
   labels are localized for the form. PC is most common, listed first. */
const ABITUR_FOCUSES: { de: string; fr: string; en: string }[] = [
  { de: "Physikwissenschaften (PC)",    fr: "Sciences Physiques (PC)",                 en: "Physical Sciences (PC)" },
  { de: "Biowissenschaften (SVT)",      fr: "Sciences de la Vie et de la Terre (SVT)", en: "Life & Earth Sciences (SVT)" },
  { de: "Mathematische Wissenschaften", fr: "Sciences Mathématiques",                  en: "Mathematical Sciences" },
  { de: "Wirtschaftswissenschaften",    fr: "Sciences Économiques",                    en: "Economic Sciences" },
  { de: "Geisteswissenschaften",        fr: "Sciences Humaines",                       en: "Humanities" },
  { de: "Literatur",                    fr: "Lettres",                                 en: "Literature" },
];

function AbiturFocusField({ entry, updateEdu }: {
  entry: EduEntry;
  updateEdu: (id: string, patch: Partial<EduEntry>) => void;
}) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const otherLabel = lang === "de" ? "Andere…" : lang === "en" ? "Other…" : "Autre…";
  const otherPh    = lang === "de" ? "Schwerpunkt eingeben" : lang === "en" ? "Enter specialization" : "Saisir la spécialité";

  const knownDeValues = ABITUR_FOCUSES.map(f => f.de);
  // If the stored value isn't one of the 10 presets, treat it as a free-text "other".
  const isOther = !!entry.abiturFocus && !knownDeValues.includes(entry.abiturFocus);

  // Sentinel value carried only by the picker — never written to cvData.
  const OTHER_SENTINEL = "__other__";

  const options = [
    ...ABITUR_FOCUSES.map(f => ({
      value: f.de,
      label: f[lang as "fr"|"en"|"de"] ?? f.de,
    })),
    { value: OTHER_SENTINEL, label: otherLabel },
  ];

  const label = lang === "de" ? "Schwerpunkt" : lang === "en" ? "Specialization" : "Spécialité";
  const currentLabel = isOther
    ? otherLabel
    : (options.find(o => o.value === entry.abiturFocus)?.label ?? "—");
  // What value the popup considers "selected"
  const pickerSelectedValue = isOther ? OTHER_SENTINEL : (entry.abiturFocus ?? "");

  function handlePick(v: string) {
    if (v === OTHER_SENTINEL) {
      // Switch into free-text mode. Clear so the user starts fresh; the text
      // field below shows up because abiturFocus is no longer a known value.
      // Use a single space so isOther becomes true (empty string would not).
      updateEdu(entry.id, { abiturFocus: " " });
    } else {
      updateEdu(entry.id, { abiturFocus: v });
    }
    setOpen(false);
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>{label}</Label>
        <button type="button" onClick={() => setOpen(true)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-[15px] font-medium outline-none cursor-pointer transition-all"
          style={{ background: "var(--bg2)", border: "1px solid transparent", color: entry.abiturFocus ? "var(--w)" : "var(--w3)", borderRadius: "12px" }}>
          <span className="truncate">{currentLabel}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0, marginLeft: 8 }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
      {isOther && (
        <Input
          value={entry.abiturFocus?.trim() ?? ""}
          onChange={v => updateEdu(entry.id, { abiturFocus: v || " " })}
          placeholder={otherPh}
        />
      )}
      <PickerPopup
        open={open}
        title={label}
        options={options}
        selectedValue={pickerSelectedValue}
        onPick={handlePick}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

/** Nationality picker — same popup design as PhoneInput, shows flag + localized country name.
   Saves the German country name (e.g. "Marokko") to cvData.nationality for CV output. */
function NationalityPicker({ value, onChange, titleOverride }: {
  value: string;
  onChange: (de: string) => void;
  /** Optional popup title — defaults to "Nationality" / "Staatsangehörigkeit" / "Nationalité".
      Pass when reusing this picker as a generic country picker (e.g. Land for Abitur). */
  titleOverride?: { de: string; en: string; fr: string };
}) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);

  // Build sorted options for current language.
  const options = Object.entries(COUNTRY_MAP)
    .map(([iso3, names]) => ({ iso3, iso2: ISO3_TO_ISO2[iso3] ?? iso3.slice(0,2).toLowerCase(), label: names[lang as "fr"|"en"|"de"] ?? names.de, de: names.de }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const selected = options.find(o => o.de === value);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function pick(de: string) {
    onChange(de);
    setOpen(false);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-[15px] font-medium outline-none cursor-pointer transition-all"
        style={{ background: "var(--bg2)", border: "1px solid transparent", color: selected ? "var(--w)" : "var(--w3)", borderRadius: "12px" }}
        onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
        onBlur={e => (e.currentTarget.style.borderColor = "transparent")}
      >
        {selected && <CountryFlag iso={selected.iso2} size={20} />}
        <span className="flex-1 text-left">{selected ? selected.label : "—"}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1100]"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", animation: "bvFadeRise 0.2s var(--ease-out)" }}
            onClick={() => setOpen(false)} />
          <div className="fixed inset-0 z-[1101] flex items-center justify-center p-4 pointer-events-none">
            <div className="w-full max-w-[360px] max-h-[70vh] overflow-hidden flex flex-col pointer-events-auto"
              style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)" }}>
              <div className="flex items-center justify-between px-5 py-4">
                <h3 className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>
                  {titleOverride
                    ? (titleOverride[lang as "fr"|"en"|"de"] ?? titleOverride.de)
                    : (lang === "de" ? "Staatsangehörigkeit" : lang === "en" ? "Nationality" : "Nationalité")}
                </h3>
                <button type="button" onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex items-center justify-center w-8 h-8 transition-opacity hover:opacity-70"
                  style={{ background: "var(--bg2)", border: "none", borderRadius: "10px", color: "var(--w2)", cursor: "pointer" }}>
                  <XIcon size={15} strokeWidth={2} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2">
                {options.map(o => (
                  <button key={o.iso3} type="button" onClick={() => pick(o.de)}
                    onMouseEnter={e => { if (o.de !== value) e.currentTarget.style.background = "var(--bg2)"; }}
                    onMouseLeave={e => { if (o.de !== value) e.currentTarget.style.background = "transparent"; }}
                    className="w-full flex items-center gap-3 px-3 py-3 text-[14px] text-left transition-colors"
                    style={{ background: o.de === value ? "var(--bg2)" : "transparent", border: "none", color: "var(--w)", borderRadius: "10px", cursor: "pointer" }}>
                    <CountryFlag iso={o.iso2} size={22} />
                    <span className="flex-1 truncate">{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* Nursing training status — popup picker (matches country/year style).
   When status is "complete" (diploma obtained), an extra month/year picker
   appears for the official diploma issuance date — distinct from training
   end date (training usually ends in June, diploma issues Oct–Jan). */
function NursingStatusField({ entry, updateEdu, diplomaHasError = false }: {
  entry: EduEntry;
  updateEdu: (id: string, patch: Partial<EduEntry>) => void;
  diplomaHasError?: boolean;
}) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);

  const options = [
    { value: "complete", label: t.cvb_nursingComplete },
    { value: "year3",    label: t.cvb_nursingYear3 },
    { value: "year2",    label: t.cvb_nursingYear2 },
    { value: "year1",    label: t.cvb_nursingYear1 },
  ];
  const currentLabel = options.find(o => o.value === entry.nursingStatus)?.label ?? "—";

  const diplomaQuestion = lang === "de"
    ? "Wann wurde das Diplom offiziell ausgestellt?"
    : lang === "en"
      ? "When was the diploma officially issued?"
      : "Quand le diplôme a-t-il été officiellement délivré ?";

  return (
    <div className="sm:col-span-2 space-y-5">
      <div>
        <Label>{t.cvb_nursingStatusLabel}</Label>
        <button type="button" onClick={() => setOpen(true)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-[15px] font-medium outline-none cursor-pointer transition-all"
          style={{ background: "var(--bg2)", border: "1px solid transparent", color: "var(--w)", borderRadius: "12px" }}>
          <span className="truncate">{currentLabel}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0, marginLeft: 8 }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <PickerPopup
          open={open}
          title={t.cvb_nursingStatusLabel}
          options={options}
          selectedValue={entry.nursingStatus}
          onPick={v => {
            const next: Partial<EduEntry> = { nursingStatus: v as EduEntry["nursingStatus"] };
            // When switching to "complete", convert any null end ("Currently")
            // back to a real picker value so the user can fill the actual
            // training-end month/year.
            if (v === "complete" && entry.end === null) next.end = { month: "", year: "" };
            updateEdu(entry.id, next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      </div>

      {/* Diploma issued date — only appears when "complete" is selected */}
      {entry.nursingStatus === "complete" && (
        <div>
          <p className="text-[12px] font-normal mb-2.5" style={{ color: "var(--w3)" }}>
            {diplomaQuestion}
          </p>
          <MonthYearPicker
            label=""
            value={entry.diplomaIssued ?? { month: "", year: "" }}
            onChange={v => updateEdu(entry.id, { diplomaIssued: v })}
            lang={lang}
            hasError={diplomaHasError}
          />
        </div>
      )}
    </div>
  );
}

/* Locked field — shows the value (filled from passport) or empty.
   On click, opens a popup explaining the user must upload their passport
   in the dashboard. Used for first name, last name, DOB, place of birth,
   nationality, address, city — anything that comes from official ID.

   Right-side indicator depends on `passportStatus`:
     null       → 🔒 lock (passport not yet uploaded)
     pending    → small "Pending" pill (passport submitted, admin reviewing)
     rejected   → small "Rejected" pill
     approved   → green ✓ checkmark — data is verified, lock conceptually lifted */
function LockedField({ value, placeholder, onLockedClick, displayFlag, passportStatus, hasError, onChange }: {
  value: string;
  placeholder?: string;
  onLockedClick: () => void;
  displayFlag?: { iso2: string };
  passportStatus: null | "pending" | "approved" | "rejected";
  hasError?: boolean;
  onChange?: (v: string) => void;
}) {
  const { lang } = useLang();

  // Supreme admin unlock: render as a real editable input
  if (onChange) {
    return (
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "—"}
        className="w-full px-4 py-3.5 text-[15px] font-medium outline-none"
        style={{
          background: "var(--bg2)",
          border: `1px solid ${hasError ? "var(--danger)" : "var(--border-gold)"}`,
          color: "var(--w)",
          borderRadius: "12px",
        }}
      />
    );
  }

  const indicator = (() => {
    if (passportStatus === "approved") {
      return (
        <span className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0"
          style={{ background: "var(--success-bg)", color: "var(--success)" }}>
          <Check size={11} strokeWidth={2.5} />
        </span>
      );
    }
    if (passportStatus === "pending") {
      const label = lang === "de" ? "Prüfung" : lang === "en" ? "Pending" : "En attente";
      return (
        <span className="text-[10.5px] font-semibold px-2 py-1 rounded-full flex-shrink-0"
          style={{ background: "var(--gdim)", color: "var(--gold)" }}>
          {label}
        </span>
      );
    }
    if (passportStatus === "rejected") {
      const label = lang === "de" ? "Abgelehnt" : lang === "en" ? "Rejected" : "Refusé";
      return (
        <span className="text-[10.5px] font-semibold px-2 py-1 rounded-full flex-shrink-0"
          style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
          {label}
        </span>
      );
    }
    return <Lock size={13} strokeWidth={1.8} style={{ color: "var(--w3)", flexShrink: 0 }} />;
  })();
  return (
    <button type="button" onClick={onLockedClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-[15px] font-medium outline-none cursor-pointer transition-all hover:opacity-90"
      style={{ background: "var(--bg2)", border: `1px solid ${hasError ? "var(--danger)" : "transparent"}`, color: value ? "var(--w)" : "var(--w3)", borderRadius: "12px", textAlign: "left" }}>
      {displayFlag && <CountryFlag iso={displayFlag.iso2} size={20} />}
      <span className="flex-1 truncate">{value || placeholder || "—"}</span>
      {indicator}
    </button>
  );
}

/* Modal popup shown when user clicks a locked field. Body and title vary
   by passport status so the user always knows what action (if any) to take. */
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
      ? "Ihr Reisepass wurde hochgeladen und wird derzeit von unserem Team geprüft. Sobald die Daten genehmigt sind, können Sie den Lebenslauf erstellen. Bitte haben Sie etwas Geduld."
      : lang === "en"
        ? "Your passport has been uploaded and is currently being reviewed by our team. Once the data is approved you'll be able to generate the CV. Please bear with us."
        : "Votre passeport a été téléversé et est en cours d'examen par notre équipe. Une fois les données approuvées, vous pourrez générer le CV. Merci de patienter.";
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

function SectionCard({ id, title, kind, children, action, forceOpen = false }: {
  id?: string; title: string; kind: SectionKind; children: React.ReactNode; action?: React.ReactNode; forceOpen?: boolean;
}) {
  // Collapsible — open by default. User can collapse sections they're done with
  // to focus on what's left. Especially useful on mobile where the form is long.
  const [open, setOpen] = useState(true);
  const isOpen = forceOpen || open;
  return (
    <div id={id} className="mb-4 transition-all overflow-hidden"
      style={{ background: "var(--card)", border: "none", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <div className={`flex items-center justify-between gap-3 px-6 ${isOpen ? "pt-6 mb-6" : "py-5"}`}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={isOpen}
          className="flex items-center gap-3 text-left flex-1 min-w-0"
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
          <span className="flex items-center justify-center w-9 h-9 flex-shrink-0"
            style={{ background: "var(--gdim)", color: "var(--gold)", border: "none", borderRadius: "12px" }}>
            <SectionIcon kind={kind} size={15} />
          </span>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] flex-1 min-w-0" style={{ color: "var(--w)" }}>{title}</h2>
          <span className="flex items-center justify-center w-7 h-7 flex-shrink-0 transition-transform"
            style={{ color: "var(--w3)", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
            aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </button>
        {action && isOpen && <div className="flex-shrink-0">{action}</div>}
      </div>
      {isOpen && <div className="px-6 pb-6">{children}</div>}
    </div>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className="bv-row-hover inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 mt-3"
      style={{ color: "var(--w2)" }}>
      <Plus size={13} strokeWidth={1.8} /> {label}
    </button>
  );
}

function RemoveBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="bv-row-hover inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1"
      style={{ color: "var(--danger)" }}>
      <XIcon size={11} strokeWidth={1.8} /> {label}
    </button>
  );
}

// ─── Validation error → human-readable label ────────────────────────────────

function getValidationErrorLabels(errors: Set<string>, lang: string): string[] {
  const L = lang === "fr" ? {
    photo:"Photo de profil", firstName:"Prénom", lastName:"Nom de famille",
    birthDate:"Date de naissance", birthPlace:"Ville de naissance",
    email:"Email", phone:"Téléphone", address:"Adresse", postalCode:"Code postal",
    city:"Ville de résidence", nationality:"Nationalité",
    countryOfBirth:"Pays de naissance", countryOfResidence:"Pays de résidence",
    eduInstitution:"Établissement (formation)", eduLocation:"Ville (formation)",
    eduStart:"Début (formation)", eduEnd:"Fin (formation)", eduDiploma:"Date du diplôme",
    workEmployer:"Employeur", workLocation:"Ville (expérience)",
    workStart:"Début (expérience)", workEnd:"Fin (expérience)",
    workDepts:"Département de soins (expérience)",
    langLevel:"Niveau de langue", edvSelected:"Compétences informatiques (EDV)",
    driverLicense:"Permis de conduire", hobbies:"Loisirs / Intérêts",
    maritalStatus:"État civil",
  } : lang === "de" ? {
    photo:"Profilfoto", firstName:"Vorname", lastName:"Nachname",
    birthDate:"Geburtsdatum", birthPlace:"Geburtsort",
    email:"E-Mail", phone:"Telefonnummer", address:"Adresse", postalCode:"Postleitzahl",
    city:"Wohnort", nationality:"Staatsangehörigkeit",
    countryOfBirth:"Geburtsland", countryOfResidence:"Wohnland",
    eduInstitution:"Schule / Einrichtung", eduLocation:"Ort (Ausbildung)",
    eduStart:"Beginn (Ausbildung)", eduEnd:"Ende (Ausbildung)", eduDiploma:"Diplomdatum",
    workEmployer:"Arbeitgeber", workLocation:"Ort (Arbeit)",
    workStart:"Beginn (Arbeit)", workEnd:"Ende (Arbeit)",
    workDepts:"Fachbereiche (Arbeit)",
    langLevel:"Sprachniveau", edvSelected:"EDV-Kenntnisse",
    driverLicense:"Führerschein", hobbies:"Hobbys",
    maritalStatus:"Familienstand",
  } : {
    photo:"Profile photo", firstName:"First name", lastName:"Last name",
    birthDate:"Date of birth", birthPlace:"City of birth",
    email:"Email", phone:"Phone number", address:"Address", postalCode:"Postal code",
    city:"City of residence", nationality:"Nationality",
    countryOfBirth:"Country of birth", countryOfResidence:"Country of residence",
    eduInstitution:"Educational institution", eduLocation:"Location (education)",
    eduStart:"Start date (education)", eduEnd:"End date (education)", eduDiploma:"Diploma date",
    workEmployer:"Employer", workLocation:"Location (work)",
    workStart:"Start date (work)", workEnd:"End date (work)",
    workDepts:"Departments (work)",
    langLevel:"Language level", edvSelected:"IT skills (EDV)",
    driverLicense:"Driver's license", hobbies:"Hobbies",
    maritalStatus:"Marital status",
  };
  const seen = new Set<string>();
  const labels: string[] = [];
  function add(lbl: string) { if (!seen.has(lbl)) { seen.add(lbl); labels.push(lbl); } }
  for (const key of errors) {
    if (key === "photo")               { add(L.photo); continue; }
    if (key === "firstName")           { add(L.firstName); continue; }
    if (key === "lastName")            { add(L.lastName); continue; }
    if (key === "birthDate")           { add(L.birthDate); continue; }
    if (key === "birthPlace")          { add(L.birthPlace); continue; }
    if (key === "email")               { add(L.email); continue; }
    if (key === "phone")               { add(L.phone); continue; }
    if (key === "address")             { add(L.address); continue; }
    if (key === "postalCode")          { add(L.postalCode); continue; }
    if (key === "city")                { add(L.city); continue; }
    if (key === "nationality")         { add(L.nationality); continue; }
    if (key === "countryOfBirth")      { add(L.countryOfBirth); continue; }
    if (key === "countryOfResidence")  { add(L.countryOfResidence); continue; }
    if (key.startsWith("edu_") && key.endsWith("_institution")) { add(L.eduInstitution); continue; }
    if (key.startsWith("edu_") && key.endsWith("_location"))    { add(L.eduLocation); continue; }
    if (key.startsWith("edu_") && key.endsWith("_start"))       { add(L.eduStart); continue; }
    if (key.startsWith("edu_") && key.endsWith("_end"))         { add(L.eduEnd); continue; }
    if (key.startsWith("edu_") && key.endsWith("_diplomaIssued")) { add(L.eduDiploma); continue; }
    if (key.startsWith("work_") && key.endsWith("_employer"))   { add(L.workEmployer); continue; }
    if (key.startsWith("work_") && key.endsWith("_location"))   { add(L.workLocation); continue; }
    if (key.startsWith("work_") && key.endsWith("_start"))      { add(L.workStart); continue; }
    if (key.startsWith("work_") && key.endsWith("_end"))        { add(L.workEnd); continue; }
    if (key.startsWith("work_") && key.endsWith("_departments")){ add(L.workDepts); continue; }
    if (key.startsWith("lang_") && key.endsWith("_level"))      { add(L.langLevel); continue; }
    if (key === "edvSelected")         { add(L.edvSelected); continue; }
    if (key === "driverLicense")       { add(L.driverLicense); continue; }
    if (key === "hobbies")             { add(L.hobbies); continue; }
    if (key === "maritalStatus")       { add(L.maritalStatus); continue; }
  }
  return labels;
}

// ─── Main page ───────────────────────────────────────────────────────────────

function CVBuilderInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const adminCandidateId = searchParams.get("candidateId");
  const { t, lang } = useLang();
  const photoRef = useRef<HTMLInputElement>(null);
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [userId, setUserId]       = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [cvData, setCvData]       = useState<CVData>(() => makeCVData());

  const [smartGaps, setSmartGaps]       = useState<SmartGap[]>([]);
  const [showGapPanel, setShowGapPanel] = useState(false);
  // Photo crop pipeline — when a candidate picks a photo we stage the raw
  // data URL here, open the crop modal, and only commit to cvData.photo
  // (and the server-side avatar) once they hit Save.
  const [pendingPhotoSrc, setPendingPhotoSrc] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [pdfBlob, setPdfBlob]       = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrlRaw]      = useState<string | null>(null);
  // Always revoke the previous blob URL when replacing — otherwise PDFs leak
  // ~1MB each and a long session burns megabytes.
  const setPdfUrl = (next: string | null) => {
    setPdfUrlRaw(prev => {
      if (prev && prev !== next) {
        try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
      }
      return next;
    });
  };
  // Final cleanup on unmount.
  useEffect(() => {
    return () => {
      if (pdfUrl) { try { URL.revokeObjectURL(pdfUrl); } catch { /* ignore */ } }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [uploading, setUploading]       = useState(false);
  const [uploaded, setUploaded]         = useState(false);
  const [uploadErr, setUploadErr]       = useState("");
  const [genError, setGenError]         = useState("");
  const [showCvPreview, setShowCvPreview]         = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [edvInput, setEdvInput]     = useState("");
  const [authToken, setAuthToken]   = useState("");

  // Validation errors — set of field keys that failed required check
  const [validationErrors, setValidationErrors] = useState<Set<string>>(new Set());
  // Kids follow-up — three states: unanswered (""), explicitly "no", or "yes"
  // with ages. We parse this out of the maritalStatus string on every render
  // (no parallel state to drift), and write back through composeMaritalStatus.
  const [kidsAnswer, setKidsAnswerState] = useState<"" | "yes" | "no">("");
  // Persist the explicit Yes/No answer so a "No" choice survives reloads
  // (the saved maritalStatus alone can't disambiguate "no" from "not yet answered").
  const setKidsAnswer = (v: "" | "yes" | "no") => {
    setKidsAnswerState(v);
    if (typeof window !== "undefined" && userId) {
      try {
        if (v) localStorage.setItem(`bv-cv-kids-${userId}`, v);
        else   localStorage.removeItem(`bv-cv-kids-${userId}`);
      } catch { /* storage unavailable */ }
    }
  };

  // When maritalStatus is loaded from draft/passport with parens (= "yes" with
  // ages), sync the kidsAnswer state so the UI reflects the saved answer.
  // Also restores the persisted "No" choice on first render.
  useEffect(() => {
    const { base, ages } = parseMaritalStatus(cvData.maritalStatus);
    if (base && base !== "ledig" && ages.length > 0 && kidsAnswer === "") {
      setKidsAnswerState("yes");
      return;
    }
    // Try restoring an explicit "No" from localStorage
    if (kidsAnswer === "" && userId && typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(`bv-cv-kids-${userId}`) as "yes" | "no" | null;
        if (saved === "no" && base && base !== "ledig") setKidsAnswerState("no");
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvData.maritalStatus, userId]);
  // Auto-fill banner
  const [autoFillDone, setAutoFillDone] = useState(false);
  const [lockedPopupOpen, setLockedPopupOpen] = useState(false);
  // null = no passport submitted | "pending" | "approved" | "rejected"
  const [passportStatus, setPassportStatus] = useState<null | "pending" | "approved" | "rejected">(null);
  // Payment tier — null = free, "starter", "kandidat"
  const [paymentTier, setPaymentTier] = useState<string | null>(null);
  // Starter upgrade modal
  const [starterUpgradeOpen, setStarterUpgradeOpen] = useState(false);
  const [starterUpgradeLoading, setStarterUpgradeLoading] = useState(false);
  // Candidate's sex extracted from the passport — drives the gendered job
  // title for the mandatory nursing internship ("Pflegepraktikant" vs
  // "Pflegepraktikantin").
  const [sex, setSex] = useState<"M" | "F" | null>(null);
  // Info popup explaining how to fill the nursing internship section
  const [internshipInfoOpen, setInternshipInfoOpen] = useState(false);
  // Info popup explaining how to fill the Abitur (high school) section
  const [abiturInfoOpen, setAbiturInfoOpen] = useState(false);
  // Additional-nationality picker popup state (max 5 total nationalities).
  const [extraNatPickerOpen, setExtraNatPickerOpen] = useState(false);
  const showLocked = () => setLockedPopupOpen(true);
  // Autosave indicator state
  const [savedAt, setSavedAt]       = useState<Date | null>(null);
  const [saveError, setSaveError]   = useState(false);

  // ── Draft key (per user) ──────────────────────────────────────────────────
  // When admin edits a candidate's CV, key by candidateId so we don't
  // overwrite the admin's own draft.
  const draftKey = userId
    ? (adminCandidateId ? `bv-cv-draft-${adminCandidateId}` : `bv-cv-draft-${userId}`)
    : null;

  // ── Auto-save draft (localStorage immediately + server after 2.5 s) ─────────
  useEffect(() => {
    // Never save during initial load — draft hasn't been restored yet, so cvData
    // is still the empty default state and would overwrite the saved draft.
    if (!draftKey || !userId || !authToken || loading) return;
    const { photo, ...rest } = cvData;
    void photo;
    // 1. Always write to localStorage for instant in-tab cache
    try {
      localStorage.setItem(draftKey, JSON.stringify(rest));
      setSaveError(false);
    } catch { setSaveError(true); }
    // 2. Debounce the server write — fire 2.5 s after the last change
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    serverSaveTimer.current = setTimeout(() => {
      const draftUrl = adminCandidateId
        ? `/api/portal/admin/cv-draft?candidateId=${adminCandidateId}`
        : "/api/portal/me/cv-draft";
      fetch(draftUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(rest),
      })
        .then(r => { if (r.ok) setSavedAt(new Date()); else setSaveError(true); })
        .catch(() => setSaveError(true));
    }, 2500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvData, draftKey, loading]);

  // ── Flush pending save immediately on tab hide / page unload ──────────────
  useEffect(() => {
    // Same guard: don't register the flush handler until the draft is restored.
    if (!authToken || loading) return;
    const flush = () => {
      if (serverSaveTimer.current) {
        clearTimeout(serverSaveTimer.current);
        serverSaveTimer.current = null;
      }
      const { photo, ...rest } = cvData;
      void photo;
      // keepalive: true survives tab close / navigation
      const flushUrl = adminCandidateId
        ? `/api/portal/admin/cv-draft?candidateId=${adminCandidateId}`
        : "/api/portal/me/cv-draft";
      fetch(flushUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(rest),
        keepalive: true,
      }).catch(() => { /* best-effort */ });
    };
    window.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, cvData, loading]);

  // ── Apply profile data (used by auto-fill button and on first load) ────────
  function applyProfile(profile: {
    first_name?: string | null;
    last_name?: string | null;
    dob?: string | null;
    nationality?: string | null;
    city_of_birth?: string | null;
    country_of_birth?: string | null;
    country_of_residence?: string | null;
    address_street?: string | null;
    address_number?: string | null;
    address_postal?: string | null;
    city_of_residence?: string | null;
    phone?: string | null;
    marital_status?: string | null;
    children_ages?: string | null;
  }) {
    setCvData(prev => ({
      ...prev,
      firstName:           profile.first_name  || prev.firstName,
      lastName:            profile.last_name   || prev.lastName,
      birthDate:           isoToDDMMYYYY(profile.dob ?? null) || prev.birthDate,
      birthPlace:          profile.city_of_birth || prev.birthPlace,
      countryOfBirth:      toNatDe(profile.country_of_birth) || prev.countryOfBirth,
      nationality:         toNatDe(profile.nationality) || prev.nationality,
      maritalStatus:       computeFamilienstand(profile.marital_status, profile.children_ages) || prev.maritalStatus,
      address:             [profile.address_street, profile.address_number].filter(Boolean).join(" ") || prev.address,
      postalCode:          profile.address_postal      || prev.postalCode,
      city:                profile.city_of_residence   || prev.city,
      countryOfResidence:  toNatDe(profile.country_of_residence) || prev.countryOfResidence,
      phone:               profile.phone               || prev.phone,
    }));
    setAutoFillDone(true);
    setTimeout(() => setAutoFillDone(false), 4000);
  }

  // ── Fetch passport profile (called on demand via "Fill from passport" button)
  async function fetchAndApplyProfile() {
    if (!userId) return;
    const { data } = await supabase
      .from("candidate_profiles")
      .select("first_name,last_name,dob,nationality,city_of_birth,country_of_birth,country_of_residence,address_street,address_number,address_postal,city_of_residence,phone,marital_status,children_ages")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) applyProfile(data);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace("/portal"); return; }

      const uid = session.user.id;
      setUserId(uid);
      setAuthToken(session.access_token ?? "");

      // Admin editing a candidate's CV — skip role check + passport gate
      if (adminCandidateId) {
        setPassportStatus("approved");
        // Check if the editing admin is the supreme admin (unlocks locked fields)
        fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${session.access_token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(j => { if (j?.isSuperAdmin) setIsSuperAdmin(true); })
          .catch(() => {});

        const serverDraft = await fetch(
          `/api/portal/admin/cv-draft?candidateId=${adminCandidateId}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        )
          .then(r => r.ok ? r.json() : null)
          .catch(() => null) as { draft: Partial<CVData> | null; photo: string | null } | null;

        if (serverDraft?.photo) setCvData(d => ({ ...d, photo: serverDraft.photo ?? null }));

        const savedRaw = serverDraft?.draft
          ? JSON.stringify(serverDraft.draft)
          : localStorage.getItem(`bv-cv-draft-${adminCandidateId}`);

        if (savedRaw) {
          try {
            const parsed = JSON.parse(savedRaw) as Partial<CVData>;
            const saved: Partial<CVData> = {
              ...parsed,
              workEntries:    Array.isArray(parsed.workEntries)    ? parsed.workEntries    : undefined,
              eduEntries:     Array.isArray(parsed.eduEntries)     ? parsed.eduEntries     : undefined,
              langs:          Array.isArray(parsed.langs)          ? parsed.langs          : undefined,
              edvSelected:    Array.isArray(parsed.edvSelected)    ? parsed.edvSelected    : undefined,
              edvCustomInputs:Array.isArray(parsed.edvCustomInputs)? parsed.edvCustomInputs: undefined,
              additionalNationalities: Array.isArray(parsed.additionalNationalities) ? parsed.additionalNationalities : undefined,
            };
            setCvData(prev => {
              const merged = { ...prev, ...saved };
              if (merged.nationality) merged.nationality = toNatDe(merged.nationality);
              return merged;
            });
          } catch { /* invalid JSON */ }
        }

        setLoading(false);
        return;
      }

      // Block org members — they have no CV to build
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => null);
      if (roleRes?.ok) {
        const roleJson = await roleRes.json().catch(() => ({}));
        if (roleJson.role === "org_member") { router.replace("/portal/org/dashboard"); return; }
      }

      // 1. Always fetch passport profile (needed to fill empty draft slots too)
      const { data: profile } = await supabase
        .from("candidate_profiles")
        .select("first_name,last_name,dob,sex,nationality,city_of_birth,country_of_birth,country_of_residence,address_street,address_number,address_postal,city_of_residence,marital_status,children_ages,passport_status,payment_tier")
        .eq("user_id", uid)
        .single();
      // Passport status drives the lock state — pending/approved/rejected
      // is reflected on every locked field via a small badge.
      if (profile?.passport_status) {
        const s = profile.passport_status as string;
        if (s === "pending" || s === "approved" || s === "rejected") setPassportStatus(s);
      }
      if ((profile as { payment_tier?: string | null } | null)?.payment_tier) {
        setPaymentTier((profile as { payment_tier?: string | null }).payment_tier ?? null);
      }
      if (profile?.sex) {
        const sx = String(profile.sex).toUpperCase();
        if (sx === "M" || sx === "F") setSex(sx);
      }
      // NOTE: gendered title (Pflegepraktikant/in) is applied INSIDE the
      // draft-merge setCvData below, not here — so the draft's stored
      // workEntries can never overwrite it.

      // 2. Restore saved draft — server wins over localStorage, localStorage is fallback
      const serverDraft = await fetch("/api/portal/me/cv-draft", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null) as { draft: Partial<CVData> | null; photo: string | null } | null;

      // Restore profile photo from server if available
      if (serverDraft?.photo) {
        setCvData(d => ({ ...d, photo: serverDraft.photo ?? null }));
      }

      const savedRaw = serverDraft?.draft
        ? JSON.stringify(serverDraft.draft)
        : localStorage.getItem(`bv-cv-draft-${uid}`);

      if (savedRaw) {
        try {
          const parsed = JSON.parse(savedRaw) as Partial<CVData>;
          // Guard against tampered/old-shape drafts: every array field must
          // actually be an array, otherwise downstream `.map` / `.length`
          // calls throw and the whole page crashes for that user.
          const saved: Partial<CVData> = {
            ...parsed,
            workEntries:    Array.isArray(parsed.workEntries)    ? parsed.workEntries    : undefined,
            eduEntries:     Array.isArray(parsed.eduEntries)     ? parsed.eduEntries     : undefined,
            langs:          Array.isArray(parsed.langs)          ? parsed.langs          : undefined,
            edvSelected:    Array.isArray(parsed.edvSelected)    ? parsed.edvSelected    : undefined,
            edvCustomInputs:Array.isArray(parsed.edvCustomInputs)? parsed.edvCustomInputs: undefined,
            additionalNationalities: Array.isArray(parsed.additionalNationalities) ? parsed.additionalNationalities : undefined,
          };
          setCvData(prev => {
            const merged = { ...prev, ...saved, email: session.user.email ?? (saved.email || "") };
            // Always normalize nationality through toNatDe — handles legacy adjective
            // values stored in older drafts (e.g. "marokkanisch" → "Marokko") so the
            // <select> can match by German name and not show "—".
            if (merged.nationality) merged.nationality = toNatDe(merged.nationality);
            // Locked-field policy:
            //  - APPROVED  → passport DB beats draft (admin corrections win)
            //  - REJECTED  → wipe locked fields entirely; the candidate must
            //                re-upload, so showing stale "verified" data
            //                would be misleading + risk leaking it to the CV
            //  - PENDING / unset → fill empties from DB, keep typed values
            if (profile) {
              const status = profile.passport_status as string | null | undefined;
              const isApproved = status === "approved";
              const isRejected = status === "rejected";
              if (isRejected) {
                merged.firstName         = "";
                merged.lastName          = "";
                merged.birthDate         = "";
                merged.birthPlace        = "";
                merged.countryOfBirth    = "";
                merged.nationality       = "";
                merged.city              = "";
                merged.postalCode        = "";
                merged.address           = "";
                merged.countryOfResidence = "";
              } else {
                const pickPP = (drafted: string | undefined, fromPassport: string) =>
                  isApproved && fromPassport ? fromPassport : (drafted || fromPassport);
                merged.firstName      = pickPP(merged.firstName,                                    profile.first_name        || "");
                merged.lastName       = pickPP(merged.lastName,                                     profile.last_name         || "");
                merged.birthDate      = pickPP(merged.birthDate,                                    isoToDDMMYYYY(profile.dob ?? null));
                merged.birthPlace     = pickPP(merged.birthPlace,                                   profile.city_of_birth     || "");
                merged.countryOfBirth = pickPP(merged.countryOfBirth ?? "",                         toNatDe(profile.country_of_birth));
                merged.nationality    = pickPP(merged.nationality,                                  toNatDe(profile.nationality));
                merged.city              = pickPP(merged.city,                                         profile.city_of_residence || "");
                merged.countryOfResidence = pickPP(merged.countryOfResidence ?? "",                  toNatDe(profile.country_of_residence));
                merged.postalCode        = pickPP(merged.postalCode,                                 profile.address_postal    || "");
                merged.address           = pickPP(merged.address,                                    [profile.address_street, profile.address_number].filter(Boolean).join(" ") || "");
              }
              if (!merged.maritalStatus) merged.maritalStatus = computeFamilienstand(profile.marital_status, profile.children_ages);
            }
            // Always enforce the sex-based internship title as the very last
            // step — this guarantees the draft's stored title (possibly empty
            // or wrong gender from an older session) can never win.
            if (profile?.sex && merged.workEntries.length > 0) {
              const genderedTitle = String(profile.sex).toUpperCase() === "F" ? "Pflegepraktikantin" : "Pflegepraktikant";
              const wEntries = [...merged.workEntries];
              wEntries[0] = { ...wEntries[0], title: genderedTitle };
              merged.workEntries = wEntries;
            }
            return merged;
          });
        } catch { /* invalid JSON */ }
      } else {
        // No draft — auto-fill from passport profile
        setCvData(d => ({ ...d, email: session.user.email ?? "" }));
        if (profile) applyProfile(profile);
        // Apply gendered title (applyProfile doesn't touch workEntries)
        if (profile?.sex) {
          const genderedTitle = String(profile.sex).toUpperCase() === "F" ? "Pflegepraktikantin" : "Pflegepraktikant";
          setCvData(d => {
            if (!d.workEntries.length) return d;
            const next = [...d.workEntries];
            next[0] = { ...next[0], title: genderedTitle };
            return { ...d, workEntries: next };
          });
        }
      }

      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function set<K extends keyof CVData>(key: K, value: CVData[K]) {
    setCvData(d => ({ ...d, [key]: value }));
    // Clear validation error on change
    if (validationErrors.has(key as string)) {
      setValidationErrors(prev => { const n = new Set(prev); n.delete(key as string); return n; });
    }
  }

  function updateWork(id: string, patch: Partial<WorkEntry>) {
    setCvData(d => ({ ...d, workEntries: d.workEntries.map(e => e.id === id ? { ...e, ...patch } : e) }));
    if (validationErrors.size > 0) {
      setValidationErrors(prev => {
        const n = new Set(prev);
        for (const k of Object.keys(patch)) n.delete(`work_${id}_${k}`);
        return n;
      });
    }
  }
  function updateEdu(id: string, patch: Partial<EduEntry>) {
    setCvData(d => ({ ...d, eduEntries: d.eduEntries.map(e => e.id === id ? { ...e, ...patch } : e) }));
    if (validationErrors.size > 0) {
      setValidationErrors(prev => {
        const n = new Set(prev);
        for (const k of Object.keys(patch)) n.delete(`edu_${id}_${k}`);
        return n;
      });
    }
  }

  // ── Photo ─────────────────────────────────────────────────────────────────
  // Stage the picked image so the crop modal can open. Nothing is committed
  // (CV photo, server-side avatar) until the candidate hits Save in the modal.
  function handlePhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still re-triggers onChange
    if (e.target) e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert(t.cvb_photoErrType); return; }
    if (file.size > 5 * 1024 * 1024)    { alert(t.cvb_photoErrSize); return; }
    const reader = new FileReader();
    reader.onload = ev => setPendingPhotoSrc(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  // Called from PhotoCropModal once the user has framed the circle. The
  // returned data URL is already a 600×600 JPEG — we save it as both the
  // CV photo (rendered round in the PDF too) and the profile avatar.
  function commitCroppedPhoto(croppedDataUrl: string) {
    setCvData(d => ({ ...d, photo: croppedDataUrl }));
    setPendingPhotoSrc(null);
    setValidationErrors(prev => { const n = new Set(prev); n.delete("photo"); return n; });
    shrinkAndSaveProfilePhoto(croppedDataUrl).catch(err => {
      console.warn("[cv-builder] profile photo save failed:", err);
    });
  }

  /** Resize an image data URL to a 400px-max JPEG, broadcast the new photo
   *  to anything that's rendering an avatar (ProfileIcon listens), and POST
   *  it as the candidate's profile photo on the server. The broadcast fires
   *  IMMEDIATELY (before the network round-trip) so the navbar avatar swaps
   *  in the new photo with zero perceptible delay. */
  async function shrinkAndSaveProfilePhoto(dataUrl: string) {
    if (!authToken) return;
    const small = await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 400;
        const ratio = img.width > img.height
          ? maxSide / img.width
          : maxSide / img.height;
        const scale = Math.min(1, ratio);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
    // 1. Broadcast base64 immediately so the navbar avatar updates at once
    //    (no wait for the network round-trip to Storage).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("bv-profile-photo-changed", { detail: { photo: small } }));
    }
    // 2. Persist to Supabase Storage (profile_photo stores the public URL).
    const res = await fetch("/api/portal/me/profile-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ photo: small }),
    });
    // 3. Re-broadcast with the Storage URL so subsequent renders use the CDN URL.
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      if (json.photo && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bv-profile-photo-changed", { detail: { photo: json.photo } }));
      }
    }
  }

  // ── Work ──────────────────────────────────────────────────────────────────
  function addWork() {
    const e: WorkEntry = { id: uid(), isGap: false, title: "", employer: "", location: "", country: "Marokko", departments: [], start: { month: "", year: "" }, end: { month: "", year: "" }, gapReason: "" };
    setCvData(d => ({ ...d, workEntries: [...d.workEntries, e] }));
  }
  function addGapEntry(gapStart: MonthYear, gapEnd: MonthYear) {
    const e: WorkEntry = { id: uid(), isGap: true, title: "", employer: "", location: "", departments: [], start: gapStart, end: gapEnd, gapReason: "" };
    setCvData(d => ({ ...d, workEntries: [...d.workEntries, e] }));
  }
  function quickAddForGap(g: SmartGap) {
    const e: WorkEntry = { id: uid(), isGap: false, title: "", employer: "", location: "", country: "Marokko", departments: [], start: g.gapStart, end: g.gapEnd, gapReason: "" };
    setCvData(d => ({ ...d, workEntries: [...d.workEntries, e] }));
    setShowGapPanel(false);
    setTimeout(() => document.getElementById("work-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }
  function removeWork(id: string) { setCvData(d => ({ ...d, workEntries: d.workEntries.filter(e => e.id !== id) })); }
  function toggleWorkDept(entryId: string, de: string) {
    const entry = cvData.workEntries.find(e => e.id === entryId);
    if (!entry) return;
    updateWork(entryId, { departments: entry.departments.includes(de) ? entry.departments.filter(d => d !== de) : [...entry.departments, de] });
  }

  // ── Edu ───────────────────────────────────────────────────────────────────
  function addEdu() {
    const e: EduEntry = { id: uid(), type: "other", institution: "", location: "", start: { month: "", year: "" }, end: { month: "", year: "" }, degree: "", nursingStatus: "complete", country: "Marokko" };
    setCvData(d => ({ ...d, eduEntries: [...d.eduEntries, e] }));
  }
  function removeEdu(id: string) {
    if (id === "edu-abitur" || id === "edu-nursing") return;
    setCvData(d => ({ ...d, eduEntries: d.eduEntries.filter(e => e.id !== id) }));
  }

  // ── EDV ───────────────────────────────────────────────────────────────────
  function toggleEdv(skill: string) {
    setCvData(d => ({ ...d, edvSelected: d.edvSelected.includes(skill) ? d.edvSelected.filter(s => s !== skill) : [...d.edvSelected, skill] }));
    setValidationErrors(prev => { const n = new Set(prev); n.delete("edvSelected"); return n; });
  }
  function addEdvCustom() {
    const v = edvInput.trim();
    if (!v) return;
    setCvData(d => ({ ...d, edvCustomInputs: [...d.edvCustomInputs, v] }));
    setValidationErrors(prev => { const n = new Set(prev); n.delete("edvSelected"); return n; });
    setEdvInput("");
  }
  function removeEdvCustom(i: number) { setCvData(d => ({ ...d, edvCustomInputs: d.edvCustomInputs.filter((_, idx) => idx !== i) })); }

  // ── Scroll to the first section that has validation errors ───────────────
  function scrollToFirstError(errors: Set<string>) {
    const checks: { keys: string[]; id: string }[] = [
      { keys: ["photo"], id: "photo-section" },
      { keys: ["firstName","lastName","birthDate","birthPlace","countryOfBirth","nationality","address","postalCode","city","countryOfResidence","phone","email","maritalStatus"], id: "personal-section" },
      { keys: ["edu_"],          id: "education-section" },
      { keys: ["work_"],         id: "work-section" },
      { keys: ["lang_"],         id: "lang-section" },
      { keys: ["edvSelected"],   id: "skills-section" },
      { keys: ["driverLicense","hobbies"], id: "other-section" },
    ];
    for (const { keys, id } of checks) {
      const hit = [...errors].some(e => keys.some(k => e === k || e.startsWith(k)));
      if (!hit) continue;
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => window.scrollBy({ top: -80, behavior: "smooth" }), 320);
      }
      return;
    }
  }

  // ── Validate ──────────────────────────────────────────────────────────────
  function validate(): Set<string> {
    // Collect ALL missing required field keys so every invalid input shows a
    // red border simultaneously — the user sees exactly what's missing at a
    // glance instead of fixing one thing and re-submitting.
    const errors = new Set<string>();

    // 1. Personal data
    for (const f of REQUIRED_FIELDS) {
      if (!(cvData[f] as string)?.trim()) errors.add(f as string);
    }
    if (!cvData.nationality?.trim())  errors.add("nationality");
    if (!cvData.email?.trim())        errors.add("email");
    if (!cvData.address?.trim())      errors.add("address");
    if (!cvData.postalCode?.trim())        errors.add("postalCode");
    if (!cvData.city?.trim())              errors.add("city");
    if (!cvData.countryOfBirth?.trim())    errors.add("countryOfBirth");
    if (!cvData.countryOfResidence?.trim()) errors.add("countryOfResidence");
    const _phoneDigits = (cvData.phone ?? "").replace(/\D/g, "");
    const _isMorocco   = (cvData.phone ?? "").trimStart().startsWith("+212");
    // ITU E.164: 7-15 digits. Morocco with country code: min 12 digits.
    if (_isMorocco ? _phoneDigits.length < 12 : (_phoneDigits.length < 7 || _phoneDigits.length > 15)) errors.add("phone");
    if (!cvData.maritalStatus?.trim()) errors.add("maritalStatus");

    // 2. Photo
    if (!cvData.photo) errors.add("photo");

    // 3. Education entries
    for (const e of cvData.eduEntries) {
      if (!e.institution.trim()) errors.add(`edu_${e.id}_institution`);
      if (!e.location.trim())    errors.add(`edu_${e.id}_location`);
      if (!e.start.month || !e.start.year) errors.add(`edu_${e.id}_start`);
      const isNursingInProgress = e.type === "nursing" && e.nursingStatus !== "complete";
      if (!isNursingInProgress && (!e.end || !e.end.month || !e.end.year)) errors.add(`edu_${e.id}_end`);
      if (e.type === "nursing" && e.nursingStatus === "complete" && !(e.diplomaIssued?.month && e.diplomaIssued?.year)) errors.add(`edu_${e.id}_diplomaIssued`);
    }

    // 4. Work entries
    let nonGapCount = 0;
    for (const w of cvData.workEntries) {
      if (w.isGap) continue;
      if (!w.employer.trim())  errors.add(`work_${w.id}_employer`);
      if (!w.location.trim())  errors.add(`work_${w.id}_location`);
      if (!w.start.month || !w.start.year) errors.add(`work_${w.id}_start`);
      if (w.end !== null && (!w.end || !w.end.month || !w.end.year)) errors.add(`work_${w.id}_end`);
      // Title + departments required only for position 1; optional for position 2+
      if (nonGapCount === 0 && !w.title?.trim()) errors.add(`work_${w.id}_title`);
      if (nonGapCount === 0 && w.departments.length === 0) errors.add(`work_${w.id}_departments`);
      nonGapCount++;
    }

    // 5. Languages — "" means "not included" (valid); only flag a custom slot
    //    (index ≥ 4) that has a name filled in but no level chosen.
    cvData.langs.forEach((l, i) => {
      if (i >= 4 && l.name?.trim() && !l.level) errors.add(`lang_${i}_level`);
    });

    // 6. IT Skills
    if (cvData.edvSelected.length === 0 && cvData.edvCustomInputs.length === 0) errors.add("edvSelected");

    // 7. Driver license
    if (cvData.driverLicense === "unset") errors.add("driverLicense");

    // 8. Hobbies
    if (!cvData.hobbies.trim()) errors.add("hobbies");

    setValidationErrors(errors);

    if (errors.size > 0) {
      setGenError(
        lang === "de" ? "Bitte alle rot markierten Pflichtfelder ausfüllen."
      : lang === "en" ? "Please fill in all required fields highlighted in red."
      :                 "Veuillez remplir tous les champs obligatoires surlignés en rouge."
      );
    }
    return errors;
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  async function handleGenerate() {
    setGenError("");
    setShowGapPanel(false);

    // Passport must be APPROVED before any CV generation.
    if (passportStatus !== "approved") {
      const msg = passportStatus === "pending"
        ? (lang === "de" ? "Ihr Reisepass wird noch geprüft. Sobald er genehmigt ist, können Sie den Lebenslauf erstellen."
        :  lang === "en" ? "Your passport is still under review. Once it's approved you'll be able to generate the CV."
        :                  "Votre passeport est en cours d'examen. Une fois validé, vous pourrez générer le CV.")
        : passportStatus === "rejected"
        ? (lang === "de" ? "Ihr Reisepass wurde abgelehnt. Bitte laden Sie ihn im Dashboard erneut hoch."
        :  lang === "en" ? "Your passport was rejected. Please re-upload it in the dashboard."
        :                  "Votre passeport a été refusé. Veuillez le téléverser à nouveau dans le tableau de bord.")
        : (lang === "de" ? "Bitte laden Sie zuerst Ihren Reisepass im Dashboard hoch."
        :  lang === "en" ? "Please upload your passport in the dashboard first."
        :                  "Veuillez d'abord téléverser votre passeport dans le tableau de bord.");
      setGenError(msg);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const errors = validate();
    if (errors.size > 0) {
      // Wait one tick for React to apply the new validationErrors state (red borders),
      // then scroll the page to the first section that has a missing field.
      setTimeout(() => scrollToFirstError(errors), 80);
      return;
    }
    const detectedGaps = detectSmartGaps(cvData.workEntries, cvData.eduEntries);
    if (detectedGaps.length > 0) {
      setSmartGaps(detectedGaps);
      setShowGapPanel(true);
      setTimeout(() => document.getElementById("gap-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      return;
    }

    // Payment gate — skip entirely when admin is editing a candidate's CV
    if (!paymentTier && !adminCandidateId) {
      setStarterUpgradeOpen(true);
      return;
    }

    await doGenerate();
  }

  async function handleUpgradeToStarter() {
    setStarterUpgradeLoading(true);
    try {
      const res = await fetch("/api/portal/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ plan: "starter" }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.url) {
        window.location.href = json.url;
      } else {
        alert(lang === "de" ? "Bitte kontaktieren Sie uns, um Ihr Konto zu upgraden." : lang === "en" ? "Please contact us to upgrade." : "Veuillez nous contacter pour passer au plan Starter.");
        setStarterUpgradeOpen(false);
      }
    } catch {
      alert(t.cvbUpgradeUnavail);
      setStarterUpgradeOpen(false);
    } finally {
      setStarterUpgradeLoading(false);
    }
  }

  async function doGenerate() {
    setGenerating(true); setGenError(""); setPdfBlob(null); setPdfUrl(null); setUploaded(false);
    try {
      const res = await fetch("/api/portal/cv/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(cvData),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || t.cvbErrFallback); }
      const blob = await res.blob();
      setPdfBlob(blob);
      setPdfUrl(URL.createObjectURL(blob));
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : t.cvbErrFallback);
    } finally {
      setGenerating(false);
    }
  }

  function handleDownload() {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = `lebenslauf_${[cvData.firstName, cvData.lastName].filter(Boolean).join("_").toLowerCase() || "cv"}.pdf`;
    a.click();
  }

  async function handleUpload() {
    if (!pdfBlob || !userId) return;
    setUploading(true); setUploadErr("");
    try {
      const fn = [cvData.firstName, cvData.lastName].filter(Boolean).join("_").toLowerCase() || "cv";
      const file = new File([pdfBlob], `lebenslauf_${fn}.pdf`, { type: "application/pdf" });
      const form = new FormData();
      form.append("file", file); form.append("fileType", "Lebenslauf (DE)"); form.append("fileKey", "cv_de");
      // In admin mode, upload to the candidate's dossier not the admin's
      form.append("userId", adminCandidateId ?? userId); form.append("firstName", cvData.firstName); form.append("lastName", cvData.lastName);
      const headers: HeadersInit = authToken ? { Authorization: `Bearer ${authToken}` } : {};
      const res = await fetch("/api/portal/upload", { method: "POST", headers, body: form });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || t.cvbErrFallback); }
      setUploaded(true);
    } catch (err: unknown) {
      setUploadErr(err instanceof Error ? err.message : t.cvbErrFallback);
    } finally {
      setUploading(false);
    }
  }

  // ── Gap modal month formatter ────────────────────────────────────────────
  const months = MONTHS[lang] ?? MONTHS.fr;
  function fmtMY(my: MonthYear) {
    const ml = months.find(m => m.v === my.month)?.l ?? my.month;
    return `${ml} ${my.year}`;
  }

  // ── Dept label helper ─────────────────────────────────────────────────────
  function deptLabel(d: typeof NURSING_DEPTS[0]) {
    if (lang === "en") return d.en;
    if (lang === "de") return d.de;
    return d.fr;
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) return <PageLoader />;

  // Issue 9.1: Gate — require approved passport before CV Builder is usable.
  // "null" means never submitted; "pending"/"rejected" = not yet approved.
  // We show a soft gate with a clear message and a back button — not a hard
  // redirect — so the user understands why they can't access the builder yet.
  if (passportStatus !== "approved") {
    const gateTitle =
      passportStatus === null
        ? (lang === "de" ? "Reisepass erforderlich" : lang === "en" ? "Passport required" : "Passeport requis")
        : passportStatus === "pending"
        ? (lang === "de" ? "Passport wird geprüft" : lang === "en" ? "Passport under review" : "Passeport en cours d'examen")
        : (lang === "de" ? "Passeport abgelehnt" : lang === "en" ? "Passport rejected" : "Passeport refusé");
    const gateBody =
      passportStatus === null
        ? (lang === "de"
            ? "Laden Sie zuerst Ihren Reisepass hoch. Sobald er genehmigt ist, können Sie Ihren Lebenslauf erstellen."
            : lang === "en"
            ? "Please upload your passport first. Once it's approved you can build your CV."
            : "Veuillez d'abord téléverser votre passeport. Une fois approuvé, vous pourrez créer votre Lebenslauf.")
        : passportStatus === "pending"
        ? (lang === "de"
            ? "Ihr Reisepass wird gerade von unserem Team geprüft. Sobald er genehmigt ist, schalten wir den Lebenslauf-Generator frei."
            : lang === "en"
            ? "Your passport is currently under review. Once our team approves it you'll be able to build your CV."
            : "Votre passeport est en cours d'examen par notre équipe. Dès son approbation, vous pourrez générer votre Lebenslauf.")
        : (lang === "de"
            ? "Ihr Reisepass wurde abgelehnt. Bitte laden Sie einen aktualisierten Reisepass hoch, um fortzufahren."
            : lang === "en"
            ? "Your passport was rejected. Please upload an updated passport to continue."
            : "Votre passeport a été refusé. Veuillez téléverser un passeport mis à jour pour continuer.");
    return (
      <main className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 w-14 h-14 flex items-center justify-center rounded-2xl"
            style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
            <Lock size={24} strokeWidth={1.6} style={{ color: "var(--gold)" }} />
          </div>
          <p className="text-base font-semibold mb-2" style={{ color: "var(--w)" }}>{gateTitle}</p>
          <p className="text-[13px] leading-relaxed mb-6" style={{ color: "var(--w3)" }}>{gateBody}</p>
          <button onClick={() => router.push("/portal/dashboard")}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm"
            style={{ background: "var(--gold)", color: "#131312" }}>
            <ArrowLeft size={14} strokeWidth={2} />
            {lang === "de" ? "Zurück zum Portal" : lang === "en" ? "Back to portal" : "Retour au portail"}
          </button>
        </div>
      </main>
    );
  }

  const hasErrors = validationErrors.size > 0;

  return (
    <>
    {/* Photo crop modal — opens whenever a candidate picks a new photo, so
        they can frame their face inside the circle before it lands on
        the CV + their profile avatar. */}
    {pendingPhotoSrc && (
      <PhotoCropModal
        src={pendingPhotoSrc}
        onSave={commitCroppedPhoto}
        onCancel={() => setPendingPhotoSrc(null)}
      />
    )}
    <PassportLockPopup open={lockedPopupOpen} onClose={() => setLockedPopupOpen(false)} passportStatus={passportStatus} />
    <InternshipInfoPopup open={internshipInfoOpen} onClose={() => setInternshipInfoOpen(false)} />
    <AbiturInfoPopup open={abiturInfoOpen} onClose={() => setAbiturInfoOpen(false)} />
    {/* Hidden NationalityPicker that opens via state for adding an extra nationality.
        Once a value is picked, append it to additionalNationalities and close. */}
    {extraNatPickerOpen && (
      <ExtraNationalityPickerHost
        existing={[cvData.nationality, ...(cvData.additionalNationalities ?? [])].filter(Boolean)}
        onPick={(de) => {
          const list = cvData.additionalNationalities ?? [];
          if (!list.includes(de) && de !== cvData.nationality && (1 + list.length) < 5) {
            setCvData(d => ({ ...d, additionalNationalities: [...(d.additionalNationalities ?? []), de] }));
          }
          setExtraNatPickerOpen(false);
        }}
        onClose={() => setExtraNatPickerOpen(false)}
      />
    )}
    <main className="bv-page-bottom min-h-screen pt-[58px] pb-16 px-4" style={{ background: "var(--bg)" }}>
      <PortalTopNav />
      <div className="max-w-2xl mx-auto bv-enter-soft">

        {/* Admin editing banner */}
        {adminCandidateId && (
          <div className="mb-4 px-4 py-2.5 rounded-xl flex items-center gap-2 text-[12px] font-medium"
            style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)", color: "var(--gold)" }}>
            <FilePen size={13} strokeWidth={1.8} />
            {t.cvbAdminEditing}
          </div>
        )}

        {/* Header — refined hierarchy */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-3 mb-5">
            <button onClick={() => adminCandidateId ? router.push("/portal/admin") : router.push("/portal/dashboard")}
              className="bv-row-hover inline-flex items-center gap-1.5 text-[12px] font-medium px-2 py-1"
              style={{ color: "var(--w3)" }}>
              <ArrowLeft size={13} strokeWidth={1.8} /> {adminCandidateId ? t.cvbBackToAdmin : t.cvb_backToPortal}
            </button>
            <AutosaveIndicator savedAt={savedAt} error={saveError} />
          </div>
          <div className="text-center">
            <h1 className="font-semibold tracking-[-0.02em] leading-tight" style={{ color: "var(--w)" }}>
              <span className="block text-[18px] font-medium" style={{ color: "var(--w2)" }}>
                {lang === "de" ? "Lebenslauf erstellen mit" : lang === "en" ? "Build my CV with" : "Créer mon CV avec"}
              </span>
              <span className="block font-[family-name:var(--font-dm-serif)] italic font-normal text-[44px] leading-[1.05] mt-1">
                Borivon<span style={{ color: "var(--gold)" }} className="not-italic">.</span>
              </span>
            </h1>
          </div>
        </div>

        {/* ── 1. Photo ── */}
        <SectionCard id="photo-section" title={t.cvb_photoSection} kind="photo"
          forceOpen={validationErrors.has("photo")}>
          {/* Compact visual guide — premium line icons matching site style */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
              style={{ background: "var(--success-bg)" }}>
              <Briefcase size={15} strokeWidth={1.7} style={{ color: "var(--success)", flexShrink: 0 }} />
              <span className="text-[11.5px] font-semibold leading-tight" style={{ color: "var(--success)" }}>
                {lang === "de" ? "Professionell" : lang === "en" ? "Professional" : "Professionnelle"}
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
              style={{ background: "var(--danger-bg)" }}>
              <Smartphone size={15} strokeWidth={1.7} style={{ color: "var(--danger)", flexShrink: 0 }} />
              <span className="text-[11.5px] font-semibold leading-tight" style={{ color: "var(--danger)" }}>
                {lang === "de" ? "Keine Selfies" : lang === "en" ? "No selfies" : "Pas de selfies"}
              </span>
            </div>
          </div>
          <p className="text-[11px] mb-5 text-center" style={{ color: "var(--w3)" }}>
            JPG · PNG · max 5 MB
          </p>
          <input ref={photoRef} type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
          {/* One unified click target — placeholder + label inside one button */}
          <div className="flex flex-col items-center gap-3">
            <button onClick={() => photoRef.current?.click()}
              aria-label={cvData.photo ? t.cvb_changePhoto : t.cvb_choosePhoto}
              className="relative w-44 h-44 flex flex-col items-center justify-center gap-2.5 transition-all hover:-translate-y-0.5 hover:opacity-95"
              style={{ background: cvData.photo ? "transparent" : "var(--bg2)", border: validationErrors.has("photo") ? "2px solid var(--danger)" : "none", borderRadius: "9999px", cursor: "pointer", overflow: "hidden" }}>
              {cvData.photo ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cvData.photo} alt="Photo" className="absolute inset-0 w-full h-full object-cover"
                    style={{ borderRadius: "9999px" }} />
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 text-[10.5px] font-semibold tracking-tight whitespace-nowrap"
                    style={{ background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: "8px", backdropFilter: "blur(8px)" }}>
                    {t.cvb_changePhoto}
                  </span>
                </>
              ) : (
                <>
                  <User size={36} strokeWidth={1.3} style={{ color: "var(--w3)" }} />
                  <span className="text-[12px] font-medium" style={{ color: "var(--w2)" }}>
                    {t.cvb_choosePhoto}
                  </span>
                </>
              )}
            </button>
            {cvData.photo && (
              <button onClick={() => {
                  setCvData(d => ({ ...d, photo: null }));
                  // Mirror the removal to the server-side avatar + notify the
                  // ProfileIcon so the navbar avatar reverts to initials
                  // immediately, no page reload required.
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("bv-profile-photo-changed", { detail: { photo: null } }));
                  }
                  if (authToken) {
                    fetch("/api/portal/me/profile-photo", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
                      body: JSON.stringify({ photo: null }),
                    }).catch(err => console.warn("[cv-builder] photo clear failed:", err));
                  }
                }}
                className="text-[11.5px] font-medium transition-opacity hover:opacity-70" style={{ color: "var(--danger)", background: "transparent", border: "none" }}>
                {t.cvb_removePhoto}
              </button>
            )}
          </div>
        </SectionCard>

        {/* ── 2. Personal data ── */}
        <SectionCard
          id="personal-section"
          title={t.cvb_personalSection}
          kind="personal"
          forceOpen={["firstName","lastName","birthDate","birthPlace","nationality","email","address","postalCode","city","phone","maritalStatus"].some(k => validationErrors.has(k))}
        >
          {autoFillDone && (
            <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" }}>
              {t.cvb_autoFillDone}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <Label required>{t.cvb_firstName}</Label>
              <LockedField value={cvData.firstName} onLockedClick={showLocked} passportStatus={passportStatus} hasError={validationErrors.has("firstName")} onChange={isSuperAdmin && adminCandidateId ? v => set("firstName", v) : undefined} />
            </div>
            <div>
              <Label required>{t.cvb_lastName}</Label>
              <LockedField value={cvData.lastName} onLockedClick={showLocked} passportStatus={passportStatus} hasError={validationErrors.has("lastName")} onChange={isSuperAdmin && adminCandidateId ? v => set("lastName", v) : undefined} />
            </div>
            <div>
              <Label required>{t.cvb_birthDate}</Label>
              <LockedField value={cvData.birthDate} onLockedClick={showLocked} passportStatus={passportStatus} hasError={validationErrors.has("birthDate")} onChange={isSuperAdmin && adminCandidateId ? v => set("birthDate", v) : undefined} />
            </div>
            <div>
              <Label required>{t.cvb_birthPlace}</Label>
              <LockedField value={cvData.birthPlace} onLockedClick={showLocked} passportStatus={passportStatus} hasError={validationErrors.has("birthPlace")} onChange={isSuperAdmin && adminCandidateId ? v => set("birthPlace", v) : undefined} />
            </div>
            {/* Country of birth (left) | Nationality (right) */}
            <div>
              <Label>{lang === "de" ? "Geburtsland" : lang === "en" ? "Country of birth" : "Pays de naissance"}</Label>
              <LockedField
                value={isSuperAdmin && adminCandidateId ? (cvData.countryOfBirth || "") : (() => {
                  const found = Object.entries(COUNTRY_MAP).find(([,n]) => n.de === cvData.countryOfBirth);
                  return found ? (found[1][lang as "fr"|"en"|"de"] ?? found[1].de) : (cvData.countryOfBirth || "");
                })()}
                displayFlag={isSuperAdmin && adminCandidateId ? undefined : (() => {
                  const found = Object.entries(COUNTRY_MAP).find(([,n]) => n.de === cvData.countryOfBirth);
                  if (!found) return undefined;
                  const iso2 = ISO3_TO_ISO2[found[0]];
                  return iso2 ? { iso2 } : undefined;
                })()}
                onLockedClick={showLocked} passportStatus={passportStatus}
                onChange={isSuperAdmin && adminCandidateId ? v => set("countryOfBirth", v) : undefined}
              />
            </div>
            <div>
              <Label>{t.cvb_nationality}</Label>
              <LockedField
                value={isSuperAdmin && adminCandidateId ? (cvData.nationality || "") : (() => {
                  const found = Object.entries(COUNTRY_MAP).find(([,n]) => n.de === cvData.nationality);
                  return found ? (found[1][lang as "fr"|"en"|"de"] ?? found[1].de) : (cvData.nationality || "");
                })()}
                displayFlag={isSuperAdmin && adminCandidateId ? undefined : (() => {
                  const found = Object.entries(COUNTRY_MAP).find(([,n]) => n.de === cvData.nationality);
                  if (!found) return undefined;
                  const iso2 = ISO3_TO_ISO2[found[0]];
                  return iso2 ? { iso2 } : undefined;
                })()}
                onLockedClick={showLocked} passportStatus={passportStatus}
                hasError={validationErrors.has("nationality")}
                onChange={isSuperAdmin && adminCandidateId ? v => set("nationality", v) : undefined}
              />
            </div>
            {/* Additional nationalities — only available once the passport
                has been approved. Up to 4 extra (5 total with the primary). */}
            <div className="sm:col-span-2">
              {(cvData.additionalNationalities ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {(cvData.additionalNationalities ?? []).map((natDe, i) => {
                    const found = Object.entries(COUNTRY_MAP).find(([,n]) => n.de === natDe);
                    const label = found ? (found[1][lang as "fr"|"en"|"de"] ?? found[1].de) : natDe;
                    const iso2  = found ? ISO3_TO_ISO2[found[0]] : undefined;
                    return (
                      <span key={i} className="inline-flex items-center gap-2 text-[13px] px-3 py-2 rounded-full font-medium"
                        style={{ background: "var(--bg2)", color: "var(--w)" }}>
                        {iso2 && <CountryFlag iso={iso2} size={18} />}
                        {label}
                        <button
                          onClick={() => {
                            const next = (cvData.additionalNationalities ?? []).filter((_, idx) => idx !== i);
                            setCvData(d => ({ ...d, additionalNationalities: next }));
                          }}
                          aria-label={t.cvb_remove}
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full transition-opacity hover:opacity-70"
                          style={{ background: "transparent", border: "none", color: "var(--w3)", cursor: "pointer" }}>
                          <XIcon size={11} strokeWidth={2} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              {(() => {
                const totalNats = 1 + (cvData.additionalNationalities?.length ?? 0);
                const passportApproved = passportStatus === "approved";
                const atLimit = totalNats >= 5;
                const btnLabel = lang === "de" ? "Weitere Staatsangehörigkeit hinzufügen"
                              : lang === "en" ? "Add another nationality"
                              : "Ajouter une autre nationalité";
                return (
                  <button type="button"
                    onClick={() => {
                      // If the passport hasn't been approved yet, surface the
                      // same "Passport required" popup we use for locked fields
                      // — explains why this option isn't available right now.
                      if (!passportApproved) { showLocked(); return; }
                      if (atLimit) return;
                      setExtraNatPickerOpen(true);
                    }}
                    className="bv-row-hover inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-2"
                    style={{ color: "var(--w2)", opacity: passportApproved && !atLimit ? 1 : 0.7 }}>
                    <Plus size={13} strokeWidth={1.8} />
                    {btnLabel}
                  </button>
                );
              })()}
            </div>
            {/* Address (left) | Postal code (right) */}
            <div>
              <Label>{t.cvb_address}</Label>
              <LockedField value={cvData.address} onLockedClick={showLocked} passportStatus={passportStatus} hasError={validationErrors.has("address")} onChange={isSuperAdmin && adminCandidateId ? v => set("address", v) : undefined} />
            </div>
            <div>
              <Label>{t.cvb_postalCode}</Label>
              <LockedField value={cvData.postalCode} onLockedClick={showLocked} passportStatus={passportStatus} hasError={validationErrors.has("postalCode")} onChange={isSuperAdmin && adminCandidateId ? v => set("postalCode", v) : undefined} />
            </div>
            {/* City of residence (left) | Country of residence (right) */}
            <div>
              <Label>{lang === "de" ? "Wohnort" : lang === "en" ? "City of residence" : "Ville de résidence"}</Label>
              <LockedField value={cvData.city} onLockedClick={showLocked} passportStatus={passportStatus} hasError={validationErrors.has("city")} onChange={isSuperAdmin && adminCandidateId ? v => set("city", v) : undefined} />
            </div>
            <div>
              <Label>{lang === "de" ? "Wohnsitzland" : lang === "en" ? "Country of residence" : "Pays de résidence"}</Label>
              <LockedField
                value={isSuperAdmin && adminCandidateId ? (cvData.countryOfResidence || "") : (() => {
                  const found = Object.entries(COUNTRY_MAP).find(([,n]) => n.de === cvData.countryOfResidence);
                  return found ? (found[1][lang as "fr"|"en"|"de"] ?? found[1].de) : (cvData.countryOfResidence || "");
                })()}
                displayFlag={isSuperAdmin && adminCandidateId ? undefined : (() => {
                  const found = Object.entries(COUNTRY_MAP).find(([,n]) => n.de === cvData.countryOfResidence);
                  if (!found) return undefined;
                  const iso2 = ISO3_TO_ISO2[found[0]];
                  return iso2 ? { iso2 } : undefined;
                })()}
                onLockedClick={showLocked} passportStatus={passportStatus}
                onChange={isSuperAdmin && adminCandidateId ? v => set("countryOfResidence", v) : undefined}
              />
            </div>
            {/* Phone (left) | Email (right) */}
            <div>
              <Label>{t.cvb_phone}</Label>
              <PhoneInput value={cvData.phone} onChange={v => set("phone", v)} hasError={validationErrors.has("phone")} />
            </div>
            <div>
              <Label>E-Mail</Label>
              <Input value={cvData.email} onChange={v => set("email", v)} type="email" hasError={validationErrors.has("email")} />
            </div>
            <div className="sm:col-span-2">
              <Label required>{lang === "de" ? "Familienstand" : lang === "en" ? "Marital status" : "État civil"}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1" style={validationErrors.has("maritalStatus") ? { outline: "1px solid var(--danger)", outlineOffset: "3px", borderRadius: "14px" } : {}}>
                {(["ledig","verheiratet","geschieden","verwitwet"] as const).map(opt => {
                  const { base } = parseMaritalStatus(cvData.maritalStatus);
                  const active = base === opt;
                  const optLabel =
                    lang === "de" ? opt :
                    lang === "en" ? (opt === "ledig" ? "Single" : opt === "verheiratet" ? "Married" : opt === "geschieden" ? "Divorced" : "Widowed") :
                                    (opt === "ledig" ? "Célibataire" : opt === "verheiratet" ? "Marié(e)" : opt === "geschieden" ? "Divorcé(e)" : "Veuf/Veuve");
                  return (
                    <button key={opt} type="button"
                      onClick={() => {
                        // ledig clears any kids info. Other statuses keep
                        // existing ages so re-selecting (e.g. fixing a typo)
                        // doesn't wipe data the user already entered.
                        if (opt === "ledig") {
                          set("maritalStatus", "ledig");
                          setKidsAnswer("");
                        } else {
                          const { ages } = parseMaritalStatus(cvData.maritalStatus);
                          set("maritalStatus", composeMaritalStatus(opt, ages));
                          // Don't auto-answer — let the user explicitly say yes/no.
                          if (ages.length === 0) setKidsAnswer("");
                        }
                      }}
                      className="rounded-xl py-2.5 text-sm font-medium transition-all"
                      style={{
                        background: active ? "var(--gdim)" : "var(--bg2)",
                        color: active ? "var(--gold)" : "var(--w2)",
                        border: "none",
                      }}>
                      {optLabel}
                    </button>
                  );
                })}
              </div>

              {/* Kids follow-up — only when status is non-ledig & non-empty */}
              {(() => {
                const { base, ages } = parseMaritalStatus(cvData.maritalStatus);
                if (!base || base === "ledig") return null;

                const labelHaveKids = lang === "fr" ? "Avez-vous des enfants ?" : lang === "de" ? "Haben Sie Kinder?" : "Do you have children?";
                const labelYes      = lang === "fr" ? "Oui"  : lang === "de" ? "Ja"   : "Yes";
                const labelNo       = lang === "fr" ? "Non"  : lang === "de" ? "Nein" : "No";
                const labelAddChild = lang === "fr" ? "Ajouter un enfant" : lang === "de" ? "Kind hinzufügen" : "Add a child";
                const labelAge      = (n: number) => lang === "fr" ? `Âge enfant ${n}` : lang === "de" ? `Alter Kind ${n}` : `Age of child ${n}`;
                const labelRemove   = lang === "fr" ? "Retirer" : lang === "de" ? "Entfernen" : "Remove";

                const labelAgePh = lang === "fr" ? "Quel âge a votre enfant ?" : lang === "de" ? "Wie alt ist Ihr Kind?" : "How old is your child?";
                return (
                  <div className="mt-4">
                    <p className="text-[12px] font-normal mb-2.5" style={{ color: "var(--w3)" }}>
                      {labelHaveKids}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button type="button"
                        onClick={() => {
                          setKidsAnswer("yes");
                          // Seed with one empty slot so the user immediately
                          // sees the age input. Using -1 as "unset" sentinel
                          // so the input renders empty (placeholder shows).
                          if (ages.length === 0) {
                            set("maritalStatus", composeMaritalStatus(base, [-1]));
                          }
                        }}
                        className="rounded-xl py-3.5 text-[14px] font-medium transition-all"
                        style={{
                          background: kidsAnswer === "yes" ? "var(--gdim)" : "var(--bg2)",
                          color: kidsAnswer === "yes" ? "var(--gold)" : "var(--w2)",
                          border: "none",
                        }}>
                        {labelYes}
                      </button>
                      <button type="button"
                        onClick={() => {
                          setKidsAnswer("no");
                          set("maritalStatus", composeMaritalStatus(base, []));
                        }}
                        className="rounded-xl py-3.5 text-[14px] font-medium transition-all"
                        style={{
                          background: kidsAnswer === "no" ? "var(--gdim)" : "var(--bg2)",
                          color: kidsAnswer === "no" ? "var(--gold)" : "var(--w2)",
                          border: "none",
                        }}>
                        {labelNo}
                      </button>
                    </div>

                    {kidsAnswer === "yes" && (() => {
                      // Always render at least one age input when "Yes" is selected.
                      // Default is 0 — stays visible until the user overwrites it.
                      const displayAges = ages.length > 0 ? ages : [0];
                      return (
                      <div className="mt-5 space-y-4">
                        <p className="text-[12px] font-normal" style={{ color: "var(--w3)" }}>
                          {labelAgePh}
                        </p>
                        {displayAges.map((age, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <div className="flex-1">
                              <Input
                                value={age >= 0 ? String(age) : "0"}
                                onChange={v => {
                                  const next = [...displayAges];
                                  // Empty input → keep 0 visible (don't disappear).
                                  next[idx] = v === "" ? 0 : parseInt(v, 10);
                                  const clean = next.filter(a => Number.isFinite(a) && a >= 0);
                                  set("maritalStatus", composeMaritalStatus(base, clean));
                                }}
                                numericOnly
                              />
                            </div>
                            {displayAges.length > 1 && (
                              <button type="button"
                                onClick={() => {
                                  const next = displayAges.filter((_, i) => i !== idx);
                                  const clean = next.filter(a => Number.isFinite(a) && a >= 0);
                                  set("maritalStatus", composeMaritalStatus(base, clean));
                                }}
                                aria-label={labelRemove}
                                className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0"
                                style={{ color: "var(--w3)" }}>
                                <XIcon size={14} strokeWidth={1.8} />
                              </button>
                            )}
                          </div>
                        ))}
                        <button type="button"
                          onClick={() => set("maritalStatus", composeMaritalStatus(base, [...ages, 0]))}
                          className="bv-row-hover inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-2"
                          style={{ color: "var(--w2)" }}>
                          <Plus size={13} strokeWidth={1.8} /> {labelAddChild}
                        </button>
                      </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          </div>
        </SectionCard>

        {/* ── 3. Education ── */}
        <SectionCard id="education-section" title={t.cvb_eduSection} kind="education"
          forceOpen={[...validationErrors].some(k => k.startsWith("edu_"))}>
          {cvData.eduEntries.map((entry, idx) => {
            const isFixed = entry.id === "edu-abitur" || entry.id === "edu-nursing";
            return (
              <div key={entry.id} className={`${idx > 0 ? "pt-7 mt-7 border-t" : ""}`}
                style={{ borderColor: idx > 0 ? "rgba(255,255,255,0.05)" : "transparent" }}>
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[16px] font-semibold flex items-center gap-2 tracking-tight" style={{ color: "var(--w)" }}>
                    {entry.type === "abitur"  && <><SectionIcon kind="abitur"      size={17} style={{ color: "var(--gold)" }} /> {t.cvb_eduAbitur}</>}
                    {entry.type === "nursing" && <><SectionIcon kind="nursing-edu" size={17} style={{ color: "var(--gold)" }} /> {t.cvb_eduNursing}</>}
                    {entry.type === "other"   && <><SectionIcon kind="other-edu"   size={17} style={{ color: "var(--gold)" }} /> {t.cvb_eduOther}</>}
                    {entry.type === "abitur" && (
                      <button type="button" onClick={() => setAbiturInfoOpen(true)}
                        aria-label="Info"
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full transition-opacity hover:opacity-80"
                        style={{ background: "var(--info-bg)", color: "var(--info)", border: "none", cursor: "pointer" }}>
                        <Info size={11} strokeWidth={2.2} />
                      </button>
                    )}
                  </span>
                  {!isFixed && <RemoveBtn onClick={() => removeEdu(entry.id)} label={t.cvb_remove} />}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {entry.type === "nursing" && (
                    <NursingStatusField entry={entry} updateEdu={updateEdu}
                      diplomaHasError={validationErrors.has(`edu_${entry.id}_diplomaIssued`)} />
                  )}
                  <div className="sm:col-span-2">
                    <Label required>{t.cvb_degreeLabel}</Label>
                    {entry.type === "abitur" ? (
                      // Abitur is the German term used on the actual CV (PDF stays
                      // in German). Display is localized so the candidate
                      // recognizes it in their UI language, but it's read-only —
                      // ensures the saved value is always "Abitur".
                      <div
                        className="w-full flex items-center px-4 py-3.5 text-[15px] font-medium"
                        style={{ background: "var(--bg2)", border: "none", color: "var(--w)", borderRadius: "12px", cursor: "default" }}>
                        <span className="flex-1">
                          {lang === "de" ? "Abitur" : lang === "en" ? "Baccalaureate" : "Baccalauréat"}
                        </span>
                        <Lock size={13} strokeWidth={1.8} style={{ color: "var(--w3)", flexShrink: 0 }} />
                      </div>
                    ) : entry.type === "nursing" ? (
                      // Nursing diploma name is also fixed — saved value is always
                      // "Abschluss in der Krankenpflege" so the German CV reads
                      // consistently across all candidates.
                      <div
                        className="w-full flex items-center px-4 py-3.5 text-[15px] font-medium"
                        style={{ background: "var(--bg2)", border: "none", color: "var(--w)", borderRadius: "12px", cursor: "default" }}>
                        <span className="flex-1">
                          {lang === "de"
                            ? "Abschluss in der Krankenpflege"
                            : lang === "en"
                              ? "Diploma in Nursing"
                              : "Diplôme en soins infirmiers"}
                        </span>
                        <Lock size={13} strokeWidth={1.8} style={{ color: "var(--w3)", flexShrink: 0 }} />
                      </div>
                    ) : (
                      <Input
                        value={entry.degree}
                        onChange={v => updateEdu(entry.id, { degree: v })}
                        placeholder={
                          entry.type === "other"
                            ? (lang === "de"
                                ? "z. B. Studium der Lebenswissenschaften..."
                                : lang === "en"
                                  ? "e.g. Bachelor in Life Sciences..."
                                  : "ex. Licence en sciences de la vie...")
                            : ""
                        }
                      />
                    )}
                  </div>
                  {entry.type === "abitur" && (
                    <div className="sm:col-span-2">
                      <AbiturFocusField entry={entry} updateEdu={updateEdu} />
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <Label required>{t.cvb_institution}</Label>
                    <Input value={entry.institution} onChange={v => updateEdu(entry.id, { institution: v })}
                      hasError={validationErrors.has(`edu_${entry.id}_institution`)}
                      placeholder={
                        entry.type === "abitur"
                          ? (lang === "de" ? "Gymnasium ABC..." : lang === "en" ? "High school ABC..." : "Lycée ABC...")
                          : entry.type === "nursing"
                            ? (lang === "de" ? "Pflegeschule ABC..." : lang === "en" ? "Nursing school ABC..." : "École d'infirmiers ABC...")
                            : (lang === "de" ? "Schule / Universität..." : lang === "en" ? "School / university..." : "École / université...")
                      }
                    />
                  </div>
                  <div>
                    <Label required>{t.cvb_city}</Label>
                    <Input value={entry.location} onChange={v => updateEdu(entry.id, { location: v })} lettersOnly hasError={validationErrors.has(`edu_${entry.id}_location`)} />
                  </div>
                  {/* Country picker — sits next to City in the same row on desktop. */}
                  <div>
                    <Label>{lang === "de" ? "Land" : lang === "en" ? "Country" : "Pays"}</Label>
                    <NationalityPicker
                      value={entry.country ?? "Marokko"}
                      onChange={v => updateEdu(entry.id, { country: v })}
                      titleOverride={{ de: "Land", en: "Country", fr: "Pays" }}
                    />
                  </div>
                  <MonthYearPicker
                    label={entry.type === "nursing"
                      ? (lang === "de" ? "Beginn Pflegeausbildung" : lang === "en" ? "Start nursing training" : "Début formation infirmière")
                      : t.cvb_begin}
                    value={entry.start}
                    hasError={validationErrors.has(`edu_${entry.id}_start`)}
                    onChange={v => {
                      if (entry.type === "nursing") {
                        // Suggest sensible defaults when the user picks a year
                        // for the first time (start ≈ September, end ≈ June +3y),
                        // but do NOT overwrite anything the user has already set.
                        const yearJustFilled = !entry.start.year && !!v.year;
                        const newStart: MonthYear = yearJustFilled && !v.month
                          ? { month: "09", year: v.year }
                          : v;
                        const endYearMissing = !entry.end || !entry.end.year;
                        const newEnd: MonthYear | null = yearJustFilled && endYearMissing
                          ? { month: "06", year: String(parseInt(v.year) + 3) }
                          : entry.end ?? { month: "", year: "" };
                        updateEdu(entry.id, { start: newStart, end: newEnd });
                      } else {
                        updateEdu(entry.id, { start: v });
                      }
                    }}
                    lang={lang}
                    required
                  />
                  <MonthYearPicker
                    label={entry.type === "nursing"
                      ? (lang === "de" ? "Ende Pflegeausbildung" : lang === "en" ? "End nursing training" : "Fin formation infirmière")
                      : t.cvb_end}
                    value={entry.end ?? { month: "", year: "" }}
                    hasError={validationErrors.has(`edu_${entry.id}_end`)}
                    onChange={v => updateEdu(entry.id, { end: v })}
                    // "Currently" checkbox only makes sense while training is in
                    // progress (year1–year3). Once status is "complete" the
                    // diploma was obtained on a real date, so force a real
                    // Month/Year picker (no Currently option).
                    allowNull={entry.type === "nursing" && entry.nursingStatus !== "complete"}
                    isPresent={entry.type === "nursing" && entry.nursingStatus !== "complete" && !entry.end}
                    onPresentToggle={() => { if (entry.type !== "nursing" || entry.nursingStatus === "complete") return; updateEdu(entry.id, { end: entry.end ? null : { month: "", year: "" } }); }}
                    lang={lang}
                    required
                  />
                </div>
              </div>
            );
          })}
          <AddButton onClick={addEdu} label={t.cvb_addEdu} />
        </SectionCard>

        {/* ── 4. Work ── */}
        <SectionCard id="work-section" title={t.cvb_workSection} kind="work"
          forceOpen={[...validationErrors].some(k => k.startsWith("work_"))}>
          {cvData.workEntries.map((entry, idx) => {
            const jobNum = idx + 1 - cvData.workEntries.slice(0, idx).filter(e => e.isGap).length;
            return (
              <div key={entry.id} className={`${idx > 0 ? "pt-7 mt-7" : ""} ${idx > 0 ? "border-t" : ""}`}
                style={{ borderColor: idx > 0 ? "rgba(255,255,255,0.05)" : "transparent" }}>
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[16px] font-semibold tracking-tight inline-flex items-center gap-2" style={{ color: entry.isGap ? "var(--danger)" : "var(--w)" }}>
                    {entry.isGap
                      ? `⏸ ${t.cvb_gapPeriod}`
                      : idx === 0
                        ? (lang === "de" ? "Praktikum (Pflegeausbildung)" : lang === "en" ? "Internship (during nursing training)" : "Stage (pendant la formation infirmière)")
                        : `${t.cvb_position} ${jobNum}`}
                    {idx === 0 && !entry.isGap && (
                      <button type="button" onClick={() => setInternshipInfoOpen(true)}
                        aria-label="Info"
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full transition-opacity hover:opacity-80"
                        style={{ background: "var(--info-bg)", color: "var(--info)", border: "none", cursor: "pointer" }}>
                        <Info size={11} strokeWidth={2.2} />
                      </button>
                    )}
                  </span>
                  {/* First position (the nursing internship) is mandatory and cannot be removed.
                      All other entries — additional jobs and gap periods — keep the remove option. */}
                  {(idx > 0 || entry.isGap) && (
                    <RemoveBtn onClick={() => removeWork(entry.id)} label={t.cvb_remove} />
                  )}
                </div>

                {entry.isGap ? (
                  <div className="grid grid-cols-2 gap-5">
                    <MonthYearPicker label={t.cvb_startDate} value={entry.start} onChange={v => updateWork(entry.id, { start: v })} lang={lang} required />
                    <MonthYearPicker label={t.cvb_endDate} value={entry.end ?? { month: "", year: "" }}
                      onChange={v => updateWork(entry.id, { end: v })} allowNull isPresent={!entry.end}
                      onPresentToggle={() => updateWork(entry.id, { end: entry.end ? null : { month: "", year: "" } })} lang={lang} required />
                    <div className="sm:col-span-2">
                      <Label>{t.cvb_gapReasonLabel}</Label>
                      <Input value={entry.gapReason} onChange={v => updateWork(entry.id, { gapReason: v })} placeholder={t.cvb_gapReasonPh} />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="sm:col-span-2">
                      <Label required={idx === 0}>{t.cvb_jobTitle}</Label>
                      {idx === 0 ? (
                        // Position 1 is the mandatory nursing internship — title
                        // is fixed in German (gendered: -in for women, -ant for
                        // men). Pulled from passport data, locked from edits.
                        <div
                          className="w-full flex items-center px-4 py-3.5 text-[15px] font-medium"
                          style={{ background: "var(--bg2)", border: "none", color: "var(--w)", borderRadius: "12px", cursor: "default",
                            ...(validationErrors.has(`work_${entry.id}_title`) ? { outline: "1px solid var(--danger)", outlineOffset: "2px" } : {}) }}>
                          <span className="flex-1">
                            {entry.title || (sex === "F" ? "Pflegepraktikantin" : "Pflegepraktikant")}
                          </span>
                          <Lock size={13} strokeWidth={1.8} style={{ color: "var(--w3)", flexShrink: 0 }} />
                        </div>
                      ) : (
                        <Input value={entry.title} onChange={v => updateWork(entry.id, { title: v })} />
                      )}
                    </div>
                    {/* Establishment full width */}
                    <div className="sm:col-span-2">
                      <Label>{t.cvb_employer}</Label>
                      <Input value={entry.employer} onChange={v => updateWork(entry.id, { employer: v })} hasError={validationErrors.has(`work_${entry.id}_employer`)} />
                    </div>
                    {/* City (left) | Country (right) */}
                    <div>
                      <Label>{t.cvb_location}</Label>
                      <Input value={entry.location} onChange={v => updateWork(entry.id, { location: v })} lettersOnly hasError={validationErrors.has(`work_${entry.id}_location`)} />
                    </div>
                    <div>
                      <Label>{lang === "de" ? "Land" : lang === "en" ? "Country" : "Pays"}</Label>
                      <NationalityPicker
                        value={entry.country ?? "Marokko"}
                        onChange={v => updateWork(entry.id, { country: v })}
                        titleOverride={{ de: "Land", en: "Country", fr: "Pays" }}
                      />
                    </div>

                    {/* Additional internship sites — only for the mandatory
                        Position-1 nursing internship. Each has its own
                        establishment + city + country (defaults to the first
                        site's city/country, but the nurse can change them). */}
                    {idx === 0 && (entry.additionalSites?.length ?? 0) > 0 && (
                      <>
                        {(entry.additionalSites ?? []).map((site, sIdx) => (
                          <React.Fragment key={sIdx}>
                            <div className="sm:col-span-2">
                              <Label>{t.cvb_employer}</Label>
                              <Input value={site.employer}
                                onChange={v => {
                                  const next = [...(entry.additionalSites ?? [])];
                                  next[sIdx] = { ...next[sIdx], employer: v };
                                  updateWork(entry.id, { additionalSites: next });
                                }} />
                            </div>
                            <div>
                              <Label>{t.cvb_location}</Label>
                              <Input value={site.location} lettersOnly
                                onChange={v => {
                                  const next = [...(entry.additionalSites ?? [])];
                                  next[sIdx] = { ...next[sIdx], location: v };
                                  updateWork(entry.id, { additionalSites: next });
                                }} />
                            </div>
                            <div>
                              <Label>{lang === "de" ? "Land" : lang === "en" ? "Country" : "Pays"}</Label>
                              <NationalityPicker
                                value={site.country ?? "Marokko"}
                                onChange={v => {
                                  const next = [...(entry.additionalSites ?? [])];
                                  next[sIdx] = { ...next[sIdx], country: v };
                                  updateWork(entry.id, { additionalSites: next });
                                }}
                                titleOverride={{ de: "Land", en: "Country", fr: "Pays" }}
                              />
                            </div>
                            <div className="sm:col-span-2 flex justify-end -mt-2">
                              <RemoveBtn
                                label={t.cvb_remove}
                                onClick={() => {
                                  const next = (entry.additionalSites ?? []).filter((_, i) => i !== sIdx);
                                  updateWork(entry.id, { additionalSites: next });
                                }}
                              />
                            </div>
                          </React.Fragment>
                        ))}
                      </>
                    )}
                    {idx === 0 && (
                      <div className="sm:col-span-2">
                        <button type="button"
                          onClick={() => {
                            const next = [...(entry.additionalSites ?? []), {
                              employer: "",
                              location: entry.location,            // default to first site's city
                              country:  entry.country ?? "Marokko", // default to first site's country
                            }];
                            updateWork(entry.id, { additionalSites: next });
                          }}
                          className="bv-row-hover inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-2"
                          style={{ color: "var(--w2)" }}>
                          <Plus size={13} strokeWidth={1.8} />
                          {lang === "de" ? "Weiteres Krankenhaus" : lang === "en" ? "Add another hospital" : "Ajouter un autre hôpital"}
                        </button>
                      </div>
                    )}
                    <MonthYearPicker label={`${t.cvb_startDate} *`} value={entry.start} onChange={v => updateWork(entry.id, { start: v })} lang={lang} required hasError={validationErrors.has(`work_${entry.id}_start`)} />
                    <MonthYearPicker label={t.cvb_endDate} value={entry.end ?? { month: "", year: "" }}
                      onChange={v => updateWork(entry.id, { end: v })} allowNull isPresent={!entry.end}
                      onPresentToggle={() => updateWork(entry.id, { end: entry.end ? null : { month: "", year: "" } })} lang={lang} required hasError={validationErrors.has(`work_${entry.id}_end`)} />
                    <div className="sm:col-span-2">
                      <Label required={jobNum === 1}>{t.cvb_deptLabel}</Label>
                      <div className="flex flex-wrap gap-2 mt-2 rounded-xl p-1" style={validationErrors.has(`work_${entry.id}_departments`) ? { outline: "1px solid var(--danger)", outlineOffset: "2px" } : {}}>
                        {NURSING_DEPTS.map(dept => {
                          const selected = entry.departments.includes(dept.de);
                          return (
                            <button key={dept.de} onClick={() => toggleWorkDept(entry.id, dept.de)}
                              className="text-[13px] px-4 py-2 rounded-full transition-all"
                              style={{
                                background: selected ? "var(--gdim)" : "var(--bg2)",
                                border: "none",
                                color: selected ? "var(--gold)" : "var(--w2)",
                                fontWeight: selected ? 600 : 400,
                              }}>
                              {deptLabel(dept)}
                            </button>
                          );
                        })}
                        {/* Custom department chips — anything in entry.departments
                            that's not in the NURSING_DEPTS preset list. */}
                        {entry.departments
                          .filter(d => !NURSING_DEPTS.some(nd => nd.de === d))
                          .map((custom, i) => (
                            <span key={`cust-${i}`} className="inline-flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-full font-semibold"
                              style={{ background: "var(--gdim)", color: "var(--gold)" }}>
                              {custom}
                              <button onClick={() => updateWork(entry.id, { departments: entry.departments.filter(d => d !== custom) })}
                                aria-label={t.cvb_remove}
                                className="inline-flex items-center justify-center w-4 h-4 rounded-full transition-opacity hover:opacity-70"
                                style={{ background: "transparent", border: "none", color: "var(--gold)", cursor: "pointer" }}>
                                <XIcon size={10} strokeWidth={2} />
                              </button>
                            </span>
                          ))}
                        <OtherChipInput
                          label={lang === "de" ? "Andere…" : lang === "en" ? "Other…" : "Autre…"}
                          placeholder={lang === "de" ? "Abteilung…" : lang === "en" ? "Department…" : "Service…"}
                          onAdd={v => {
                            if (!entry.departments.includes(v)) {
                              updateWork(entry.id, { departments: [...entry.departments, v] });
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <AddButton onClick={addWork} label={t.cvb_addJob} />
        </SectionCard>

        {/* ── 5. Languages ── */}
        <SectionCard id="lang-section" title={t.cvb_langSection} kind="languages"
          forceOpen={[...validationErrors].some(k => k.startsWith("lang_"))}>
          <div className="space-y-3">
            {cvData.langs.map((l, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 overflow-hidden"
                  style={{
                    background: "var(--bg2)",
                    borderRadius: "16px",
                    paddingLeft: "4px",
                    paddingRight: "4px",
                  }}>
                  {i < 4 ? (
                    <span className="flex-1 min-w-0 px-4 py-4 text-[15px] font-medium truncate"
                      style={{ color: "var(--w)" }}>
                      {(() => {
                        const map: Record<string, { de: string; en: string; fr: string }> = {
                          Arabisch:    { de: "Arabisch",    en: "Arabic",  fr: "Arabe" },
                          Französisch: { de: "Französisch", en: "French",  fr: "Français" },
                          Deutsch:     { de: "Deutsch",     en: "German",  fr: "Allemand" },
                          Englisch:    { de: "Englisch",    en: "English", fr: "Anglais" },
                        };
                        return map[l.name]?.[lang as "fr"|"en"|"de"] ?? l.name;
                      })()}
                    </span>
                  ) : (
                    <input
                      type="text"
                      value={l.name}
                      onChange={e => { const ls = [...cvData.langs]; ls[i] = { ...ls[i], name: e.target.value.replace(/[0-9]/g, "") }; set("langs", ls); }}
                      placeholder={t.cvb_langLabel}
                      className="flex-1 min-w-0 px-4 py-4 text-[15px] font-medium outline-none"
                      style={{ background: "transparent", border: "none", color: "var(--w)" }}
                    />
                  )}
                  <LangLevelButton
                    level={l.level}
                    onChange={lv => { const ls = [...cvData.langs]; ls[i] = { ...ls[i], level: lv }; set("langs", ls); }}
                    hasError={validationErrors.has(`lang_${i}_level`)}
                  />
                </div>
                {/* Small inline "× Remove" link sits BELOW the row, matching the
                    treatment on Other education entries. */}
                {i >= 4 && (
                  <div className="flex justify-end mt-1.5">
                    <RemoveBtn onClick={() => { const ls = cvData.langs.filter((_, idx) => idx !== i); set("langs", ls); }} label={t.cvb_remove} />
                  </div>
                )}
              </div>
            ))}
            <AddButton onClick={() => set("langs", [...cvData.langs, { name: "", level: "" }])} label={t.cvb_addLang} />
          </div>
        </SectionCard>

        {/* ── 6. EDV ── */}
        <SectionCard id="skills-section" title={t.cvb_edvSection} kind="skills"
          forceOpen={validationErrors.has("edvSelected")}>
          <div className="flex flex-wrap gap-2 rounded-xl p-1" style={validationErrors.has("edvSelected") ? { outline: "1px solid var(--danger)", outlineOffset: "2px" } : {}}>
            {EDV_DEFAULTS.map(s => {
              const selected = cvData.edvSelected.includes(s.de);
              const label    = s[lang as "fr"|"en"|"de"] ?? s.de;
              return (
                <button key={s.de} onClick={() => toggleEdv(s.de)}
                  className="inline-flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-full transition-all"
                  style={{
                    background: selected ? "var(--gdim)" : "var(--bg2)",
                    border: "none",
                    color: selected ? "var(--gold)" : "var(--w2)",
                    fontWeight: selected ? 600 : 400,
                  }}>
                  {selected && <Check size={11} strokeWidth={2.2} />}{label}
                </button>
              );
            })}
            {cvData.edvCustomInputs.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-full font-semibold"
                style={{ background: "var(--gdim)", color: "var(--gold)" }}>
                {s}
                <button onClick={() => removeEdvCustom(i)} aria-label="Remove"
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full transition-opacity hover:opacity-70"
                  style={{ background: "transparent", border: "none", color: "var(--gold)", cursor: "pointer" }}>
                  <XIcon size={10} strokeWidth={2} />
                </button>
              </span>
            ))}
            <OtherChipInput
              label={lang === "de" ? "Andere…" : lang === "en" ? "Other…" : "Autre…"}
              placeholder={t.cvb_edvPh}
              onAdd={(v) => setCvData(d => ({ ...d, edvCustomInputs: [...d.edvCustomInputs, v] }))}
            />
          </div>
        </SectionCard>

        {/* ── 7. Sonstiges ── */}
        <SectionCard id="other-section" title={t.cvb_otherSection} kind="other"
          forceOpen={validationErrors.has("driverLicense") || validationErrors.has("hobbies")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <Label>
                <span className="inline-flex items-center gap-1.5">
                  {t.cvb_driverLicense}
                  <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: "var(--gdim)", color: "var(--gold)", lineHeight: 1 }}>
                    B
                  </span>
                </span>
              </Label>
              <div className="grid grid-cols-2 gap-3 rounded-xl" style={validationErrors.has("driverLicense") ? { outline: "1px solid var(--danger)", outlineOffset: "2px" } : {}}>
                <button type="button"
                  onClick={() => set("driverLicense", "B")}
                  className="flex flex-col items-center justify-center gap-2 py-4 rounded-xl transition-all"
                  style={{
                    background: cvData.driverLicense === "B" ? "var(--gdim)" : "var(--bg2)",
                    color: cvData.driverLicense === "B" ? "var(--gold)" : "var(--w2)",
                    border: "none",
                  }}>
                  <Car size={22} strokeWidth={1.6} />
                  <span className="text-[12.5px] font-medium">
                    {lang === "de" ? "Ja" : lang === "en" ? "Yes" : "Oui"}
                  </span>
                </button>
                <button type="button"
                  onClick={() => set("driverLicense", "")}
                  className="flex flex-col items-center justify-center gap-2 py-4 rounded-xl transition-all"
                  style={{
                    background: cvData.driverLicense === "" ? "var(--gdim)" : "var(--bg2)",
                    color: cvData.driverLicense === "" ? "var(--gold)" : "var(--w2)",
                    border: "none",
                  }}>
                  <XIcon size={22} strokeWidth={1.6} />
                  <span className="text-[12.5px] font-medium">{lang === "de" ? "Nein" : lang === "en" ? "No" : "Non"}</span>
                </button>
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label required>{t.cvb_hobbies}</Label>
              <div className="rounded-xl p-1" style={validationErrors.has("hobbies") ? { outline: "1px solid var(--danger)", outlineOffset: "2px" } : {}}>
                <HobbiesField value={cvData.hobbies} onChange={v => set("hobbies", v)} />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── Generate — sticky on mobile so the CTA is always reachable ── */}
        {!pdfUrl ? (
          <div className="text-center mt-2 bv-sticky-bottom">
            <button onClick={handleGenerate} disabled={generating}
              className="inline-flex items-center gap-2 px-8 py-4 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50 w-full sm:w-auto justify-center"
              style={{ background: "var(--gold)", color: "#131312", borderRadius: "16px", boxShadow: "var(--shadow-gold-lg)" }}>
              {generating ? (
                <><Spinner size="sm" color="#131312" /> {t.cvb_generating}</>
              ) : <><FileText size={15} strokeWidth={1.8} /> {t.cvb_generateBtn}</>}
            </button>
            {genError && (
              <div className="mt-3 rounded-xl px-4 py-3 text-left" style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-border)" }}>
                <p className="text-[12px] font-semibold flex items-center gap-1.5 mb-1.5" style={{ color: "var(--danger)" }}>
                  <AlertTriangle size={12} strokeWidth={1.8} /> {genError}
                </p>
                {validationErrors.size > 0 && (
                  <ul className="space-y-0.5 pl-1">
                    {getValidationErrorLabels(validationErrors, lang).map(lbl => (
                      <li key={lbl} className="text-[11.5px] flex items-center gap-1.5" style={{ color: "var(--danger)" }}>
                        <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: "var(--danger)" }} />{lbl}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="p-7 text-center"
            style={{ background: "var(--card)", border: "none", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <span className="mx-auto mb-3 flex items-center justify-center w-12 h-12 rounded-full"
              style={{ background: "var(--success-bg)", border: "none", color: "var(--success)" }}>
              <CheckCircle2 size={22} strokeWidth={1.6} />
            </span>
            <p className="text-[16px] font-semibold tracking-[-0.01em] mb-1.5" style={{ color: "var(--w)" }}>{t.cvb_successTitle}</p>
            <p className="text-[12.5px] mb-6" style={{ color: "var(--w3)" }}>{t.cvb_successSub}</p>

            {uploaded ? (
              <span className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold tracking-tight"
                style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: "var(--r-md)" }}>
                <CheckCircle2 size={14} strokeWidth={1.8} /> {t.cvb_sent}
              </span>
            ) : (
              <div className="flex flex-col items-center gap-3">
                {/* Keep Editing — big primary */}
                <button onClick={() => { setPdfUrl(null); setPdfBlob(null); setUploaded(false); }}
                  className="inline-flex items-center gap-2 px-8 py-4 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] w-full sm:w-auto justify-center"
                  style={{ background: "var(--gold)", color: "#131312", borderRadius: "16px", boxShadow: "var(--shadow-gold-lg)" }}>
                  <FilePen size={15} strokeWidth={1.8} /> {t.cvb_keepEditing}
                </button>
                <div className="flex gap-2.5 justify-center flex-wrap mt-1">
                  {/* Preview */}
                  <button onClick={() => setShowCvPreview(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold tracking-tight transition-opacity hover:opacity-90"
                    style={{ background: "var(--card2)", color: "var(--w)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                    <FileText size={14} strokeWidth={1.8} /> {t.cvb_preview}
                  </button>
                  {/* Submit */}
                  <button onClick={() => setShowSubmitConfirm(true)} disabled={uploading}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold tracking-tight transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: "var(--r-md)" }}>
                    <Upload size={14} strokeWidth={1.8} /> {uploading ? t.cvb_sending : t.cvb_submitCV}
                  </button>
                </div>
              </div>
            )}
            {uploadErr && <p className="mt-3 text-[12.5px] inline-flex items-center gap-1.5 justify-center" style={{ color: "var(--danger)" }}><AlertTriangle size={12} strokeWidth={1.8} /> {uploadErr}</p>}
          </div>
        )}

      </div>

      {/* ── Gap panel — inline below generate button ── */}
      {showGapPanel && smartGaps.length > 0 && (
        <div id="gap-panel" className="p-5 mt-4"
          style={{ background: "var(--card)", border: "1px solid var(--danger-border)", borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-sm)" }}>
          {/* Header */}
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-full"
              style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
              <Ban size={15} strokeWidth={1.7} />
            </span>
            <h3 className="text-[14px] font-semibold tracking-[-0.01em]" style={{ color: "var(--danger)" }}>
              {lang === "fr" ? "Périodes non justifiées détectées" : lang === "de" ? "Lücken im Lebenslauf gefunden" : "Timeline gaps found"}
            </h3>
          </div>
          <p className="text-[12.5px] mb-5 leading-relaxed pl-[42px]" style={{ color: "var(--w3)" }}>
            {lang === "fr"
              ? "Le CV ne peut pas être généré avec des périodes vides. Ajoute une entrée dans « Expérience professionnelle » pour chacune des périodes ci-dessous."
              : lang === "de"
              ? 'Der Lebenslauf kann nicht generiert werden, solange es ungeklärte Zeiträume gibt. Füge für jede Lücke unten einen Eintrag unter Berufserfahrung hinzu.'
              : "The CV cannot be generated with uncovered periods. Add a work entry for each gap below."}
          </p>

          {/* Example chips */}
          <div className="mb-5">
            <p className="text-[10.5px] uppercase tracking-[0.12em] font-semibold mb-2.5" style={{ color: "var(--w3)" }}>
              {lang === "fr" ? "Exemples de titres à utiliser" : lang === "de" ? "Beispiel-Einträge" : "Example entries"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(lang === "fr" ? [
                "Apprentissage de l'allemand",
                "Cours de langue B2 / C1",
                "Recherche d'emploi en Allemagne",
                "Travail à temps partiel",
                "Stage en soins infirmiers",
                "Phase de candidature",
                "Garde familiale",
              ] : lang === "de" ? [
                "Deutsch lernen",
                "Sprachkurs B2 / C1",
                "Jobsuche in Deutschland",
                "Teilzeitarbeit",
                "Pflegepraktikum",
                "Bewerbungsphase",
                "Familienbetreuung",
              ] : [
                "Learning German",
                "Language course B2 / C1",
                "Job search in Germany",
                "Part-time work",
                "Nursing internship",
                "Application phase",
                "Family care",
              ]).map(ex => (
                <span key={ex}
                  className="text-[12px] px-3 py-1.5 rounded-full font-medium"
                  style={{ background: "var(--bg2)", color: "var(--w2)", border: "none" }}>
                  &bdquo;{ex}&ldquo;
                </span>
              ))}
            </div>
          </div>

          {/* Gap periods */}
          <div className="space-y-2 mb-5">
            {smartGaps.map((g, i) => (
              <div key={i}
                className="flex items-center justify-between gap-3 p-4"
                style={{ background: "var(--danger-bg)", border: "none", borderRadius: "14px" }}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--danger)" }} />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold tracking-tight" style={{ color: "var(--danger)" }}>
                      {fmtMY(g.gapStart)} → {(() => {
                        const today = todayMY();
                        const isToday = g.gapEnd.year === today.year && g.gapEnd.month === today.month;
                        if (isToday) return lang === "fr" ? "aujourd'hui" : lang === "de" ? "heute" : "today";
                        return fmtMY(g.gapEnd);
                      })()}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>
                      {g.monthCount}{" "}
                      {lang === "fr" ? (g.monthCount > 1 ? "mois" : "mois") : lang === "de" ? (g.monthCount === 1 ? "Monat" : "Monate") : (g.monthCount === 1 ? "month" : "months")}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => quickAddForGap(g)}
                  className="bv-row-hover inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 font-semibold flex-shrink-0"
                  style={{ color: "var(--w2)" }}>
                  <Plus size={11} strokeWidth={1.8} /> {lang === "fr" ? "Ajouter" : lang === "de" ? "Hinzufügen" : "Add entry"}
                </button>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={() => {
              setShowGapPanel(false);
              setTimeout(() => document.getElementById("work-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: "var(--info-bg)", color: "var(--info)" }}>
            <FilePen size={14} strokeWidth={1.8} /> {lang === "fr" ? "Aller compléter l'expérience" : lang === "de" ? "Berufserfahrung ergänzen" : "Go fill in experience"}
          </button>
        </div>
      )}
    </main>

    {/* ── CV PDF Preview modal ── */}
    {showCvPreview && pdfUrl && typeof document !== "undefined" && createPortal(
      <div className="fixed inset-x-0 z-[800] flex items-center justify-center px-2 bv-cvprev-outer"
        style={{ background: "rgba(0,0,0,0.72)", top: "calc(58px + var(--bv-subnav-h, 0px))", paddingTop: "6px", bottom: 0 }}
        onClick={() => setShowCvPreview(false)}>
        <style>{`
          .bv-cvprev-card {
            height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 6px - env(safe-area-inset-bottom, 0px));
            max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 6px - env(safe-area-inset-bottom, 0px));
          }
          @media (max-width: 639.98px) {
            .bv-cvprev-outer { padding-bottom: calc(72px + 6px + env(safe-area-inset-bottom, 0px)) !important; }
            .bv-cvprev-card  {
              height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 72px - 6px - env(safe-area-inset-bottom, 0px)) !important;
              max-height: calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 6px - 72px - 6px - env(safe-area-inset-bottom, 0px)) !important;
            }
          }
        `}</style>
        <div className="bv-cvprev-card w-full max-w-3xl flex flex-col overflow-hidden"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-2xl)",
            boxShadow: "var(--shadow-lg)",
            animation: "bvFadeRise 0.22s var(--ease-out)",
          }}
          onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
            style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-[13.5px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
              {t.cvb_preview}
            </p>
            <div className="flex items-center gap-2">
              <a href={pdfUrl}
                download={`lebenslauf_${[cvData.firstName, cvData.lastName].filter(Boolean).join("_").toLowerCase() || "cv"}.pdf`}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
                style={{ color: "var(--w2)" }}
                title="Download">
                <Download size={14} strokeWidth={1.8} />
              </a>
              <button onClick={() => setShowCvPreview(false)}
                className="bv-icon-btn w-8 h-8 rounded-full flex items-center justify-center"
                style={{ color: "var(--w2)" }}>
                <XIcon size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>
          {/* PDF viewer */}
          <div className="flex-1 min-h-0">
            <PdfViewer src={pdfUrl} />
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* ── Submit confirmation modal ── */}
    {showSubmitConfirm && typeof document !== "undefined" && createPortal(
      <div className="fixed inset-0 z-[800] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.72)" }}
        onClick={() => setShowSubmitConfirm(false)}>
        <div className="w-full max-w-md p-7 flex flex-col items-center text-center"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-2xl)",
            boxShadow: "var(--shadow-lg)",
            animation: "bvFadeRise 0.22s var(--ease-out)",
          }}
          onClick={e => e.stopPropagation()}>
          <span className="mb-4 flex items-center justify-center w-12 h-12 rounded-full"
            style={{ background: "rgba(224,176,0,0.12)", color: "var(--gold)" }}>
            <AlertTriangle size={22} strokeWidth={1.6} />
          </span>
          <p className="text-[16px] font-semibold tracking-[-0.01em] mb-2" style={{ color: "var(--w)" }}>
            {t.cvb_confirmTitle}
          </p>
          <p className="text-[13px] leading-relaxed mb-7" style={{ color: "var(--w3)" }}>
            {t.cvb_confirmMsg}
          </p>
          {/* Keep Editing — big */}
          <button onClick={() => setShowSubmitConfirm(false)}
            className="inline-flex items-center gap-2 px-8 py-4 text-[14px] font-semibold tracking-tight transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] w-full justify-center mb-3"
            style={{ background: "var(--gold)", color: "#131312", borderRadius: "16px", boxShadow: "var(--shadow-gold-lg)" }}>
            <FilePen size={15} strokeWidth={1.8} /> {t.cvb_keepEditing}
          </button>
          {/* Submit — smaller */}
          <button onClick={async () => {
            setShowSubmitConfirm(false);
            await handleUpload();
          }} disabled={uploading}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold tracking-tight transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: "var(--r-md)" }}>
            <Upload size={14} strokeWidth={1.8} /> {uploading ? t.cvb_sending : t.cvb_submitCV}
          </button>
        </div>
      </div>,
      document.body
    )}

    {/* ── Starter upgrade modal ── */}
    {starterUpgradeOpen && (
      <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)" }}
        onClick={() => setStarterUpgradeOpen(false)}>
        <div className="relative w-full max-w-sm rounded-2xl p-7 flex flex-col items-center text-center"
          style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
          onClick={e => e.stopPropagation()}>

          <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4 text-2xl"
            style={{ background: "var(--gdim)" }}>📄</div>

          <h2 className="text-[18px] font-bold mb-2" style={{ color: "var(--w)" }}>
            {lang === "de" ? "Starter-Plan erforderlich" : lang === "en" ? "Starter Plan Required" : "Plan Starter requis"}
          </h2>
          <p className="text-[13px] mb-5 leading-relaxed" style={{ color: "var(--w3)" }}>
            {lang === "de" ? "Die professionelle Lebenslauf-Erstellung ist im Starter-Plan enthalten."
              : lang === "en" ? "Professional CV generation is included in the Starter plan."
              : "La génération professionnelle de CV est incluse dans le plan Starter."}
          </p>

          <div className="mx-auto w-full rounded-2xl px-4 py-3 mb-5 flex items-center gap-3"
            style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
            <span className="text-[13px] font-semibold flex-1" style={{ color: "var(--gold)" }}>★ Starter-Plan</span>
            <span className="text-[20px] font-bold tracking-tight" style={{ color: "var(--w)" }}>€9</span>
            <span className="text-[11px]" style={{ color: "var(--w3)" }}>
              {lang === "de" ? "einmalig" : lang === "en" ? "one-time" : "paiement unique"}
            </span>
          </div>

          <style>{`@keyframes bvWave{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}`}</style>
          <ul className="w-full text-left space-y-2 mb-5">
            {([
              lang === "de" ? "Professioneller Lebenslauf (PDF)" : lang === "en" ? "Professional CV (PDF)" : "CV professionnel (PDF)",
              lang === "de" ? "Deutsches Format & Layout" : lang === "en" ? "German format & layout" : "Format et mise en page allemands",
              lang === "de" ? "Unbegrenzte Neugestaltungen" : lang === "en" ? "Unlimited regenerations" : "Régénérations illimitées",
            ] as string[]).map(f => (
              <li key={f} className="flex items-start gap-2 text-[12.5px]" style={{ color: "var(--w2)" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span>{f}</span>
              </li>
            ))}
            {/* Blue verified badge */}
            <li className="flex items-start gap-2 text-[12.5px]" style={{ color: "var(--w2)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><polyline points="20 6 9 17 4 12"/></svg>
              <span>{lang === "de" ? "Blaues Abzeichen — mehr Chancen auf Einstellung" : lang === "en" ? "Blue badge — better recruitment chances" : "Badge bleu — meilleures chances de recrutement"}</span>
            </li>
            {/* Refund — gold shimmer text */}
            <li className="flex items-start gap-2 text-[12.5px]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5"><polyline points="20 6 9 17 4 12"/></svg>
              <span className="font-semibold"
                style={{ background: "linear-gradient(90deg,var(--gold),#f0dfa0,var(--gold),#a07830)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", animation: "bvWave 2.5s linear infinite" }}>
                {lang === "de" ? "Rückerstattung, sobald Sie mit uns in Deutschland ankommen" : lang === "en" ? "Refundable once you land in Germany with us" : "Remboursable dès que vous arrivez en Allemagne avec nous"}
              </span>
            </li>
          </ul>

          <button onClick={handleUpgradeToStarter} disabled={starterUpgradeLoading}
            className="w-full py-3 rounded-xl text-[14px] font-semibold tracking-tight transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--gold)", color: "#131312", cursor: starterUpgradeLoading ? "wait" : "pointer" }}>
            {starterUpgradeLoading
              ? (lang === "de" ? "Weiterleitung…" : lang === "en" ? "Redirecting…" : "Redirection…")
              : (lang === "de" ? "Jetzt upgraden — €9" : lang === "en" ? "Upgrade now — €9" : "Passer au Starter — 9€")}
          </button>
          <button onClick={() => setStarterUpgradeOpen(false)}
            className="mt-3 text-[13px]" style={{ color: "var(--w3)" }}>
            {lang === "de" ? "Später" : lang === "en" ? "Later" : "Plus tard"}
          </button>
        </div>
      </div>
    )}
    </>
  );
}

export default function CVBuilderPage() {
  return (
    <React.Suspense fallback={null}>
      <CVBuilderInner />
    </React.Suspense>
  );
}

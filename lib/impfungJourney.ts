/**
 * Impfung (vaccination) sub-journey — the third pipeline track.
 *
 * Pure / server-safe. Derives a candidate's vaccination STAGE from the data
 * already captured in candidate_status.vaccines (Masern / Varizell doses, each
 * with got/expected dates + a cert_expected), gated by the AGENCY requirement.
 *
 * Crucially OPTIONAL: many employers require no Impfung at all → such candidates
 * return stage "not_required" and simply don't appear on the track.
 *
 * Flow (per the user): nothing → appointment booked (a dose has an expected
 * date) → receiving doses (X/Y done) → all doses done → translation submitted
 * (cert doc uploaded) → certificate accepted (cert doc approved).
 */

export type ImpfungStage =
  | "not_required"   // this candidate's agency needs no Impfung → off the track
  | "not_started"    // required, but nothing entered yet
  | "appointment"    // a dose has an expected (appointment) date, none received yet
  | "in_progress"    // at least one dose received, but not all required yet
  | "doses_done"     // all required doses received, cert not yet submitted
  | "submitted"      // vaccination translation/cert document uploaded (pending)
  | "accepted";      // cert document approved ✓

export type ImpfungStageDef = {
  key: ImpfungStage;
  position: number;
  color: string;
  label: { en: string; fr: string; de: string };
};

// Shown on the roadmap (excludes not_required / not_started which are "off-track").
export const IMPFUNG_STAGES: ImpfungStageDef[] = [
  { key: "appointment", position: 0, color: "#8b5cf6", label: { en: "Appointment booked",        fr: "Rendez-vous pris",         de: "Termin gebucht" } },
  { key: "in_progress", position: 1, color: "#f59e0b", label: { en: "Receiving doses",            fr: "Doses en cours",           de: "Dosen laufen" } },
  { key: "doses_done",  position: 2, color: "#06b6d4", label: { en: "All doses done",             fr: "Toutes les doses faites",  de: "Alle Dosen erhalten" } },
  { key: "submitted",   position: 3, color: "#eab308", label: { en: "Translation submitted",      fr: "Traduction soumise",       de: "Übersetzung eingereicht" } },
  { key: "accepted",    position: 4, color: "#16a34a", label: { en: "Certificate accepted",       fr: "Certificat accepté",       de: "Zertifikat akzeptiert" } },
];

export const IMPFUNG_STAGE_BY_KEY: Record<string, ImpfungStageDef> =
  Object.fromEntries(IMPFUNG_STAGES.map((s) => [s.key, s]));

export function impfungStageLabel(stage: ImpfungStage, lang: string): string {
  const d = IMPFUNG_STAGE_BY_KEY[stage];
  if (!d) return "";
  return d.label[(lang as "en" | "fr" | "de")] ?? d.label.en;
}

// ── Agency vaccine requirement ──────────────────────────────────────────────
// Per-agency required dose counts. Stored on organizations.vaccine_req (JSONB);
// absent / all-zero ⇒ no Impfung required for that agency's candidates.
export type VaccineReq = { masern: number; varizell: number };
export const NO_REQ: VaccineReq = { masern: 0, varizell: 0 };

export function normalizeReq(v: unknown): VaccineReq {
  if (!v || typeof v !== "object") return { ...NO_REQ };
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => { const k = Math.floor(Number(x)); return Number.isFinite(k) && k > 0 ? Math.min(k, 5) : 0; };
  return { masern: n(o.masern), varizell: n(o.varizell) };
}
export function reqRequiresImpfung(req: VaccineReq): boolean {
  return req.masern > 0 || req.varizell > 0;
}

// ── Stage derivation ────────────────────────────────────────────────────────
type Dose = { got: boolean | null; done_date: string | null; expected_date: string | null };
type VaxBlob = Record<string, { doses?: Dose[]; cert_expected?: string | null } | undefined>;

/**
 * @param req         the candidate's agency vaccine requirement
 * @param vaccines    candidate_status.vaccines
 * @param certStatus  status of their uploaded vaccination (impfung) document:
 *                    "approved" | "pending" | null (none)
 */
export function deriveImpfungStage(
  req: VaccineReq,
  vaccines: VaxBlob | null | undefined,
  certStatus: "approved" | "pending" | null,
): ImpfungStage {
  if (!reqRequiresImpfung(req)) return "not_required";

  // Cert document trumps dose bookkeeping (it's the final proof).
  if (certStatus === "approved") return "accepted";
  if (certStatus === "pending") return "submitted";

  const v = vaccines ?? {};
  let requiredTotal = 0, gotTotal = 0, anyExpected = false;
  for (const key of ["masern", "varizell"] as const) {
    const need = req[key];
    if (need <= 0) continue;
    requiredTotal += need;
    const doses = (v[key]?.doses ?? []) as Dose[];
    gotTotal += doses.filter((d) => d.got === true).length;
    if (doses.some((d) => !!d.expected_date)) anyExpected = true;
  }

  if (requiredTotal > 0 && gotTotal >= requiredTotal) return "doses_done";
  if (gotTotal > 0) return "in_progress";
  if (anyExpected) return "appointment";
  return "not_started";
}

/** How many required doses received vs needed (for the "X/Y" label). */
export function doseProgress(req: VaccineReq, vaccines: VaxBlob | null | undefined): { got: number; need: number } {
  const v = vaccines ?? {};
  let need = 0, got = 0;
  for (const key of ["masern", "varizell"] as const) {
    if (req[key] <= 0) continue;
    need += req[key];
    got += ((v[key]?.doses ?? []) as Dose[]).filter((d) => d.got === true).length;
  }
  return { got, need };
}

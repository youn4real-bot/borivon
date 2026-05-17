/**
 * Native AcroForm auto-fill — for PDFs that already ship with digital input
 * fields baked in (e.g. the BA EzB form). Skips the wizard's draw-a-box flow:
 * we read the existing field names, fuzzy-match them to FIELD_CATALOG entries,
 * fill the matches, and leave the rest editable so the employer can complete
 * them by hand or in Acrobat.
 *
 * Used by the admin placement wizard. Client-side (pdf-lib) only.
 */

import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFName,
  PDFRef,
} from "pdf-lib";
import type { CandidateFieldId } from "@/lib/candidateFields";
import type { AgencyFieldId } from "@/lib/agencyFields";

/** Either candidate-side or agency-side binding ID. The resolver passed to
 *  `fillAcroFormFields` decides which catalog to look the value up in. */
export type BindingId = CandidateFieldId | AgencyFieldId;

export type DetectedField = {
  /** AcroForm field name as stored in the PDF (used as the dictionary key). */
  name: string;
  /** Field control kind — drives how we set the value. */
  kind: "text" | "checkbox" | "radio" | "dropdown" | "unknown";
  /** Auto-detected mapping to a candidate or agency field. */
  suggested: BindingId | null;
  /** 1-indexed page the field's first widget sits on (1 if not resolvable). */
  page: number;
  /** Rect in PDF user space (origin bottom-left, points). null if unknown. */
  rect: { x: number; y: number; w: number; h: number } | null;
  /** Page natural size in PDF user space (points), used to project to CSS. */
  pageSize: { w: number; h: number } | null;
};

export type FieldMapping = {
  name: string;
  /** binding to a candidate or agency field, OR null when only a literal is set. */
  binding: BindingId | null;
  literal?: string;
};

// ── Detection ────────────────────────────────────────────────────────────────

/** Parse the PDF, list every AcroForm field, classify its kind. Also returns
 *  the first widget's page index + rectangle so the modal can overlay
 *  clickable hotspots directly on the PDF preview. */
export async function detectAcroFormFields(
  pdfBytes: Uint8Array | ArrayBuffer,
): Promise<DetectedField[]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const fields = form.getFields();
  const pages = doc.getPages();
  return fields.map((f) => {
    const name = f.getName();
    let kind: DetectedField["kind"] = "unknown";
    if (f instanceof PDFTextField)    kind = "text";
    else if (f instanceof PDFCheckBox) kind = "checkbox";
    else if (f instanceof PDFRadioGroup) kind = "radio";
    else if (f instanceof PDFDropdown) kind = "dropdown";

    // Pull the first widget's geometry. Widgets without a /P reference fall
    // back to page 1; missing rect → null (overlay simply won't render).
    let page = 1;
    let rect: DetectedField["rect"] = null;
    let pageSize: DetectedField["pageSize"] = null;
    try {
      const widget = f.acroField.getWidgets()[0];
      if (widget) {
        const r = widget.getRectangle();
        rect = { x: r.x, y: r.y, w: r.width, h: r.height };
        // Page resolution: prefer the /P entry on the widget dict; fall back
        // to scanning each page's /Annots array for the widget's ref.
        const pEntry = widget.dict.get(PDFName.of("P"));
        if (pEntry instanceof PDFRef) {
          const idx = pages.findIndex(p => p.ref === pEntry);
          if (idx >= 0) {
            page = idx + 1;
            const { width, height } = pages[idx].getSize();
            pageSize = { w: width, h: height };
          }
        }
        if (!pageSize && pages[0]) {
          const { width, height } = pages[0].getSize();
          pageSize = { w: width, h: height };
        }
      }
    } catch {
      // Unresolvable widget — overlay just won't show; sidebar still works.
    }

    return {
      name, kind,
      suggested: kind === "text" ? suggestBinding(name) : null,
      page, rect, pageSize,
    };
  });
}

// ── Auto-mapping heuristic ───────────────────────────────────────────────────

/**
 * Best-effort mapping from a PDF field name → candidate field id. Strips
 * leading numbers, normalizes umlauts + case, runs a keyword table. Returns
 * null when no confident match.
 */
export function suggestBinding(rawName: string): BindingId | null {
  const k = normalizeKey(rawName);
  for (const [keys, id] of RULES) {
    for (const key of keys) {
      if (k.includes(key)) return id;
    }
  }
  return null;
}

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^\d+[\s._-]*/g, "") // strip "3 ", "12_", "9."
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Auto-mapping is INTENTIONALLY conservative.
 *
 * We only auto-map fields whose names are UNAMBIGUOUSLY about the candidate.
 * Forms like the BA EzB have a section B (candidate) and section C (employer)
 * that both contain "Straße", "Hausnummer", "PLZ", "Ort", "Telefon", "E-Mail"
 * — if we matched on those naked keywords the system would happily fill the
 * employer's street with the candidate's residence street.
 *
 * So those shared keywords are OFF by default. Admin maps them once per form
 * via the modal's manual dropdown; the template-memory layer (per-signature
 * `pdf_field_mappings` row) remembers the decision for every future upload of
 * the same form, for every candidate. Zero ambiguity, one-time effort.
 *
 * If a field name is candidate-specific (e.g. "wohnsitz_arbeitnehmer",
 * "kandidat_strasse", "antragsteller_telefon") it WILL match because the
 * keyword survives normalization. Plain "strasse" alone won't.
 */
const RULES: ReadonlyArray<readonly [readonly string[], BindingId]> = [
  // ── Unambiguous agency / employer fields. Section C of forms always uses
  //    these terms — never the candidate. Safe to auto-map.
  [["firma",         "firmenname",  "arbeitgeber", "company"],              "agency_firma"],
  [["betriebsnummer", "etablissement"],                                     "agency_betriebsnummer"],
  [["kontaktperson", "ansprechpartner", "contactperson", "personnedecontact"], "agency_kontaktperson"],
  [["telefax",       "fax"],                                                "agency_telefax"],
  // ── Unambiguous: only ever refer to the candidate. ────────────────────────
  [["vorname",       "firstname",   "prenom"],                              "first_name"],
  [["nachname",      "lastname",    "familienname", "surname"],             "last_name"],
  [["geburtsdatum",  "dateofbirth", "dob",          "datedenaissance",
    "geboren",       "birthdate"],                                          "dob"],
  [["geschlecht",    "sex",         "gender"],                              "sex"],
  [["staatsangehoerigkeit", "nationalitaet", "nationality", "nationalite"], "nationality"],
  [["reisepass",     "passnummer",  "passportno", "passportnumber",
    "numdepasseport"],                                                      "passport_no"],
  [["passgueltig",   "passportexpiry", "gueltigbis"],                       "passport_expiry"],
  [["passausgestellt","passportissue","ausstellungs"],                      "passport_issue_date"],
  [["ausstellendebehoerde", "issuingauthority"],                            "issuing_authority"],
  [["geburtsort",    "placeofbirth"],                                       "city_of_birth"],
  [["geburtsland",   "countryofbirth"],                                     "country_of_birth"],
  [["wohnsitz",      "anschriftarbeitnehmer", "aufenthaltsort",
    "antragstelleranschrift", "kandidatanschrift"],                         "city_of_residence"],
  [["familienstand", "maritalstatus","etatcivil"],                          "marital_status"],
  [["kinder",        "children",    "enfants"],                             "children_ages"],
  // ── Ambiguous keywords (strasse / hausnummer / plz / ort / telefon /
  //    email) are deliberately NOT here. Admin maps them per-form once and
  //    template memory recalls the decision.
];

// ── Fill ─────────────────────────────────────────────────────────────────────

/**
 * Apply mappings + literal overrides to a PDF in-place. Returns the saved
 * bytes. Fields are left editable — flatten=false — so the employer can
 * complete remaining boxes after admin pre-fill.
 */
export async function fillAcroFormFields(
  pdfBytes: Uint8Array | ArrayBuffer,
  mappings: FieldMapping[],
  resolveValue: (id: BindingId) => string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();

  for (const m of mappings) {
    let value = "";
    if (m.literal != null && m.literal !== "") value = m.literal;
    else if (m.binding) value = resolveValue(m.binding);
    if (!value) continue;

    try {
      const field = form.getFieldMaybe(m.name);
      if (!field) continue;
      if (field instanceof PDFTextField)        field.setText(value);
      else if (field instanceof PDFCheckBox)    truthy(value) ? field.check() : field.uncheck();
      else if (field instanceof PDFDropdown)    field.select(value);
      else if (field instanceof PDFRadioGroup)  {
        // Match against available options (case-insensitive).
        const opt = field.getOptions().find(o => o.toLowerCase() === value.toLowerCase());
        if (opt) field.select(opt);
      }
    } catch (e) {
      console.warn("[fillAcroFormFields] skip field", m.name, e);
    }
  }

  // Keep fields editable — employer needs to add the remaining info before
  // printing & physically signing. Caller can flatten later if desired.
  return await doc.save();
}

function truthy(v: string): boolean {
  const s = v.toLowerCase().trim();
  return s === "ja" || s === "yes" || s === "true" || s === "1" || s === "x" || s === "✓";
}

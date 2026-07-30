import { getServiceSupabase } from "@/lib/supabase";
import type { BookingKind } from "@/lib/booking";

/**
 * Booking EVENT TYPES — the Calendly idea of "one shareable link per kind of
 * meeting".
 *
 * Until now /book asked the visitor to classify themselves on step 1 (nurse /
 * clinic / company), which means there was no link you could hand to a specific
 * company that simply opens their flow. Now each audience has its own URL:
 *
 *     /book/nurse     /book/clinic     /book/company
 *
 * DEGRADES GRACEFULLY BY DESIGN. Every lookup falls back to the built-in
 * catalog below, so the links work correctly before supabase/booking_event_types.sql
 * has been run, and keep working if that table is ever unreadable. Losing a
 * per-type duration override is a nicety; losing a lead is not.
 */

export type BookingEventType = {
  /** URL segment. This is the link. */
  slug: string;
  kind: BookingKind;
  active: boolean;
  /** NULL-able overrides of the global booking_availability row. */
  slotMinutes: number | null;
  bufferMinutes: number | null;
  minNoticeHours: number | null;
  horizonDays: number | null;
  title: { en: string; de: string; fr: string };
  blurb: { en: string; de: string; fr: string };
};

/**
 * The three that always exist. Also the fallback copy when a DB row leaves the
 * title/blurb columns NULL, which is the normal state — the seeded rows carry
 * only slug/kind/sort.
 */
const BUILT_IN: Record<string, BookingEventType> = {
  nurse: {
    slug: "nurse", kind: "nurse", active: true,
    slotMinutes: null, bufferMinutes: null, minNoticeHours: null, horizonDays: null,
    title: {
      en: "Free call — nurses",
      de: "Kostenloses Gespräch — Pflegekräfte",
      fr: "Appel gratuit — infirmiers",
    },
    blurb: {
      en: "For nurses who want to work in Germany. We go through your diploma, your German, and what the next step is.",
      de: "Für Pflegekräfte, die in Deutschland arbeiten möchten. Wir besprechen Ihr Diplom, Ihr Deutsch und den nächsten Schritt.",
      fr: "Pour les infirmiers qui souhaitent travailler en Allemagne. Nous parlons de votre diplôme, de votre allemand et de la prochaine étape.",
    },
  },
  clinic: {
    slug: "clinic", kind: "clinic", active: true,
    slotMinutes: null, bufferMinutes: null, minNoticeHours: null, horizonDays: null,
    title: {
      en: "Call — hospitals & care homes",
      de: "Gespräch — Kliniken & Pflegeheime",
      fr: "Appel — hôpitaux & maisons de retraite",
    },
    blurb: {
      en: "For healthcare facilities looking to recruit qualified nurses.",
      de: "Für Einrichtungen, die qualifizierte Pflegekräfte suchen.",
      fr: "Pour les établissements de santé qui recrutent des infirmiers qualifiés.",
    },
  },
  company: {
    slug: "company", kind: "company", active: true,
    slotMinutes: null, bufferMinutes: null, minNoticeHours: null, horizonDays: null,
    title: {
      en: "Call — German training for teams",
      de: "Gespräch — Deutschkurse für Teams",
      fr: "Appel — formation en allemand pour équipes",
    },
    blurb: {
      en: "For companies that need German training for their staff.",
      de: "Für Unternehmen, die Deutschkurse für ihre Mitarbeiter benötigen.",
      fr: "Pour les entreprises qui ont besoin de cours d'allemand pour leur personnel.",
    },
  },
};

/** The slugs that always resolve, in display order. */
export const BUILT_IN_SLUGS = ["nurse", "clinic", "company"] as const;

/** Shape check before any DB lookup, so junk never reaches Postgres. */
export function looksLikeSlug(s: unknown): s is string {
  return typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,38}$/.test(s);
}

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
};

type Row = Record<string, unknown>;

function fromRow(row: Row): BookingEventType | null {
  const slug = row.slug;
  const kind = row.kind;
  if (!looksLikeSlug(slug)) return null;
  if (kind !== "nurse" && kind !== "clinic" && kind !== "company") return null;
  const base = BUILT_IN[slug];
  const pick = (col: string, fb: string) =>
    typeof row[col] === "string" && (row[col] as string).trim() ? (row[col] as string) : fb;
  const fbTitle = base?.title ?? BUILT_IN[kind].title;
  const fbBlurb = base?.blurb ?? BUILT_IN[kind].blurb;
  return {
    slug,
    kind,
    active: row.active !== false,
    slotMinutes: num(row.slot_minutes, 5, 240),
    bufferMinutes: num(row.buffer_minutes, 0, 120),
    minNoticeHours: num(row.min_notice_hours, 0, 720),
    horizonDays: num(row.horizon_days, 1, 90),
    title: {
      en: pick("title_en", fbTitle.en),
      de: pick("title_de", fbTitle.de),
      fr: pick("title_fr", fbTitle.fr),
    },
    blurb: {
      en: pick("blurb_en", fbBlurb.en),
      de: pick("blurb_de", fbBlurb.de),
      fr: pick("blurb_fr", fbBlurb.fr),
    },
  };
}

const COLS =
  "slug,kind,active,sort,slot_minutes,buffer_minutes,min_notice_hours,horizon_days," +
  "title_en,title_de,title_fr,blurb_en,blurb_de,blurb_fr";

/**
 * Resolve one shareable link. Returns null ONLY when the slug is genuinely not
 * a bookable type — the caller 404s on that. A missing table is not "not
 * found": the three built-ins still resolve.
 */
export async function loadEventType(slug: string): Promise<BookingEventType | null> {
  if (!looksLikeSlug(slug)) return null;
  try {
    const { data, error } = await getServiceSupabase()
      .from("booking_event_types")
      .select(COLS)
      .eq("slug", slug)
      .maybeSingle();
    // supabase-js RESOLVES with { error } rather than throwing, so this branch
    // is the one that actually runs when the table has not been migrated yet.
    if (error) return BUILT_IN[slug] ?? null;
    if (!data) return null;
    const t = fromRow(data as unknown as Row);
    if (!t) return BUILT_IN[slug] ?? null;
    return t.active ? t : null;
  } catch {
    return BUILT_IN[slug] ?? null;
  }
}

/**
 * Overlay a type's overrides onto the global availability.
 *
 * Only non-null overrides apply, so a type with nothing set produces an object
 * identical to the global config — which is why adding this changes nothing
 * about how /book behaves today.
 */
export function overlayEventType<T extends {
  slotMinutes: number; bufferMinutes?: number; minNoticeHours: number; horizonDays: number;
}>(av: T, et: BookingEventType | null): T {
  if (!et) return av;
  return {
    ...av,
    ...(et.slotMinutes !== null ? { slotMinutes: et.slotMinutes } : {}),
    ...(et.bufferMinutes !== null ? { bufferMinutes: et.bufferMinutes } : {}),
    ...(et.minNoticeHours !== null ? { minNoticeHours: et.minNoticeHours } : {}),
    ...(et.horizonDays !== null ? { horizonDays: et.horizonDays } : {}),
  };
}

/** Every active type, for the admin "copy your links" panel. */
export async function listEventTypes(): Promise<BookingEventType[]> {
  const fallback = BUILT_IN_SLUGS.map((s) => BUILT_IN[s]);
  try {
    const { data, error } = await getServiceSupabase()
      .from("booking_event_types")
      .select(COLS)
      .order("sort", { ascending: true });
    if (error || !Array.isArray(data) || data.length === 0) return fallback;
    const out = (data as unknown as Row[]).map(fromRow).filter((t): t is BookingEventType => !!t && t.active);
    return out.length ? out : fallback;
  } catch {
    return fallback;
  }
}

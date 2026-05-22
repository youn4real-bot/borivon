/**
 * LetterDocument.tsx — @react-pdf/renderer component (server-side only).
 * Do NOT add "use client" here.
 *
 * One-page A4 German Motivationsschreiben. Mirrors the on-screen editor:
 *  - Sender block, right-aligned (locked, from passport)
 *  - UKSH recipient block, left-aligned (by admin-assigned campus)
 *  - Date line, right-aligned
 *  - Betreff (bold)
 *  - Salutation
 *  - Free-text body paragraphs (candidate-written, word-capped to one page)
 *  - "Mit freundlichen Grüßen" + name
 */
import React from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

// NEVER split a word across lines. react-pdf hyphenates by default
// (breaks long words mid-word with a hyphen) — German cover letters
// have long words and the user wants whole-word wrapping only. A
// hyphenation callback that returns the word as a single chunk makes
// every word unbreakable: if it doesn't fit on the current line it
// drops whole to the next line. Module-scope so it registers once
// when the generate route imports this component.
Font.registerHyphenationCallback((word) => [word]);

// ── Balanced address wrapping ──────────────────────────────────────────────
// react-pdf has no `text-wrap: balance`, so a long sender/recipient line
// wraps greedily — line 1 packed to the column edge, line 2 a stub ("Nr.
// 10"). For the right-aligned sender block that reads lopsided. We instead
// PRE-split such lines into roughly even-width rows so both lines carry a
// similar amount of text.
//
// Width is estimated per-glyph (uppercase is ~60% wider than lowercase in
// Lexend) so an ALL-CAPS street and a mixed-case city line both balance
// correctly and — critically — a line that already fits the column is left
// as a single row (never split unnecessarily).
function approxWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    if (ch >= "A" && ch <= "Z") w += 1.0;
    else if (ch >= "a" && ch <= "z") w += 0.62;
    else if (ch === " ") w += 0.38;
    else w += 0.6; // digits, punctuation, accented caps ≈ medium
  }
  return w;
}

/**
 * Split `text` into 1-N rows of roughly equal estimated width. `capacity`
 * is the column's width budget in the same per-glyph units approxWidth
 * uses (≈ how much fits on one line before react-pdf would wrap). Words
 * are never broken.
 */
function balanceWrap(text: string, capacity: number): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  const total = approxWidth(t);
  if (total <= capacity) return [t];                 // fits one line — leave it
  const words = t.split(/\s+/);
  const lineCount = Math.max(2, Math.ceil(total / capacity));
  const target = total / lineCount;                  // even width per row
  const rows: string[] = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    // Start a new row once the current one passes the even-share target,
    // but never create more rows than the natural wrap would (lineCount).
    if (cur && approxWidth(candidate) > target && rows.length < lineCount - 1) {
      rows.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LetterData {
  senderName: string;
  senderStreet: string;   // "Hay El Andalous, Rue El Hayat, Nr. 22"
  senderPlace: string;    // "60 000, Oujda, Marokko"
  senderPhone: string;    // raw phone, "Telefon: " prefix added here
  senderEmail: string;
  recipientLines: string[];
  dateLine: string;       // "Oujda, den 26.03.2026"
  subject: string;        // Betreff line
  salutation: string;     // "Sehr geehrte Damen und Herren,"
  bodyParagraphs: string[];
  closingName: string;
}

// Kept for API compatibility — branding is intentionally unused (clean letter).
export interface LetterBrand {
  logoSrc?: string;
  footerLines?: string[];
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const INK = "#1C1C1E";

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: "Lexend",
    color: INK,
    // DIN-5008-ish margins (top a touch tighter so it always fits one page)
    paddingTop: 48,
    paddingBottom: 40,
    paddingLeft: 64,
    paddingRight: 56,
    backgroundColor: "#FFFFFF",
    // NOTE: fontSize + lineHeight are applied INLINE from the `fit`
    // tier on <Page> so the WHOLE document scales as one unit. No child
    // style below sets its own fontSize — every Text inherits the page
    // size. That's the fix for "only the body resized": the sender,
    // recipient, date, Betreff and closing now scale together.
  },
  // Sender stays in the RIGHT half of the page. maxWidth on the View
  // forces long street addresses to wrap inside the 50% column instead
  // of running edge-to-edge. alignSelf pushes the column to the right
  // of the page; alignItems keeps the wrapped text right-aligned within
  // the column.
  senderBlock: { alignItems: "flex-end", alignSelf: "flex-end", maxWidth: "50%", marginBottom: 26 },
  line: {},
  senderLine: { textAlign: "right" },
  // Recipient mirrors the sender: stays in the LEFT half so even a long
  // employer address never crosses the vertical midline.
  recipientBlock: { marginBottom: 22, maxWidth: "50%" },
  dateRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 24 },
  // Bold but NOT a different size — it scales with the page like
  // everything else (the user wants one uniform text size per page).
  subject: { fontWeight: 700, marginBottom: 16 },
  salutation: { marginBottom: 12 },
  paragraph: { textAlign: "left" },
  closing: { marginTop: 18 },
  // "Mit freundlichen Grüßen" and the name sit on consecutive lines —
  // small gap, not a signature-sized void. (Was 22pt → felt detached.)
  closingName: { marginTop: 3 },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function LetterDocument({ data }: { data: LetterData; brand?: LetterBrand }) {
  // Force-fit: always one physical A4 page regardless of word/letter count.
  // Scale body type down as content grows so it can never spill to page 2.
  const bodyChars = data.bodyParagraphs.join(" ").length;
  const fit =
    bodyChars < 1100 ? { fs: 10.5, lh: 1.45, pmb: 10 } :
    bodyChars < 1500 ? { fs: 10,   lh: 1.4,  pmb: 9  } :
    bodyChars < 1900 ? { fs: 9.5,  lh: 1.35, pmb: 8  } :
                       { fs: 9,    lh: 1.3,  pmb: 7  };

  // Column capacity for the 50%-width sender/recipient lanes, in
  // approxWidth units. Observed: ~44 all-caps glyphs fit one line at
  // fs 10.5; smaller font fits proportionally more. Used only to decide
  // when a line is long enough to warrant balanced wrapping.
  const colCap = 44 * (10.5 / fit.fs);
  const streetRows = balanceWrap(data.senderStreet, colCap);
  const placeRows  = balanceWrap(data.senderPlace,  colCap);

  return (
    <Document>
      <Page size="A4" style={[s.page, { fontSize: fit.fs, lineHeight: fit.lh }]} wrap={false}>

        {/* Sender — right aligned, capped at 50% of the page width.
            Long street / place lines are pre-balanced into even rows. */}
        <View style={s.senderBlock}>
          <Text style={s.senderLine}>{data.senderName || " "}</Text>
          {streetRows.map((r, i) => <Text key={`st${i}`} style={s.senderLine}>{r}</Text>)}
          {placeRows.map((r, i)  => <Text key={`pl${i}`} style={s.senderLine}>{r}</Text>)}
          {!!data.senderPhone  && <Text style={s.senderLine}>Telefon: {data.senderPhone}</Text>}
          {!!data.senderEmail  && <Text style={s.senderLine}>{data.senderEmail}</Text>}
        </View>

        {/* Recipient — left aligned. Each admin-curated address line is
            balanced too so a long single line doesn't leave a stub. */}
        <View style={s.recipientBlock}>
          {data.recipientLines.flatMap((l, i) =>
            balanceWrap(l, colCap).map((r, j) => (
              <Text key={`rc${i}-${j}`} style={s.line}>{r}</Text>
            )),
          )}
        </View>

        {/* Date — right aligned */}
        <View style={s.dateRow}>
          <Text style={s.line}>{data.dateLine}</Text>
        </View>

        {/* Betreff */}
        {!!data.subject && <Text style={s.subject}>{data.subject}</Text>}

        {/* Salutation */}
        <Text style={s.salutation}>{data.salutation}</Text>

        {/* Body */}
        {data.bodyParagraphs.filter(p => p.trim()).map((p, i) => (
          <Text key={i} style={[s.paragraph, { marginBottom: fit.pmb }]}>{p}</Text>
        ))}

        {/* Closing */}
        <View style={s.closing}>
          <Text style={s.line}>Mit freundlichen Grüßen</Text>
          <Text style={s.closingName}>{data.closingName}</Text>
        </View>

      </Page>
    </Document>
  );
}

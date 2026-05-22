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

  return (
    <Document>
      <Page size="A4" style={[s.page, { fontSize: fit.fs, lineHeight: fit.lh }]} wrap={false}>

        {/* Sender — right aligned, capped at 50% of the page width */}
        <View style={s.senderBlock}>
          <Text style={s.senderLine}>{data.senderName || " "}</Text>
          {!!data.senderStreet && <Text style={s.senderLine}>{data.senderStreet}</Text>}
          {!!data.senderPlace  && <Text style={s.senderLine}>{data.senderPlace}</Text>}
          {!!data.senderPhone  && <Text style={s.senderLine}>Telefon: {data.senderPhone}</Text>}
          {!!data.senderEmail  && <Text style={s.senderLine}>{data.senderEmail}</Text>}
        </View>

        {/* Recipient — left aligned */}
        <View style={s.recipientBlock}>
          {data.recipientLines.map((l, i) => (
            <Text key={i} style={s.line}>{l}</Text>
          ))}
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

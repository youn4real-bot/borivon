/**
 * Postgres' type input functions, re-implemented for PostgREST filter operands.
 *
 * PostgREST never interprets a filter value. `?user_id=eq.<x>` reaches Postgres
 * as an untyped literal, and the COLUMN's input function (uuid_in, boolin,
 * int4in, numeric_in, date_in, timestamptz_in, array_in) decides what it
 * means. D1 has no such types: every uuid, date and timestamp is TEXT, so a
 * bound operand is compared byte for byte, and two things go wrong silently:
 *
 *  - a value Postgres REJECTS (`eq.not-a-uuid`, `eq.maybe` on a boolean, an
 *    empty string on an integer) comes back 200 [] instead of the 400 22P02 /
 *    22007 / 22008 the call site's `if (error)` branch was written against.
 *    Worse, `Number("") === 0`, so `.eq("remind_count", "")` returned every row
 *    whose count is 0;
 *  - a value Postgres ACCEPTS in another spelling (an uppercase UUID from a
 *    partner system, `6/15/2026`, `2026-09-12 06:28:29+00`) matches nothing,
 *    because the copy only holds the one canonical spelling Postgres printed.
 *
 * So each operand runs through the matching function below: error code,
 * message and hint copied from the Postgres source and checked against the
 * live project, and the accepted value handed on in the stored spelling.
 *
 * Deliberately never STRICTER than Postgres. Date input also takes month names,
 * timezone abbreviations and IANA zone names that only Postgres' own tables can
 * judge. Whatever this module cannot decide with certainty is passed through
 * untouched, which is what the adapter did before this module existed: an
 * error is only produced where Postgres' parser provably fails.
 *
 * Pure: no D1, no network. `now` is injectable for the `today` / `now` words.
 */
import type { PgType, PostgrestError } from "./types";

export type InputResult = { value: unknown } | { error: PostgrestError };

export function isInputError(r: InputResult): r is { error: PostgrestError } {
  return "error" in r;
}

function fail(code: string, message: string, opts: { hint?: string; details?: string; status?: number } = {}): InputResult {
  return { error: { code, message, details: opts.details ?? null, hint: opts.hint ?? null, status: opts.status ?? 400 } };
}

/** Postgres' own name for a type, the way `format_type_be()` prints it into messages. */
export function pgTypeName(pg: PgType): string {
  return pg === "timestamptz" ? "timestamp with time zone" : pg;
}

const invalidSyntax = (type: string, raw: string) => fail("22P02", `invalid input syntax for type ${type}: "${raw}"`);

/* ── character classes: C's, in the "C" locale, not JavaScript's ────────── */

/** isspace(): what every Postgres input function trims. `\s` would also eat NBSP. */
const isSpace = (c: string | undefined) =>
  c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
/** pg_strncasecmp folds ASCII only; `toLowerCase()` would turn `İ` into two characters. */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/* ── uuid ─────────────────────────────────────────────────────────────────── */

/**
 * uuid_in (utils/adt/uuid.c string_to_uuid): 32 hex digits in either case, a
 * hyphen allowed after any group of four, optionally wrapped in braces — and
 * nothing else, not even surrounding whitespace. Always printed lowercase, which
 * is the only spelling the copy holds.
 */
export function uuidIn(raw: string): InputResult {
  let i = 0;
  const braces = raw[0] === "{";
  if (braces) i++;
  let hex = "";
  for (let byte = 0; byte < 16; byte++) {
    const pair = raw.slice(i, i + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) return invalidSyntax("uuid", raw);
    hex += pair;
    i += 2;
    if (raw[i] === "-" && byte % 2 === 1 && byte < 15) i++;
  }
  if (braces) {
    if (raw[i] !== "}") return invalidSyntax("uuid", raw);
    i++;
  }
  if (i !== raw.length) return invalidSyntax("uuid", raw);
  const h = hex.toLowerCase();
  return { value: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
}

/* ── boolean ──────────────────────────────────────────────────────────────── */

/**
 * boolin (utils/adt/bool.c parse_bool_with_len): whitespace-trimmed, any
 * case-insensitive PREFIX of true/false/yes/no, `on`/`off` from two letters
 * (a lone `o` is ambiguous), and exactly `1`/`0`. So `tru` and `of` are real
 * booleans, while `2`, `truex` and `null` are 22P02.
 */
export function boolIn(raw: string): InputResult {
  let start = 0;
  let end = raw.length;
  while (start < end && isSpace(raw[start])) start++;
  while (end > start && isSpace(raw[end - 1])) end--;
  const s = asciiLower(raw.slice(start, end));
  const prefixOf = (word: string, min = 1) => s.length >= min && s.length <= word.length && word.startsWith(s);
  switch (s[0]) {
    case "t": if (prefixOf("true")) return { value: true }; break;
    case "f": if (prefixOf("false")) return { value: false }; break;
    case "y": if (prefixOf("yes")) return { value: true }; break;
    case "n": if (prefixOf("no")) return { value: false }; break;
    case "o":
      if (prefixOf("on", 2)) return { value: true };
      if (prefixOf("off", 2)) return { value: false };
      break;
    case "1": if (s.length === 1) return { value: true }; break;
    case "0": if (s.length === 1) return { value: false }; break;
  }
  return invalidSyntax("boolean", raw);
}

/* ── integer / bigint ─────────────────────────────────────────────────────── */

function digitValue(c: string | undefined, base: bigint): bigint | null {
  if (c === undefined) return null;
  const d = parseInt(c, 16);
  return Number.isNaN(d) || BigInt(d) >= base ? null : BigInt(d);
}

/**
 * int4in / int8in (utils/adt/numutils.c pg_strtoint32_safe, Postgres 16+):
 * surrounding whitespace, a sign, `0x` / `0o` / `0b` prefixes, and `_` between
 * digits. `0.0` and `1e3` are NOT integers (22P02); a value that does not fit is
 * 22003. Overflow is detected while the digits are read, exactly like the C
 * loop, so `99999999999x` is "out of range" rather than "invalid syntax".
 *
 * A bigint past 2^53 comes back as its decimal string instead of a rounded
 * number: SQLite applies the INTEGER column's affinity to a bound string, so the
 * comparison stays exact.
 */
// BigInt() calls, not `2n` literals: the project compiles below ES2020.
const BIG = { 0: BigInt(0), 1: BigInt(1), 2: BigInt(2), 8: BigInt(8), 10: BigInt(10), 16: BigInt(16) };
const INT4_MAGNITUDE = BigInt("2147483648");               // |INT_MIN|
const INT8_MAGNITUDE = BigInt("9223372036854775808");      // |BIGINT_MIN|
const SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

function prefixBase(raw: string, p: number): bigint {
  if (raw[p] !== "0") return BIG[10];
  const c = raw[p + 1];
  return c === "x" || c === "X" ? BIG[16] : c === "o" || c === "O" ? BIG[8] : c === "b" || c === "B" ? BIG[2] : BIG[10];
}

export function intIn(raw: string, pg: "integer" | "bigint"): InputResult {
  const magnitude = pg === "integer" ? INT4_MAGNITUDE : INT8_MAGNITUDE;
  const outOfRange = () => fail("22003", `value "${raw}" is out of range for type ${pg}`);
  let p = 0;
  while (isSpace(raw[p])) p++;
  let neg = false;
  if (raw[p] === "-") { neg = true; p++; } else if (raw[p] === "+") p++;
  const base = prefixBase(raw, p);
  if (base !== BIG[10]) p += 2;
  const limit = magnitude / base;
  const first = p;
  let tmp = BIG[0];
  for (;;) {
    const d = digitValue(raw[p], base);
    if (d !== null) {
      if (tmp > limit) return outOfRange();
      tmp = tmp * base + d;
      p++;
    } else if (raw[p] === "_" && p > first) {
      p++;
      if (digitValue(raw[p], base) === null) return invalidSyntax(pg, raw);
    } else {
      break;
    }
  }
  if (p === first) return invalidSyntax(pg, raw);
  while (isSpace(raw[p])) p++;
  if (p !== raw.length) return invalidSyntax(pg, raw);
  if (neg ? tmp > magnitude : tmp > magnitude - BIG[1]) return outOfRange();
  if (tmp === BIG[0]) return { value: 0 };
  const n = neg ? -tmp : tmp;
  return { value: tmp <= SAFE_INTEGER ? Number(n) : n.toString() };
}

/* ── numeric ──────────────────────────────────────────────────────────────── */

/**
 * numeric_in (utils/adt/numeric.c, Postgres 16+): whitespace, sign, digits with
 * one optional point and `_` separators, an exponent, the `0x`/`0o`/`0b`
 * integer forms, and NaN / Infinity / inf. `1,5` and the empty string are 22P02.
 *
 * D1 stores numeric as REAL and cannot bind a non-finite number, so NaN and
 * +Infinity stay text: SQLite sorts any TEXT above every REAL, which is exactly
 * where Postgres puts both of them. -Infinity becomes the most negative double.
 */
export function numericIn(raw: string): InputResult {
  let p = 0;
  while (isSpace(raw[p])) p++;
  const numstart = p;
  let neg = false;
  if (raw[p] === "+") p++;
  else if (raw[p] === "-") { neg = true; p++; }

  const trailingOnlySpace = (from: number) => {
    for (let q = from; q < raw.length; q++) if (!isSpace(raw[q])) return false;
    return true;
  };

  if (!isDigit(raw[p]) && raw[p] !== ".") {
    let end = -1;
    let value: unknown;
    if (asciiLower(raw.slice(numstart, numstart + 3)) === "nan") { end = numstart + 3; value = "NaN"; }
    else if (asciiLower(raw.slice(p, p + 8)) === "infinity") { end = p + 8; value = neg ? -Number.MAX_VALUE : "Infinity"; }
    else if (asciiLower(raw.slice(p, p + 3)) === "inf") { end = p + 3; value = neg ? -Number.MAX_VALUE : "Infinity"; }
    if (end < 0 || !trailingOnlySpace(end)) return invalidSyntax("numeric", raw);
    return { value };
  }

  if (prefixBase(raw, p) !== BIG[10]) {
    const base = prefixBase(raw, p);
    p += 2;
    const first = p;
    let tmp = BIG[0];
    for (;;) {
      const d = digitValue(raw[p], base);
      if (d !== null) { tmp = tmp * base + d; p++; }
      else if (raw[p] === "_") { p++; if (digitValue(raw[p], base) === null) return invalidSyntax("numeric", raw); }
      else break;
    }
    if (p === first || !trailingOnlySpace(p)) return invalidSyntax("numeric", raw);
    return { value: Number(neg ? -tmp : tmp) };
  }

  let text = neg ? "-" : "";
  let haveDp = false;
  let digits = 0;
  if (raw[p] === ".") { haveDp = true; text += "."; p++; }
  if (!isDigit(raw[p])) return invalidSyntax("numeric", raw);
  for (;;) {
    const c = raw[p];
    if (isDigit(c)) { text += c; digits++; p++; }
    else if (c === ".") {
      if (haveDp) return invalidSyntax("numeric", raw);
      haveDp = true; text += "."; p++;
      if (raw[p] === "_") return invalidSyntax("numeric", raw);
    } else if (c === "_") {
      p++;
      if (!isDigit(raw[p])) return invalidSyntax("numeric", raw);
    } else break;
  }
  if (digits === 0) return invalidSyntax("numeric", raw);
  if (raw[p] === "e" || raw[p] === "E") {
    text += "e";
    p++;
    if (raw[p] === "+") p++;
    else if (raw[p] === "-") { text += "-"; p++; }
    if (!isDigit(raw[p])) return invalidSyntax("numeric", raw);
    let exponent = 0;
    for (;;) {
      if (isDigit(raw[p])) {
        exponent = exponent * 10 + Number(raw[p]);
        if (exponent > 1073741823) return fail("22003", "value overflows numeric format");
        text += raw[p++];
      } else if (raw[p] === "_") {
        p++;
        if (!isDigit(raw[p])) return invalidSyntax("numeric", raw);
      } else break;
    }
  }
  if (!trailingOnlySpace(p)) return invalidSyntax("numeric", raw);
  const n = Number(text);
  // Beyond a double's range the value is still valid numeric; text keeps it
  // above every REAL, which is right for the (only realistic) positive case.
  return { value: Number.isFinite(n) ? n : raw };
}

/* ── date / timestamptz ───────────────────────────────────────────────────── */

/** The DTERR_* outcomes of Postgres' datetime parser that this module reproduces. */
type DtErr = "bad" | "field" | "md" | "tz";
const UNKNOWN = "unknown" as const;

type DtField = { type: "date" | "number" | "time" | "tz" | "t" | "z" | "junk"; text: string };

/**
 * Single letters that are no date token at all. Postgres looks a word up as a
 * timezone abbreviation, then in its own keyword table, then as a timezone
 * name, and fails the whole value when all three miss. None of these letters is
 * any of the three: every one was checked live after a date, after a timestamp
 * and before a date, and each is a 22007 in all three places. The other letters
 * are left out on purpose — `t` and `z` are handled as tokens, and d h j m s y
 * are unit keywords whose meaning depends on the field after them.
 */
const NOT_A_DATE_TOKEN = new Set("abcefgiklnopqruvwx");
/** The single-letter unit keywords (day, hour, julian, month, second, year). */
const UNIT_LETTERS = new Set("dhjmsy");

/**
 * datetime.c DateTimeParseError(). The message quotes the input exactly as
 * sent — surrounding spaces included — which is what the live project prints.
 */
function dateTimeError(err: DtErr, raw: string, type: string): InputResult {
  switch (err) {
    case "field": return fail("22008", `date/time field value out of range: "${raw}"`);
    case "md": return fail("22008", `date/time field value out of range: "${raw}"`, { hint: 'Perhaps you need a different "datestyle" setting.' });
    case "tz": return fail("22009", `time zone displacement out of range: "${raw}"`);
    default: return fail("22007", `invalid input syntax for type ${type}: "${raw}"`);
  }
}

/**
 * ParseDateTime(), restricted to what a NUMERIC date needs: digits, the `-/.`
 * date separators, `:` times, signed offsets, the ISO `T` and the `Z` zone.
 * Punctuation Postgres ignores is ignored here too. A word or a non-ASCII
 * character could be a month name or a timezone this module has no table for,
 * so it ends the attempt with "unknown" rather than an error.
 */
function splitFields(s: string): DtField[] | DtErr | typeof UNKNOWN {
  const fields: DtField[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (isSpace(c)) { i++; continue; }
    if (isDigit(c)) {
      let buf = "";
      while (isDigit(s[i])) buf += s[i++];
      if (s[i] === ":") {
        buf += s[i++];
        while (isDigit(s[i]) || s[i] === ":" || s[i] === ".") buf += s[i++];
        fields.push({ type: "time", text: buf });
      } else if (s[i] === "-" || s[i] === "/" || s[i] === ".") {
        const delim = s[i];
        buf += s[i++];
        if (isDigit(s[i])) {
          let type: DtField["type"] = delim === "." ? "number" : "date";
          while (isDigit(s[i])) buf += s[i++];
          if (s[i] === delim) {
            type = "date";
            buf += s[i++];
            while (isDigit(s[i]) || s[i] === delim) buf += s[i++];
          }
          fields.push({ type, text: buf });
        } else {
          // `2026--06-15`: Postgres soaks up letters and the delimiter here, so a
          // textual month (`15-jun-2026`) is an answer only its tables can give.
          while (/^[A-Za-z0-9]$/.test(s[i] ?? "") || s[i] === delim) buf += s[i++];
          if (/[A-Za-z]/.test(buf)) return UNKNOWN;
          fields.push({ type: "date", text: buf });
        }
      } else {
        fields.push({ type: "number", text: buf });
      }
      continue;
    }
    if (/^[A-Za-z]$/.test(c)) {
      let word = "";
      while (/^[A-Za-z]$/.test(s[i] ?? "")) word += s[i++].toLowerCase();
      const next = s[i];
      const joined = next === "-" || next === "/" || next === ".";
      if (word === "t" && !joined) { fields.push({ type: "t", text: word }); continue; }
      // A word followed by `+` or a digit that is not a keyword becomes a zone
      // spec (`x+1`), whose failure is a different error (22023) — not junk.
      const standalone = !joined && next !== "+" && !isDigit(next);
      if (word === "z" && standalone) { fields.push({ type: "z", text: word }); continue; }
      if (word.length === 1 && NOT_A_DATE_TOKEN.has(word) && standalone) { fields.push({ type: "junk", text: word }); continue; }
      // A unit keyword labels the number that follows it; with nothing after it
      // Postgres rejects the prefix it never used (live: every one of the six is a
      // 22007 at the end of a date, of a time and of a zone offset).
      if (word.length === 1 && UNIT_LETTERS.has(word) && standalone && /^[ \t\n\r\f\v]*$/.test(s.slice(i))) {
        fields.push({ type: "junk", text: word });
        continue;
      }
      return UNKNOWN;
    }
    if (c === "+" || c === "-") {
      let buf = c;
      i++;
      while (isSpace(s[i])) i++;
      if (isDigit(s[i])) {
        while (isDigit(s[i]) || s[i] === ":" || s[i] === "." || s[i] === "-") buf += s[i++];
        fields.push({ type: "tz", text: buf });
        continue;
      }
      if (/^[A-Za-z]$/.test(s[i] ?? "")) return UNKNOWN;   // `-infinity` and zone names
      return "bad";                                        // a dangling sign
    }
    if (c === ".") return UNKNOWN;                         // `.5`: a bare fraction
    if (/^[!-/:-@[-`{-~]$/.test(c)) { i++; continue; }     // ispunct(): a plain delimiter
    return UNKNOWN;
  }
  return fields;
}

type Tm = {
  Y: boolean; M: boolean; D: boolean; TIME: boolean; TZ: boolean;
  year: number; mon: number; mday: number;
  hour: number; min: number; sec: number; usec: number;
  tz: number;               // seconds EAST of UTC
  is2digits: boolean;
  isoDate: boolean;         // the date came as YYYY-MM-DD, digit for digit
  plainTime: boolean;       // the time came as HH:MM:SS[.frac], at most 6 fraction digits
  fracText: string;
  numericZeroZone: boolean; // an explicit +00 / -00:00 / +0000 offset
};

const INT_MAX = 2147483647;

/** rint(): C rounds half to even; Math.round would round .5 up. */
function rint(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** DecodeNumber() for one all-digit field, in the MDY field order Supabase runs with. */
function decodeNumber(str: string, tm: Tm): DtErr | typeof UNKNOWN | undefined {
  const flen = str.length;
  const val = Number(str);
  if (val > INT_MAX) return "field";
  if (flen === 3 && tm.Y && !tm.M && !tm.D && val >= 1 && val <= 366) return UNKNOWN;   // day-of-year
  if (!tm.Y && !tm.M && !tm.D) {
    if (flen >= 3) { tm.Y = true; tm.year = val; tm.is2digits = false; }
    else { tm.M = true; tm.mon = val; }
  } else if (tm.Y && !tm.M && !tm.D) { tm.M = true; tm.mon = val; }
  else if (!tm.Y && tm.M && !tm.D) { tm.D = true; tm.mday = val; }
  else if (tm.Y && tm.M && !tm.D) { tm.D = true; tm.mday = val; }
  else if (!tm.Y && tm.M && tm.D) { tm.Y = true; tm.year = val; tm.is2digits = flen <= 2; }
  else if (tm.Y && tm.M && tm.D) {
    // A fourth number is a run-together time (DecodeNumberField): hhmmss / hhmm.
    return flen === 6 || flen === 4 ? UNKNOWN : "bad";
  } else {
    return "bad";
  }
  return undefined;
}

/** DecodeDate(): the numeric subfields of one `a-b-c` / `a/b/c` / `a.b.c` field. */
function decodeDate(text: string, tm: Tm): DtErr | typeof UNKNOWN | undefined {
  if (!isDigit(text[text.length - 1])) return "bad";   // a separator with nothing after it
  for (const part of text.split(/[^0-9]+/)) {
    const err = decodeNumber(part, tm);
    if (err) return err;
  }
  return undefined;
}

/** DecodeTime() + time_overflows(). `mm:ss.fff` (a MINUTE TO SECOND reading) is left to Postgres. */
function decodeTime(text: string, tm: Tm): DtErr | typeof UNKNOWN | undefined {
  let i = 0;
  const readInt = () => { let s = ""; while (isDigit(text[i])) s += text[i++]; return s; };
  const hourText = readInt();
  if (text[i] !== ":") return "bad";
  i++;
  const minText = readInt();
  let secText = "";
  let fracText = "";
  if (i === text.length) {
    // hh:mm
  } else if (text[i] === ".") {
    return UNKNOWN;
  } else if (text[i] === ":") {
    i++;
    secText = readInt();
    if (i < text.length) {
      fracText = text.slice(i);
      if (!/^\.\d+$/.test(fracText)) return "bad";
    }
  } else {
    return "bad";
  }
  const hour = Number(hourText);
  const min = minText === "" ? 0 : Number(minText);
  const sec = secText === "" ? 0 : Number(secText);
  if (hour > INT_MAX || min > INT_MAX || sec > INT_MAX) return "field";
  const usec = fracText ? rint(Number(fracText) * 1_000_000) : 0;
  if (min > 59 || sec > 60 || usec > 1_000_000) return "field";
  if (((hour * 60 + min) * 60 + sec) * 1_000_000 + usec > 86_400_000_000) return "field";
  tm.hour = hour; tm.min = min; tm.sec = sec; tm.usec = usec;
  tm.plainTime = /^\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(text);
  tm.fracText = fracText;
  return undefined;
}

/** DecodeTimezone(): `+hh`, `+hhmm`, `+hh:mm[:ss]`, at most 15 hours. */
function decodeTimezone(text: string, tm: Tm): DtErr | undefined {
  let i = 1;
  const readInt = () => {
    let s = "";
    if (text[i] === "+" || text[i] === "-") s += text[i++];
    while (isDigit(text[i])) s += text[i++];
    const n = s === "" || s === "+" || s === "-" ? 0 : Number(s);
    return n;
  };
  let hr = readInt();
  let min = 0;
  let sec = 0;
  if (text[i] === ":") {
    i++;
    min = readInt();
    if (text[i] === ":") { i++; sec = readInt(); }
  } else if (i === text.length && text.length > 3) {
    min = hr % 100;
    hr = Math.trunc(hr / 100);
  }
  if (Math.abs(hr) > INT_MAX || Math.abs(min) > INT_MAX || Math.abs(sec) > INT_MAX) return "tz";
  if (hr < 0 || hr > 15 || min < 0 || min >= 60 || sec < 0 || sec >= 60) return "tz";
  if (i !== text.length) return "bad";
  tm.tz = (text[0] === "-" ? -1 : 1) * (hr * 3600 + min * 60 + sec);
  tm.numericZeroZone = tm.tz === 0;
  return undefined;
}

const isLeap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** DecodeDateTime() over the fields splitFields() produced, then ValidateDate(). */
function decodeDateTime(fields: DtField[]): Tm | DtErr | typeof UNKNOWN {
  const tm: Tm = {
    Y: false, M: false, D: false, TIME: false, TZ: false,
    year: 0, mon: 0, mday: 0, hour: 0, min: 0, sec: 0, usec: 0, tz: 0,
    is2digits: false, isoDate: false, plainTime: false, fracText: "", numericZeroZone: false,
  };
  let pendingT = false;
  for (let f = 0; f < fields.length; f++) {
    const { type, text } = fields[f];
    const anyDate = tm.Y || tm.M || tm.D;
    const fullDate = tm.Y && tm.M && tm.D;
    switch (type) {
      case "date": {
        // A second date-shaped field after month and day is read as a zone.
        if (pendingT || (tm.M && tm.D)) return UNKNOWN;
        const err = decodeDate(text, tm);
        if (err) return err;
        tm.isoDate = /^\d{4}-\d{2}-\d{2}$/.test(text);
        break;
      }
      case "number": {
        if (pendingT) {
          // DecodeNumberField() for the field after an ISO `T`: hhmmss or hhmm,
          // optionally with a fraction of a second, and no other length. Nothing
          // range-checks the parts there — live, `2026-08-04T1099` is accepted
          // (10:99 is 11:39) and `T250000` too, while `T10`, `T103`, `T10300`
          // and `T10.5` are all 22007.
          pendingT = false;
          const [whole, fraction] = text.split(".");
          if (Number(whole) > INT_MAX) return "field";         // strtoint() overflow
          if (whole.length !== 6 && whole.length !== 4) return "bad";
          if (tm.TIME) return "bad";
          tm.hour = Number(whole.slice(0, 2));
          tm.min = Number(whole.slice(2, 4));
          tm.sec = whole.length === 6 ? Number(whole.slice(4, 6)) : 0;
          tm.usec = fraction ? rint(Number(`.${fraction}`) * 1_000_000) : 0;
          tm.TIME = true;
          tm.plainTime = false;
          break;
        }
        if (text.includes(".")) {
          if (anyDate) return UNKNOWN;
          const err = decodeDate(text, tm);
          if (err) return err;
        } else if (text.length >= 6 && (!anyDate || !tm.TIME)) {
          if (anyDate && !fullDate) return "bad";
          if (fullDate) return text.length === 6 ? UNKNOWN : "bad";
          const n = text.length;
          tm.mday = Number(text.slice(n - 2));
          tm.mon = Number(text.slice(n - 4, n - 2));
          tm.year = Number(text.slice(0, n - 4));
          tm.Y = tm.M = tm.D = true;
          tm.is2digits = n - 4 === 2;
        } else {
          const err = decodeNumber(text, tm);
          if (err) return err;
        }
        break;
      }
      case "time": {
        pendingT = false;
        const err = decodeTime(text, tm);
        if (err) return err;
        if (tm.TIME) return "bad";
        tm.TIME = true;
        break;
      }
      case "tz": {
        const hadTz = tm.TZ;
        const err = decodeTimezone(text, tm);
        if (err) return err;
        if (hadTz) return "bad";
        tm.TZ = true;
        break;
      }
      case "t": {
        if (!fullDate) return "bad";
        const next = fields[f + 1];
        if (!next || (next.type !== "number" && next.type !== "time" && next.type !== "date")) return "bad";
        pendingT = true;
        break;
      }
      case "z": {
        if (tm.TZ) return "bad";
        tm.TZ = true;
        tm.tz = 0;
        break;
      }
      case "junk":
        // Postgres fails at this field, after the fields before it have had their say.
        return "bad";
    }
  }

  // ValidateDate()
  if (tm.Y) {
    if (tm.is2digits) {
      if (tm.year < 70) tm.year += 2000;
      else if (tm.year < 100) tm.year += 1900;
    } else if (tm.year <= 0) {
      return "field";
    }
  }
  if (tm.M && (tm.mon < 1 || tm.mon > 12)) return "md";
  if (tm.D && (tm.mday < 1 || tm.mday > 31)) return "md";
  if (tm.Y && tm.M && tm.D && tm.mday > (tm.mon === 2 && isLeap(tm.year) ? 29 : DAYS_IN_MONTH[tm.mon - 1])) return "field";
  if (!(tm.Y && tm.M && tm.D)) return "bad";
  // Years past 9999 are valid Postgres dates, but their range limits are not
  // reproduced here — hand them on as given.
  if (tm.year > 9999) return UNKNOWN;
  return tm;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

const SPECIAL_WORDS = new Set(["epoch", "infinity", "-infinity", "now", "today", "tomorrow", "yesterday"]);

/**
 * A digit-free value can only be one of Postgres' special words: nothing else
 * can supply a year, month and day. Returns the UTC instant for it, the literal
 * for ±infinity (which sorts past every stored ISO string on the right side),
 * or null when the value is not exactly one special word.
 */
function specialInstant(raw: string, now: number): { ms: number } | { literal: string } | null {
  const word = asciiLower(raw.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, ""));
  if (!SPECIAL_WORDS.has(word)) return null;
  if (word === "infinity" || word === "-infinity") return { literal: word };
  if (word === "epoch") return { ms: 0 };
  if (word === "now") return { ms: now };
  const midnight = Math.floor(now / 86_400_000) * 86_400_000;
  return { ms: midnight + (word === "tomorrow" ? 86_400_000 : word === "yesterday" ? -86_400_000 : 0) };
}

type DtOutcome = { tm: Tm } | { special: { ms: number } | { literal: string } } | { error: InputResult } | typeof UNKNOWN;

/**
 * `String(new Date())` on a UTC host — the Worker — which is what reaches the
 * wire when a Date object is handed to `.eq()` instead of its toISOString().
 * Postgres reads `Thu`, `Jan`, the numbers, the time and `GMT+0000` (a POSIX zone
 * spec) and then fails on `Coordinated`, which is neither a keyword, an
 * abbreviation nor a zone: 22007, checked live for several dates. This module
 * reads no month or weekday names, so the one spelling is recognised whole; a
 * non-UTC host prints other zone names (and `GMT+0530` even turns the error into
 * 22023), which stay with Postgres' tables.
 */
const WORKER_DATE_STRING = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2} \d{4} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d GMT\+0000 \(Coordinated Universal Time\)$/;

function parseDateTimeValue(raw: string, type: string, now: number): DtOutcome {
  if (WORKER_DATE_STRING.test(raw)) return { error: dateTimeError("bad", raw, type) };
  if (!/[0-9]/.test(raw)) {
    const special = specialInstant(raw, now);
    if (special) return { special };
    // A special word next to other words (`today utc`) may still be valid.
    if (/(?:^|[^a-z])(?:epoch|infinity|now|today|tomorrow|yesterday)(?:$|[^a-z])/i.test(raw)) return UNKNOWN;
    return { error: dateTimeError("bad", raw, type) };
  }
  const fields = splitFields(raw);
  if (fields === UNKNOWN) return UNKNOWN;
  if (typeof fields === "string") return { error: dateTimeError(fields, raw, type) };
  const tm = decodeDateTime(fields);
  if (tm === UNKNOWN) return UNKNOWN;
  if (typeof tm === "string") return { error: dateTimeError(tm, raw, type) };
  return { tm };
}

/**
 * date_in. The time and zone of a full timestamp are parsed (their errors still
 * apply) and then dropped, exactly like Postgres: `2026-06-15T23:30:00-05:00` is
 * the date 2026-06-15.
 */
export function dateIn(raw: string, now = Date.now()): InputResult {
  const out = parseDateTimeValue(raw, "date", now);
  if (out === UNKNOWN) return { value: raw };
  if ("error" in out) return out.error;
  if ("special" in out) {
    if ("literal" in out.special) return { value: out.special.literal };
    return { value: new Date(out.special.ms).toISOString().slice(0, 10) };
  }
  const { tm } = out;
  return { value: `${pad(tm.year, 4)}-${pad(tm.mon, 2)}-${pad(tm.mday, 2)}` };
}

/**
 * timestamptz_in, answering in one of the two spellings buildSql's timestamp
 * path already stores correctly:
 *
 *  - `YYYY-MM-DDTHH:MM:SS[.frac]+00:00`, fraction digits exactly as sent, when
 *    the input already named a zero offset in that shape. That is almost always
 *    a timestamp read back out of a row, and the copy holds two fraction widths
 *    (Postgres-trimmed imports next to 6-digit D1 defaults) that re-rendering
 *    would stop matching — see encodeValue() in decode.ts;
 *  - the instant in UTC with a `Z`, for every other spelling (a real offset, a
 *    space or `6/15/2026` date, more than six fraction digits, `24:00:00`), which
 *    the codec re-renders the way Postgres prints it.
 *
 * A value without a zone is read in UTC, the session zone Supabase runs in.
 */
export function timestamptzIn(raw: string, now = Date.now()): InputResult {
  const type = "timestamp with time zone";
  const out = parseDateTimeValue(raw, type, now);
  if (out === UNKNOWN) return { value: raw };
  if ("error" in out) return out.error;
  if ("special" in out) {
    if ("literal" in out.special) return { value: out.special.literal };
    return { value: new Date(out.special.ms).toISOString() };
  }
  const { tm } = out;
  if (tm.numericZeroZone && tm.isoDate && tm.plainTime && tm.hour < 24 && tm.sec < 60 && tm.usec < 1_000_000) {
    return { value: `${pad(tm.year, 4)}-${pad(tm.mon, 2)}-${pad(tm.mday, 2)}T${pad(tm.hour, 2)}:${pad(tm.min, 2)}:${pad(tm.sec, 2)}${tm.fracText}+00:00` };
  }
  const base = new Date(0);
  base.setUTCFullYear(tm.year, tm.mon - 1, tm.mday);
  base.setUTCHours(tm.hour, tm.min, tm.sec, 0);
  const wholeSeconds = base.getTime() / 1000 - tm.tz + (tm.usec === 1_000_000 ? 1 : 0);
  const usec = tm.usec === 1_000_000 ? 0 : tm.usec;
  const d = new Date(wholeSeconds * 1000);
  if (d.getUTCFullYear() > 9999 || d.getUTCFullYear() < 1) return { value: raw };
  const frac = usec ? `.${pad(usec, 6).replace(/0+$/, "")}` : "";
  return { value: `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}T${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}${frac}Z` };
}

/* ── arrays ───────────────────────────────────────────────────────────────── */

/**
 * array_in (utils/adt/arrayfuncs.c, Postgres 17 ReadArrayStr/ReadArrayToken):
 * `{a, "b,c", NULL, \d}` → ["a", "b,c", null, "d"]. Unquoted elements lose
 * surrounding whitespace, an unquoted NULL in any case is a null element, a
 * backslash escapes the next character, and nested braces are flattened —
 * which is all `@>` / `<@` / `&&` ever look at. Each element runs through the
 * element type's own input function as it is read, so a bad uuid inside the
 * braces is reported before a syntax error further along, like Postgres.
 *
 * Explicit dimensions (`[1:2]={a,b}`) are valid Postgres that nothing here
 * sends; they are refused loudly rather than guessed at.
 */
export function arrayIn(raw: string, element: (text: string) => InputResult): InputResult {
  const malformed = (details: string) => fail("22P02", `malformed array literal: "${raw}"`, { details });
  const endOfInput = () => malformed("Unexpected end of input.");
  let p = 0;
  while (isSpace(raw[p])) p++;
  if (raw[p] === "[") {
    let q = p + 1;
    while (isSpace(raw[q])) q++;
    if (raw[q] === "+" || raw[q] === "-") q++;
    if (!isDigit(raw[q])) return malformed('"[" must introduce explicitly-specified array dimensions.');
    return fail("PGRST100", "failed to parse request", { details: "d1-adapter: explicit array dimensions are not implemented" });
  }
  if (raw[p] !== "{") return malformed('Array value must start with "{" or dimension information.');

  type Token = { kind: "start" | "end" | "delim" } | { kind: "elem"; text: string } | { kind: "null" } | { error: PostgrestError };
  const readToken = (): Token => {
    for (;;) {
      const c = raw[p];
      if (c === undefined) return endOfInput() as { error: PostgrestError };
      if (c === "{") { p++; return { kind: "start" }; }
      if (c === "}") { p++; return { kind: "end" }; }
      if (c === ",") { p++; return { kind: "delim" }; }
      if (isSpace(c)) { p++; continue; }
      if (c === '"') {
        p++;
        let buf = "";
        for (;;) {
          const d = raw[p];
          if (d === undefined) return endOfInput() as { error: PostgrestError };
          if (d === "\\") {
            p++;
            if (raw[p] === undefined) return endOfInput() as { error: PostgrestError };
            buf += raw[p++];
            continue;
          }
          if (d === '"') {
            p++;
            for (; p < raw.length; p++) {
              if (raw[p] === "," || raw[p] === "}" || raw[p] === "{") return { kind: "elem", text: buf };
              if (!isSpace(raw[p])) return malformed("Incorrectly quoted array element.") as { error: PostgrestError };
            }
            return endOfInput() as { error: PostgrestError };
          }
          buf += d;
          p++;
        }
      }
      let buf = "";
      let keep = 0;             // length without trailing whitespace
      let escaped = false;
      for (;;) {
        const d = raw[p];
        if (d === undefined) return endOfInput() as { error: PostgrestError };
        if (d === "{") return malformed('Unexpected "{" character.') as { error: PostgrestError };
        if (d === '"') return malformed("Incorrectly quoted array element.") as { error: PostgrestError };
        if (d === "\\") {
          p++;
          if (raw[p] === undefined) return endOfInput() as { error: PostgrestError };
          buf += raw[p++];
          keep = buf.length;
          escaped = true;
          continue;
        }
        if (d === "," || d === "}") {
          const text = buf.slice(0, keep);
          return !escaped && asciiLower(text) === "null" ? { kind: "null" } : { kind: "elem", text };
        }
        buf += d;
        if (!isSpace(d)) keep = buf.length;
        p++;
      }
    }
  };

  const values: unknown[] = [];
  const nelems: number[] = [];
  const dim: number[] = [];
  let nest = 0;
  let ndim = 0;
  let frozen = false;
  let expectDelim = false;
  const dimensionError = () => fail("22P02", "multidimensional arrays must have sub-arrays with matching dimensions");
  do {
    const tok = readToken();
    if ("error" in tok) return tok;
    switch (tok.kind) {
      case "start":
        if (expectDelim) return malformed('Unexpected "{" character.');
        if (nest >= 6) return fail("54000", "number of array dimensions exceeds the maximum allowed (6)");
        nelems[nest] = 0;
        nest++;
        if (nest > ndim) {
          if (frozen) return dimensionError();
          ndim = nest;
        }
        break;
      case "end":
        if (nelems[nest - 1] > 0 && !expectDelim) return malformed('Unexpected "}" character.');
        nest--;
        if (nest > 0) nelems[nest - 1]++;
        if (dim[nest] === undefined) dim[nest] = nelems[nest];
        else if (dim[nest] !== nelems[nest]) return dimensionError();
        frozen = true;
        expectDelim = true;
        break;
      case "delim":
        if (!expectDelim) return malformed('Unexpected "," character.');
        expectDelim = false;
        break;
      case "elem":
      case "null": {
        if (expectDelim) return malformed("Unexpected array element.");
        if (tok.kind === "null") {
          values.push(null);
        } else {
          const r = element(tok.text);
          if (isInputError(r)) return r;
          values.push(r.value);
        }
        frozen = true;
        if (nest !== ndim) return dimensionError();
        nelems[nest - 1]++;
        expectDelim = true;
        break;
      }
    }
  } while (nest > 0);
  for (; p < raw.length; p++) if (!isSpace(raw[p])) return malformed("Junk after closing right brace.");
  return { value: values };
}

/* ── jsonb text ───────────────────────────────────────────────────────────── */

/**
 * A JSON number as numeric_out prints it once numeric_in has read its literal:
 * plain digits, never an exponent, and exactly the scale the literal carried
 * (digits after the point minus the exponent, never below zero). So `1e+21` is
 * `1000000000000000000000` and `1.25e-7` is `0.000000125`. This is how jsonb
 * holds every number.
 */
export function numericText(n: number): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(JSON.stringify(n));
  if (!m) return String(n);
  const [, sign, int, frac = "", exponent = "0"] = m;
  const exp = Number(exponent);
  const digits = int + frac;
  const point = int.length + exp;             // where the decimal point falls in `digits`
  const scale = Math.max(0, frac.length - exp);
  let whole: string;
  let fraction = "";
  if (point <= 0) { whole = "0"; fraction = "0".repeat(-point) + digits; }
  else if (point >= digits.length) whole = digits + "0".repeat(point - digits.length);
  else { whole = digits.slice(0, point); fraction = digits.slice(point); }
  whole = whole.replace(/^0+(?=\d)/, "");
  const text = scale ? `${whole}.${fraction}` : whole;
  return sign && /[1-9]/.test(text) ? `-${text}` : text;
}

const utf8 = new TextEncoder();

/** jsonb's key order (jsonb_util.c lengthCompareJsonbString): shorter first, then bytewise. */
function jsonbKeyOrder(a: string, b: string): number {
  const x = utf8.encode(a);
  const y = utf8.encode(b);
  if (x.length !== y.length) return x.length - y.length;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * A JSON value as jsonb prints it (JsonbToCString): object keys in jsonb's
 * order, a space after every `:` and `,`, numbers through numeric_out. Strings
 * escape exactly as JSON.stringify escapes them (escape_json: `"`, `\`, the five
 * short forms and `\u00XX` for the other control characters). A duplicate key
 * never gets here: JSON.parse already kept the last one, as jsonb does.
 */
export function jsonbText(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return numericText(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonbText).join(", ")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort(jsonbKeyOrder).map((k) => `${JSON.stringify(k)}: ${jsonbText(obj[k])}`).join(", ")}}`;
}

/* ── dispatch ─────────────────────────────────────────────────────────────── */

/**
 * One filter operand, as the column's input function would read it. `text`,
 * `jsonb` and a column the registry does not know are handed on untouched.
 */
export function inputValue(raw: string, pg: PgType | undefined, now = Date.now()): InputResult {
  switch (pg) {
    case "uuid": return uuidIn(raw);
    case "boolean": return boolIn(raw);
    case "integer":
    case "bigint": return intIn(raw, pg);
    case "numeric": return numericIn(raw);
    case "date": return dateIn(raw, now);
    case "timestamptz": return timestamptzIn(raw, now);
    case "text[]": return arrayIn(raw, (t) => ({ value: t }));
    case "uuid[]": return arrayIn(raw, uuidIn);
    default: return { value: raw };
  }
}

/**
 * One value of a write payload, as the column's input function would read it.
 *
 * PostgREST never binds a written value itself. It hands the whole body to
 * Postgres as ONE json parameter and json_to_recordset() builds the rows
 * (Query/SqlFragment.hs fromJsonBodyF), and that function gives every column's
 * input function a TEXT (jsonfuncs.c populate_scalar): a JSON string without its
 * quotes, a number or boolean as its literal, an object or array as its JSON
 * text. So a date column refuses the passport OCR's `"29.05.2004"` with the same
 * 22008 a filter gets, an uppercase uuid is stored lowercase, a bare date in a
 * timestamptz column becomes that midnight, and the number 5 in a text column is
 * the text `5`. Binding the JS value instead stored `29.05.2004`, the uppercase
 * uuid, `2026-03-04` and `5.0`.
 *
 * `viaJsonb` is the `Prefer: missing=default` path, where the body is jsonb
 * first: numbers and objects then reach the input function in jsonb's spelling.
 *
 * An array column takes a JSON array element by element, each through the
 * element type's input (populate_array), or a JSON string through array_in.
 * Anything else aimed at an array — a number, an object, a nested array — is
 * handed on untouched: nothing in the codebase sends one, and this module is
 * never stricter than Postgres.
 */
export function writeInput(value: unknown, pg: PgType | undefined, viaJsonb = false, now = Date.now()): InputResult {
  // A Date only reaches here from a hand-built intent; supabase-js would have
  // sent its toJSON() string, and `null` for an Invalid Date.
  if (value instanceof Date) value = Number.isNaN(value.getTime()) ? null : value.toJSON();
  if (value === null || value === undefined) return { value: null };
  if (pg === undefined || pg === "jsonb") return { value };
  const text = (v: unknown): string =>
    typeof v === "string" ? v : viaJsonb ? jsonbText(v) : JSON.stringify(v);
  if (pg === "text[]" || pg === "uuid[]") {
    const element = pg === "uuid[]" ? uuidIn : (t: string): InputResult => ({ value: t });
    if (typeof value === "string") return arrayIn(value, element);
    if (!Array.isArray(value)) return { value };
    const out: unknown[] = [];
    for (const item of value) {
      if (item === null) { out.push(null); continue; }
      if (Array.isArray(item)) return { value };
      const r = element(text(item));
      if (isInputError(r)) return r;
      out.push(r.value);
    }
    return { value: out };
  }
  const raw = text(value);
  return pg === "text" ? { value: raw } : inputValue(raw, pg, now);
}

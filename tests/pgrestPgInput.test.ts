import { describe, it, expect } from "vitest";
import {
  arrayIn, boolIn, dateIn, inputValue, intIn, isInputError, jsonbText, numericIn, numericText, timestamptzIn, uuidIn, writeInput,
  type InputResult,
} from "../lib/d1/pgrest/pgInput";

/**
 * Postgres' type input functions, as the adapter re-implements them for filter
 * operands (lib/d1/pgrest/pgInput.ts).
 *
 * On Supabase a filter value is never interpreted by PostgREST: the column's
 * input function (uuid_in, boolin, int4in, numeric_in, date_in, timestamptz_in,
 * array_in) decides what it means — or answers 22P02 / 22003 / 22007 / 22008 /
 * 22009. Every case in this file was sent to the live project as a filter on a
 * column of that type, and the expectation is what came back: the error body
 * byte for byte, or, for an accepted value, a spelling that matched the same
 * rows. So a failure here is a divergence from Supabase, not a style choice.
 */

const value = (r: InputResult) => {
  if (isInputError(r)) throw new Error(`expected a value, got ${r.error.code}: ${r.error.message}`);
  return r.value;
};
const failure = (r: InputResult) => {
  if (!isInputError(r)) throw new Error(`expected an error, got ${JSON.stringify(r.value)}`);
  return r.error;
};

const DATESTYLE_HINT = 'Perhaps you need a different "datestyle" setting.';
const TS = "timestamp with time zone";

describe("uuid_in", () => {
  const id = "0025a15a-fb41-467a-b723-b87c9da7fdea";

  it("accepts either case, braces, no hyphens, and a hyphen after any group of four", () => {
    expect(value(uuidIn(id.toUpperCase()))).toBe(id);
    expect(value(uuidIn(id.slice(0, 8).toUpperCase() + id.slice(8)))).toBe(id);
    expect(value(uuidIn(`{${id}}`))).toBe(id);
    expect(value(uuidIn(id.replace(/-/g, "")))).toBe(id);
    expect(value(uuidIn("0025-a15a-fb41-467a-b723-b87c-9da7-fdea"))).toBe(id);
  });

  it("refuses everything else, spaces included, quoting the input", () => {
    for (const raw of ["not-a-uuid", ` ${id}`, `${id} `, "", "null", `{${id}`, id.slice(0, 35)]) {
      expect(failure(uuidIn(raw))).toEqual({
        code: "22P02", status: 400, details: null, hint: null, message: `invalid input syntax for type uuid: "${raw}"`,
      });
    }
  });
});

describe("boolin", () => {
  it("accepts prefixes of true/false/yes/no, on/off from two letters, 1 and 0", () => {
    for (const raw of ["TRUE", "tru", "t", "yes", "Y", "on", "1", " true "]) expect(value(boolIn(raw))).toBe(true);
    for (const raw of ["of", "0", "fals", "off", "OFF"]) expect(value(boolIn(raw))).toBe(false);
  });

  it("refuses the rest", () => {
    for (const raw of ["maybe", "", "o", "2", "null", "truex"]) {
      expect(failure(boolIn(raw))).toMatchObject({ code: "22P02", message: `invalid input syntax for type boolean: "${raw}"` });
    }
  });
});

describe("int4in / int8in", () => {
  it("accepts spaces, signs, leading zeros, 0x and _ separators", () => {
    for (const raw of [" 0 ", "+0", "000", "0x0", "0_0", "-0"]) expect(value(intIn(raw, "integer"))).toBe(0);
    expect(value(intIn("-2147483648", "integer"))).toBe(-2147483648);
    expect(value(intIn(" 1 ", "bigint"))).toBe(1);
    // Past 2^53 a bigint stays a decimal string, so it cannot round on the way to D1.
    expect(value(intIn("9007199254740993", "bigint"))).toBe("9007199254740993");
  });

  it("refuses decimals, exponents, words and the empty string (22P02), and overflow (22003)", () => {
    for (const raw of ["abc", "", "0.0", "0e0", "null", "1.5"]) {
      expect(failure(intIn(raw, "integer"))).toMatchObject({ code: "22P02", message: `invalid input syntax for type integer: "${raw}"` });
    }
    expect(failure(intIn("1.0", "bigint")).message).toBe('invalid input syntax for type bigint: "1.0"');
    for (const raw of ["3000000000", "2147483648"]) {
      expect(failure(intIn(raw, "integer"))).toMatchObject({ code: "22003", message: `value "${raw}" is out of range for type integer` });
    }
    expect(failure(intIn("9223372036854775808", "bigint")).message).toBe('value "9223372036854775808" is out of range for type bigint');
  });
});

describe("numeric_in", () => {
  it("accepts the decimal, exponent, hex, separator and non-finite spellings", () => {
    expect(value(numericIn(" 0 "))).toBe(0);
    expect(value(numericIn("0.00"))).toBe(0);
    expect(value(numericIn("1e3"))).toBe(1000);
    expect(value(numericIn(".5"))).toBe(0.5);
    expect(value(numericIn("5."))).toBe(5);
    expect(value(numericIn("0x10"))).toBe(16);
    expect(value(numericIn("1_000"))).toBe(1000);
    // NaN and +Infinity sort above every number in Postgres; as TEXT they sort
    // above every REAL in SQLite, so they travel as text.
    expect(value(numericIn("NaN"))).toBe("NaN");
    expect(value(numericIn("Infinity"))).toBe("Infinity");
    expect(value(numericIn("inf"))).toBe("Infinity");
    expect(value(numericIn("-Infinity"))).toBe(-Number.MAX_VALUE);
  });

  it("refuses words, commas and the empty string", () => {
    for (const raw of ["abc", "", "null", "1,5"]) {
      expect(failure(numericIn(raw))).toMatchObject({ code: "22P02", message: `invalid input syntax for type numeric: "${raw}"` });
    }
  });
});

describe("date_in", () => {
  it("reads the numeric spellings Postgres reads, in its MDY field order", () => {
    const cases: [string, string][] = [
      ["2026-06-15", "2026-06-15"], ["06.15.2026", "2026-06-15"], ["2026-6-15", "2026-06-15"], ["20260615", "2026-06-15"],
      ["06/15/2026", "2026-06-15"], ["2026/06/15", "2026-06-15"], ["  2026-06-15  ", "2026-06-15"], ["6/15/26", "2026-06-15"],
      ["260615", "2026-06-15"], ["2026.06.15", "2026-06-15"], ["2026-06-15,", "2026-06-15"], ["(2026-06-15)", "2026-06-15"],
      ["2026--06-15", "2026-06-15"], ["2024-02-29", "2024-02-29"], ["2000-02-29", "2000-02-29"],
      // A full timestamp is parsed, and its time and zone are then dropped.
      ["2026-06-15T10:00:00Z", "2026-06-15"], ["2026-06-15T23:30:00-05:00", "2026-06-15"],
      // `z` is the UTC zone word, before or after the date.
      ["2026-06-15z", "2026-06-15"], ["z 2026-06-15", "2026-06-15"],
      // After the ISO `T`, hhmm and hhmmss (with a fraction) are a time — not range-checked.
      ["2026-06-15T1030", "2026-06-15"], ["2026-06-15T103000", "2026-06-15"], ["2026-06-15T1030.5", "2026-06-15"],
      ["2026-06-15T103000.5", "2026-06-15"], ["2026-06-15T1099", "2026-06-15"], ["2026-06-15T250000", "2026-06-15"],
    ];
    for (const [raw, iso] of cases) expect(value(dateIn(raw)), raw).toBe(iso);
  });

  it("reads the special words", () => {
    const now = Date.UTC(2026, 8, 13, 22, 30);
    expect(value(dateIn("today", now))).toBe("2026-09-13");
    expect(value(dateIn("epoch", now))).toBe("1970-01-01");
    expect(value(dateIn("infinity", now))).toBe("infinity");
  });

  it("answers every malformed value with Postgres' code, message and hint", () => {
    const cases: [string, string, string | null][] = [
      ["", "22007", null], ["1990", "22007", null], ["not a date", "22007", null], ["null", "22007", null],
      ["2026-06", "22007", null], ["2026-06-15-01", "22007", null], ["2026/06-15", "22007", null], ["12.5", "22007", null],
      ["2026-06-15T", "22007", null], ["10:00", "22007", null],
      ["2026-02-30", "22008", null], ["0000-01-01", "22008", null], ["2026-02-29", "22008", null], ["1900-02-29", "22008", null],
      ["2026-06-15 25:00", "22008", null], ["2026-06-15 10:61", "22008", null], ["2026-06-15 24:00:01", "22008", null],
      // the time overflows before the month is ever validated
      ["2026-13-01 25:00", "22008", null],
      ["29.05.2004", "22008", DATESTYLE_HINT], ["15-06-2026", "22008", DATESTYLE_HINT], ["2026-00-10", "22008", DATESTYLE_HINT],
      ["2026-12-32", "22008", DATESTYLE_HINT], ["70-01-01", "22008", DATESTYLE_HINT], ["2026615", "22008", DATESTYLE_HINT],
      ["2026-06-15 10:00 +16", "22009", null],
      // the zone is decoded before the day-of-month is validated
      ["2026-02-30T10:00:00+16:00", "22009", null],
    ];
    for (const [raw, code, hint] of cases) {
      const e = failure(dateIn(raw));
      const message = code === "22007" ? `invalid input syntax for type date: "${raw}"`
        : code === "22009" ? `time zone displacement out of range: "${raw}"`
          : `date/time field value out of range: "${raw}"`;
      expect(e, raw).toEqual({ code, message, hint, details: null, status: 400 });
    }
  });

  it("refuses a lone letter that is no date word, wherever it stands", () => {
    // Live, every letter but t and z is a 22007 after a date, after a timestamp and
    // before a date; d h j m s y are unit words whose meaning depends on what
    // follows, so only the letters that are no word at all are refused here.
    for (const letter of "abcefgiklnopqruvwx") {
      for (const raw of [`2026-06-15${letter}`, `${letter} 2026-06-15`, `2026-9-12${letter.toUpperCase()}`]) {
        expect(failure(dateIn(raw)), raw).toMatchObject({ code: "22007", message: `invalid input syntax for type date: "${raw}"` });
      }
    }
    // Followed by `+` or a digit the same letter is a zone spec, with another error — left alone.
    expect(value(dateIn("2026-06-15 x+1"))).toBe("2026-06-15 x+1");
  });

  it("refuses a unit letter that labels nothing, and leaves one that may label a number", () => {
    // Live: d h j m s y at the very end are 22007 after a date, a time and an offset.
    for (const unit of "dhjmsy") {
      expect(failure(dateIn(`2026-06-15${unit}`)), unit).toMatchObject({ code: "22007", message: `invalid input syntax for type date: "2026-06-15${unit}"` });
      expect(failure(timestamptzIn(`2026-08-04 15:11:21 ${unit}`)), unit).toMatchObject({ code: "22007" });
      expect(failure(timestamptzIn(`2026-08-04T15:11:21+00:00${unit}  `)), unit).toMatchObject({ code: "22007" });
    }
    // With a field after it, what the letter means depends on that field.
    expect(value(dateIn("j 2026-06-15"))).toBe("j 2026-06-15");
  });

  it("refuses a number after the ISO T that is no hhmm or hhmmss", () => {
    for (const raw of ["2026-06-15T1", "2026-06-15T10", "2026-06-15T103", "2026-06-15T10300", "2026-06-15T1030000", "2026-06-15T10.5"]) {
      expect(failure(dateIn(raw)), raw).toMatchObject({ code: "22007", message: `invalid input syntax for type date: "${raw}"` });
    }
  });

  it("passes through what only Postgres' own tables could judge", () => {
    // Month names, zone names and abbreviations — a guess here would be a validator
    // stricter than Postgres. The adapter hands these on as given.
    expect(value(dateIn("Sep 12 2026"))).toBe("Sep 12 2026");
    expect(value(dateIn("2026-08-04 universal"))).toBe("2026-08-04 universal");
  });
});

describe("timestamptz_in", () => {
  it("keeps a zero-offset ISO spelling in the stored form, fraction digits as sent", () => {
    for (const raw of [
      "2026-08-04 15:11:21.452251+00:00", "2026-08-04T15:11:21.452251+0000", "2026-08-04T15:11:21.452251+00",
      "2026-08-04T15:11:21.452251-00:00", "2026-08-04t15:11:21.452251+00:00", " 2026-08-04T15:11:21.452251+00:00 ",
    ]) {
      expect(value(timestamptzIn(raw)), raw).toBe("2026-08-04T15:11:21.452251+00:00");
    }
  });

  it("re-spells every other form as the same instant in UTC", () => {
    const cases: [string, string][] = [
      ["2026-08-04t15:11:21.452251z", "2026-08-04T15:11:21.452251Z"],
      ["2026-08-04T17:11:21.452251+02:00", "2026-08-04T15:11:21.452251Z"],
      ["2026-08-04T17:11:21.452251 +02", "2026-08-04T15:11:21.452251Z"],
      ["2026-08-04T17:11:21.452251+0200", "2026-08-04T15:11:21.452251Z"],
      ["2026-08-04T14:11:21.452251-01", "2026-08-04T15:11:21.452251Z"],
      // more than six fraction digits round half to even, like rint()
      ["2026-08-04T15:11:21.4522514Z", "2026-08-04T15:11:21.452251Z"],
      ["2026-08-04T15:11:21.4522506Z", "2026-08-04T15:11:21.452251Z"],
      // no zone = the session zone, UTC on Supabase
      ["8/4/2026 15:11:21.452251", "2026-08-04T15:11:21.452251Z"],
      ["20260804 15:11:21.452251", "2026-08-04T15:11:21.452251Z"],
      ["2026-08-04T15:11:21.452251", "2026-08-04T15:11:21.452251Z"],
      ["2026-08-04", "2026-08-04T00:00:00Z"],
      ["2026-08-04T24:00:00Z", "2026-08-05T00:00:00Z"],
      // the ISO T followed by hhmm / hhmmss, whose parts nothing range-checks
      ["2026-08-04T1030", "2026-08-04T10:30:00Z"],
      ["2026-08-04T1099", "2026-08-04T11:39:00Z"],
      ["2026-08-04T250000", "2026-08-05T01:00:00Z"],
      ["2026-08-04T103000.5", "2026-08-04T10:30:00.5Z"],
    ];
    for (const [raw, iso] of cases) expect(value(timestamptzIn(raw)), raw).toBe(iso);
    expect(Date.parse(String(value(timestamptzIn("epoch"))))).toBe(0);
  });

  it("answers malformed timestamps with Postgres' code, message and hint", () => {
    const cases: [string, string, string | null][] = [
      ["not-a-date", "22007", null], ["", "22007", null], ["null", "22007", null], ["10:00", "22007", null],
      ["2026-08-04T15:11:21.452251+00:00x", "22007", null], ["2026-08-04 15:11:21 a", "22007", null],
      ["2026-08-04T1", "22007", null], ["2026-08-04T10", "22007", null], ["2026-08-04T10.5", "22007", null],
      ["Invalid Date", "22007", null],
      ["2026-02-30T00:00:00Z", "22008", null], ["2026-13-01T00:00:00Z", "22008", DATESTYLE_HINT],
      ["2026-08-04T15:11:21+15:60", "22009", null], ["2026-08-04 15:11 +16", "22009", null],
      ["2026-08-04T15:11:20.452251+00:00:-1", "22009", null],
    ];
    for (const [raw, code, hint] of cases) {
      const message = code === "22007" ? `invalid input syntax for type ${TS}: "${raw}"`
        : code === "22009" ? `time zone displacement out of range: "${raw}"`
          : `date/time field value out of range: "${raw}"`;
      expect(failure(timestamptzIn(raw)), raw).toEqual({ code, message, hint, details: null, status: 400 });
    }
  });

  it("refuses what a Date object turns into on the Worker, and nothing it cannot judge", () => {
    // `.eq("uploaded_at", new Date(0))` sends String(date); live that is a 22007.
    for (const raw of [
      "Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)",
      "Sat Feb 29 2020 23:59:59 GMT+0000 (Coordinated Universal Time)",
    ]) {
      expect(failure(timestamptzIn(raw))).toMatchObject({ code: "22007", message: `invalid input syntax for type ${TS}: "${raw}"` });
    }
    // Elsewhere the zone name differs and GMT+0530 even makes it a 22023 (live):
    // that needs Postgres' zone tables, so it is handed on untouched.
    const india = "Tue Aug 04 2026 20:41:21 GMT+0530 (India Standard Time)";
    expect(value(timestamptzIn(india))).toBe(india);
  });
});

describe("array_in", () => {
  const text = (raw: string) => arrayIn(raw, (t) => ({ value: t }));

  it("reads elements the way Postgres does", () => {
    expect(value(text('{a, "b,c", NULL, \\d}'))).toEqual(["a", "b,c", null, "d"]);
    expect(value(text("{{langcert}}"))).toEqual(["langcert"]);       // nesting flattens
    expect(value(text("{ }"))).toEqual([]);
    expect(value(text("{}"))).toEqual([]);
    expect(value(text('{"",langcert}'))).toEqual(["", "langcert"]);
    expect(value(text("{lang\\cert}"))).toEqual(["langcert"]);
    expect(value(text(" {langcert} "))).toEqual(["langcert"]);
    expect(value(text("{null}"))).toEqual([null]);
    expect(value(text('{"NULL"}'))).toEqual(["NULL"]);
  });

  it("words a malformed literal the way Postgres words it", () => {
    const cases: [string, string][] = [
      ["{a", "Unexpected end of input."], ["{a}x", "Junk after closing right brace."], ['{"a}', "Unexpected end of input."],
      ['{a"b}', "Incorrectly quoted array element."], ["{langcert,}", 'Unexpected "}" character.'],
      ["%Noten%", 'Array value must start with "{" or dimension information.'],
    ];
    for (const [raw, details] of cases) {
      expect(failure(text(raw)), raw).toEqual({ code: "22P02", message: `malformed array literal: "${raw}"`, details, hint: null, status: 400 });
    }
  });

  it("types each element with the element type's input function", () => {
    expect(failure(arrayIn("{not-a-uuid}", uuidIn)).message).toBe('invalid input syntax for type uuid: "not-a-uuid"');
    expect(value(arrayIn("{0025A15A-FB41-467A-B723-B87C9DA7FDEA}", uuidIn))).toEqual(["0025a15a-fb41-467a-b723-b87c9da7fdea"]);
  });

  it("refuses explicit dimensions by name rather than guessing", () => {
    expect(failure(text("[1:2]={a,b}"))).toMatchObject({ code: "PGRST100" });
  });
});

describe("inputValue", () => {
  it("dispatches by column type and hands text and jsonb on untouched", () => {
    expect(value(inputValue(" Ali ", "text"))).toBe(" Ali ");
    expect(value(inputValue('{"a":1}', "jsonb"))).toBe('{"a":1}');
    expect(value(inputValue("x", undefined))).toBe("x");
    expect(value(inputValue("{a,b}", "text[]"))).toEqual(["a", "b"]);
    expect(value(inputValue("YES", "boolean"))).toBe(true);
  });
});

/**
 * Write payloads. PostgREST hands the body to json_to_recordset(), which gives
 * each column's input function a TEXT (jsonfuncs.c populate_scalar): a JSON
 * string unquoted, a number or boolean as its literal, an object as its JSON
 * text. The input functions are the ones proven above against live filters; what
 * these tests pin is the JSON → text step in front of them.
 */
describe("writeInput", () => {
  it("reads a JSON number or boolean as its literal, so the input function sees `2.5` and `true`", () => {
    expect(failure(writeInput(2.5, "integer"))).toEqual({ code: "22P02", message: 'invalid input syntax for type integer: "2.5"', details: null, hint: null, status: 400 });
    expect(failure(writeInput(3000000000, "integer"))).toMatchObject({ code: "22003", message: 'value "3000000000" is out of range for type integer' });
    expect(failure(writeInput(true, "integer")).message).toBe('invalid input syntax for type integer: "true"');
    expect(value(writeInput("7", "integer"))).toBe(7);
    expect(failure(writeInput(5, "uuid")).message).toBe('invalid input syntax for type uuid: "5"');
    expect(failure(writeInput(2, "boolean")).message).toBe('invalid input syntax for type boolean: "2"');
    expect(value(writeInput(1, "boolean"))).toBe(true);
    expect(value(writeInput("yes", "boolean"))).toBe(true);
    expect(value(writeInput(250.5, "numeric"))).toBe(250.5);
    expect(failure(writeInput(true, "numeric")).message).toBe('invalid input syntax for type numeric: "true"');
  });

  it("stores the text Postgres stores in a text column", () => {
    expect(value(writeInput(5, "text"))).toBe("5");
    expect(value(writeInput(2.5, "text"))).toBe("2.5");
    expect(value(writeInput(true, "text"))).toBe("true");
    expect(value(writeInput({ a: 1, b: [1, "x"] }, "text"))).toBe('{"a":1,"b":[1,"x"]}');
    expect(value(writeInput(" Ali ", "text"))).toBe(" Ali ");
  });

  it("refuses what date_in / timestamptz_in / uuid_in refuse, and respells what they accept", () => {
    expect(failure(writeInput("29.05.2004", "date"))).toMatchObject({ code: "22008", message: 'date/time field value out of range: "29.05.2004"' });
    expect(failure(writeInput("", "date"))).toMatchObject({ code: "22007", message: 'invalid input syntax for type date: ""' });
    expect(value(writeInput("2026-9-4", "date"))).toBe("2026-09-04");
    expect(value(writeInput(20260904, "date"))).toBe("2026-09-04");
    expect(value(writeInput("2026-03-04", "timestamptz"))).toBe("2026-03-04T00:00:00Z");
    expect(failure(writeInput("not a date", "timestamptz")).message).toBe(`invalid input syntax for type ${TS}: "not a date"`);
    expect(value(writeInput("0025A15A-FB41-467A-B723-B87C9DA7FDEA", "uuid"))).toBe("0025a15a-fb41-467a-b723-b87c9da7fdea");
    // A timestamp read back out of a row keeps its own fraction digits.
    expect(value(writeInput("2026-09-11T17:25:01.155000+00:00", "timestamptz"))).toBe("2026-09-11T17:25:01.155000+00:00");
  });

  it("types an array column element by element, or through array_in for a string", () => {
    expect(value(writeInput(["0025A15A-FB41-467A-B723-B87C9DA7FDEA", null], "uuid[]"))).toEqual(["0025a15a-fb41-467a-b723-b87c9da7fdea", null]);
    expect(failure(writeInput(["x"], "uuid[]")).message).toBe('invalid input syntax for type uuid: "x"');
    expect(value(writeInput([5, true, "a", null], "text[]"))).toEqual(["5", "true", "a", null]);
    expect(value(writeInput("{a,b}", "text[]"))).toEqual(["a", "b"]);
    // Shapes nothing here sends are handed on as they came, never refused.
    expect(value(writeInput([["a"]], "text[]"))).toEqual([["a"]]);
    expect(value(writeInput(5, "text[]"))).toBe(5);
  });

  it("leaves jsonb, NULL and a column the registry does not know alone", () => {
    const doc = { langs: [{ name: "Deutsch" }] };
    expect(value(writeInput(doc, "jsonb"))).toBe(doc);
    expect(value(writeInput(null, "uuid"))).toBe(null);
    expect(value(writeInput(undefined, "date"))).toBe(null);
    expect(value(writeInput(7, undefined))).toBe(7);
  });

  it("reads a Date the way supabase-js would have sent it", () => {
    expect(value(writeInput(new Date("2026-09-11T17:25:01.155Z"), "timestamptz"))).toBe("2026-09-11T17:25:01.155Z");
    expect(value(writeInput(new Date("nope"), "timestamptz"))).toBe(null);
  });

  it("under missing=default reads numbers and objects in jsonb's spelling", () => {
    expect(value(writeInput(1e21, "text", true))).toBe("1000000000000000000000");
    expect(value(writeInput({ bb: 1, a: [1, 2] }, "text", true))).toBe('{"a": [1, 2], "bb": 1}');
    expect(failure(writeInput(1e21, "integer", true)).code).toBe("22003");
    expect(failure(writeInput(1e21, "integer")).code).toBe("22P02");
  });
});

describe("jsonb text", () => {
  it("prints a number through numeric_out: no exponent, the literal's own scale", () => {
    expect(numericText(0.5)).toBe("0.5");
    expect(numericText(100)).toBe("100");
    expect(numericText(-0.001)).toBe("-0.001");
    expect(numericText(1e21)).toBe("1000000000000000000000");
    expect(numericText(1.25e-7)).toBe("0.000000125");
    expect(numericText(-0)).toBe("0");
    expect(numericText(5e-324)).toBe(`0.${"0".repeat(323)}5`);
  });

  it("orders keys shortest first, then bytewise, with jsonb's spacing", () => {
    expect(jsonbText({ bb: 1, a: 2, "é": 3, c: null })).toBe('{"a": 2, "c": null, "bb": 1, "é": 3}');
    expect(jsonbText([true, "x\ny", {}])).toBe('[true, "x\\ny", {}]');
  });
});

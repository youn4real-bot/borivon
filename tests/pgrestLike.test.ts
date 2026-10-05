import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import {
  buildSql, isPostgrestError, ilikeFold, likeSegments, likeSql, utf8Bytes, D1_MAX_PATTERN_BYTES,
} from "../lib/d1/pgrest/buildSql";
import type { BuiltQuery, Condition, Group, QueryIntent, Registry } from "../lib/d1/pgrest/types";

/**
 * `like` / `ilike` on D1, which differs from Postgres in two ways that silently
 * change answers:
 *
 *  1. SQLite's LIKE folds ASCII only, Postgres' ILIKE every letter — so
 *     `ilike.%NOTENÜBERSICHT%` found 45 documents on Supabase and none here.
 *  2. D1 refuses any LIKE or GLOB pattern over 50 bytes, so a 53-byte document
 *     label search was a 500 here and 4 rows on Supabase.
 *
 * The behaviour tests run the generated SQL in a real SQLite and compare every
 * answer with an independent port of Postgres' LIKE matcher (like_match.c),
 * over thousands of generated patterns — both through the plain LIKE/GLOB form
 * and through the substr() form long patterns take. Local SQLite has no 50-byte
 * limit, so that limit is checked structurally: no pattern the adapter binds to
 * LIKE or GLOB may exceed it. tests/d1FilterParity.test.ts proves the same
 * shapes against the real D1 and the live project.
 */

const registry: Registry = JSON.parse(fs.readFileSync("d1/types.json", "utf8"));

/* ── reference: Postgres' LIKE / ILIKE ───────────────────────────────────── */

/** Postgres lowercases one character to one character; a longer mapping leaves it alone. */
const lowerEach = (s: string) => Array.from(s).map((c) => (Array.from(c.toLowerCase()).length === 1 ? c.toLowerCase() : c)).join("");

/**
 * like_match.c's semantics: `%` any run, `_` one character, a backslash makes the
 * next character literal. A pattern ending in a lone backslash never matches
 * (Postgres raises 22025 or answers false, depending on the plan). ILIKE
 * lowercases both sides first.
 */
function pgLike(text: string, pattern: string, caseInsensitive: boolean): boolean {
  const t = Array.from(caseInsensitive ? lowerEach(text) : text);
  const p = Array.from(caseInsensitive ? lowerEach(pattern) : pattern);
  const memo = new Map<number, boolean>();
  const match = (i: number, j: number): boolean => {
    const key = i * 1000 + j;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r: boolean;
    if (j === p.length) r = i === t.length;
    else if (p[j] === "%") r = match(i, j + 1) || (i < t.length && match(i + 1, j));
    else if (i === t.length) r = false;
    else if (p[j] === "_") r = match(i + 1, j + 1);
    else if (p[j] === "\\") r = j + 1 < p.length && t[i] === p[j + 1] && match(i + 1, j + 2);
    else r = t[i] === p[j] && match(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return match(0, 0);
}

/** Deterministic PRNG, so a failure reproduces. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── the adapter's SQL, inspected ────────────────────────────────────────── */

/** Every bound value the SQL hands to LIKE or GLOB as its pattern. */
function likePatterns(q: BuiltQuery): string[] {
  const out: string[] = [];
  let n = 0;
  for (let i = 0; i < q.sql.length; i++) {
    if (q.sql[i] !== "?") continue;
    if (/(LIKE|GLOB)\s*$/.test(q.sql.slice(0, i))) out.push(String(q.params[n]));
    n++;
  }
  expect(n).toBe(q.params.length);
  return out;
}

const intent = (where: QueryIntent["where"]): QueryIntent =>
  ({ action: "select", table: "documents", select: [{ column: "id" }], where, order: [], returning: "representation" });
const cmp = (op: "like" | "ilike", value: unknown, negate = false, quant?: "any" | "all"): Condition =>
  ({ kind: "cmp", column: "file_type", op, value, ...(negate ? { negate: true } : {}), ...(quant ? { quant } : {}) });
function built(i: QueryIntent): BuiltQuery {
  const r = buildSql(i, registry);
  if (isPostgrestError(r)) throw new Error(`unexpected ${r.code}: ${r.details ?? r.message}`);
  return r;
}

describe("ilikeFold", () => {
  it("lowers the pattern's non-ASCII letters and folds the column's upper forms of exactly those", () => {
    expect(ilikeFold(`"c"`, "%NOTENÜBERSICHT%")).toEqual({ column: `replace("c", char(220), char(252))`, pattern: "%NOTENüBERSICHT%" });
    // A lowercase letter in the pattern still folds the column: `é` must find `É`.
    expect(ilikeFold(`"c"`, "%é%")).toEqual({ column: `replace("c", char(201), char(233))`, pattern: "%é%" });
    // ASCII is LIKE's own business, so nothing is added for it.
    expect(ilikeFold(`"c"`, "%pass%")).toEqual({ column: `"c"`, pattern: "%pass%" });
  });

  it("maps one character to one, as Postgres does: ẞ folds to ß, SS never does", () => {
    expect(ilikeFold(`"c"`, "%ß%")).toEqual({ column: `replace("c", char(7838), char(223))`, pattern: "%ß%" });
    expect(ilikeFold(`"c"`, "%Ω%")!.column).toBe(`replace(replace("c", char(937), char(969)), char(8486), char(969))`);
  });

  it("gives up past the replace() nesting a D1 statement can hold", () => {
    expect(ilikeFold(`"c"`, "абвгдежзийклмнопрстуфхцчшщъыьэюяαβγδεζηθ")).toBeNull();
  });
});

describe("likeSegments", () => {
  it("splits at % runs, resolves escapes and measures in characters", () => {
    expect(likeSegments("%a_b\\%cü%%")).toEqual([
      { literals: [], length: 0 },
      { literals: [{ text: "a", offset: 0, length: 1 }, { text: "b%cü", offset: 2, length: 4 }], length: 6 },
      { literals: [], length: 0 },
    ]);
    expect(likeSegments("\\\\")).toEqual([{ literals: [{ text: "\\", offset: 0, length: 1 }], length: 1 }]);
    expect(likeSegments("")).toEqual([{ literals: [], length: 0 }]);
  });

  it("returns null for a pattern ending in a lone escape", () => {
    expect(likeSegments("noten\\")).toBeNull();
    expect(likeSegments("%\\")).toBeNull();
  });
});

describe("D1's 50-byte pattern limit", () => {
  it("counts UTF-8 bytes", () => {
    expect([utf8Bytes("a"), utf8Bytes("ü"), utf8Bytes("€"), utf8Bytes("😀")]).toEqual([1, 2, 3, 4]);
    expect(D1_MAX_PATTERN_BYTES).toBe(50);
  });

  it("never binds a LIKE or GLOB pattern D1 would refuse", () => {
    const label = "Certificat d'exercice de la profession infirmière";
    const patterns = [
      "%pass%", `%${label}%`, `%${label.toUpperCase()}%`, label, `${label}%`, `%${label}`, "%" + "x".repeat(60) + "%",
      `${"a".repeat(40)}\\_long.name@example-hospital.de`, "%" + "ü".repeat(26) + "%", "%N_TEN%BERS_CHT%" + "%".repeat(40),
      "%" + "*?[".repeat(20) + "%", "ü".repeat(25),
    ];
    for (const pattern of patterns) {
      for (const op of ["like", "ilike"] as const) {
        for (const q of [
          built(intent([cmp(op, pattern)])),
          built(intent([cmp(op, pattern, true)])),
          built(intent([cmp(op, [pattern, "%x%"], false, "any")])),
          built(intent([{ kind: "or", children: [cmp(op, pattern), cmp(op, "%y%")] }])),
        ]) {
          for (const bound of likePatterns(q)) expect(utf8Bytes(bound), `${op} ${pattern}`).toBeLessThanOrEqual(D1_MAX_PATTERN_BYTES);
        }
      }
    }
    // A pattern that fits keeps the plain, index-friendly form.
    expect(built(intent([cmp("ilike", "%pass%")])).sql).toBe(`SELECT "id" FROM "documents" WHERE "file_type" LIKE ? ESCAPE '\\'`);
    expect(built(intent([cmp("like", "%pass%")])).sql).toBe(`SELECT "id" FROM "documents" WHERE "file_type" GLOB ?`);
    // 25 × ü is exactly 50 bytes and still plain; one more character is not.
    expect(built(intent([cmp("like", "ü".repeat(25))])).sql).toMatch(/GLOB \?$/);
    expect(built(intent([cmp("like", "ü".repeat(25) + "a")])).sql).not.toMatch(/GLOB|LIKE/);
  });

  it("refuses by name only a hand-built pattern nothing here sends", () => {
    // Seven middle segments nest past D1's expression depth (measured: six run,
    // seven fail). Every search in the codebase has at most one.
    for (const op of ["like", "ilike"] as const) {
      const seven = buildSql(intent([cmp(op, "%a%b%c%d%e%f%g%" + "x".repeat(50))]), registry);
      expect(isPostgrestError(seven) && seven.details, op).toMatch(/^d1-adapter: a LIKE pattern over 50 bytes/);
      expect(isPostgrestError(buildSql(intent([cmp(op, "%a%b%c%d%e%f%" + "x".repeat(50))]), registry)), op).toBe(false);
    }
    // …and a short pattern with any number of wildcards stays plain LIKE / GLOB.
    expect(isPostgrestError(buildSql(intent([cmp("ilike", "%a%b%c%d%e%f%g%h%i%j%")]), registry))).toBe(false);
  });
});

type Row = Record<string, unknown>;
type Stmt = { run(...a: unknown[]): unknown; all(...a: unknown[]): Row[] };
type Db = { exec(sql: string): void; prepare(sql: string): Stmt };
let DatabaseSync: (new (path: string) => Db) | null = null;
try { ({ DatabaseSync } = await import("node:sqlite") as unknown as { DatabaseSync: new (path: string) => Db }); }
catch { /* older Node without node:sqlite — the structural tests above still run */ }

describe.skipIf(!DatabaseSync)("matches exactly what Postgres matches", () => {
  let db: Db;
  const texts: (string | null)[] = [];

  beforeAll(() => {
    db = new DatabaseSync!(":memory:");
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT)`);
    const rand = mulberry32(7);
    const alphabet = ["a", "A", "b", "B", "ü", "Ü", "é", "É", "ß", "%", "_", "\\", "*", "?", "[", " ", "'"];
    texts.push(null, "", "%", "_", "\\", "Straße", "STRASSE", "ẞ");
    while (texts.length < 90) {
      let s = "";
      const len = Math.floor(rand() * 9);
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
      texts.push(s);
    }
    const insert = db.prepare(`INSERT INTO t (id, s) VALUES (?, ?)`);
    texts.forEach((s, i) => insert.run(i, s));
  });

  /** Row ids where `s <op> pattern` is true, and where its negation is — NULL rows in neither. */
  function run(pattern: string, caseInsensitive: boolean, maxPatternBytes?: number) {
    const frag = likeSql(`"s"`, pattern, caseInsensitive, maxPatternBytes);
    if ("code" in frag) throw new Error(`${frag.code}: ${frag.details}`);
    const ids = (where: string) => db.prepare(`SELECT id FROM t WHERE ${where} ORDER BY id`).all(...(frag.params as never[])).map((r) => Number(r.id));
    return { yes: ids(frag.sql), no: ids(`NOT (${frag.sql})`) };
  }
  function expected(pattern: string, caseInsensitive: boolean) {
    const yes: number[] = [];
    const no: number[] = [];
    texts.forEach((s, i) => { if (s !== null) (pgLike(s, pattern, caseInsensitive) ? yes : no).push(i); });
    return { yes, no };
  }

  it("on generated patterns, through both the plain and the substr() form", () => {
    const rand = mulberry32(42);
    const alphabet = ["a", "A", "b", "ü", "Ü", "é", "É", "ß", "%", "%", "_", "_", "\\", "*", "?", "[", " "];
    for (let n = 0; n < 1200; n++) {
      let pattern = "";
      const len = Math.floor(rand() * 8);
      for (let i = 0; i < len; i++) pattern += alphabet[Math.floor(rand() * alphabet.length)];
      for (const caseInsensitive of [false, true]) {
        const want = expected(pattern, caseInsensitive);
        expect(run(pattern, caseInsensitive), `${caseInsensitive ? "ilike" : "like"} ${JSON.stringify(pattern)}`).toEqual(want);
        expect(run(pattern, caseInsensitive, 0), `${caseInsensitive ? "ilike" : "like"} ${JSON.stringify(pattern)} as substr`).toEqual(want);
      }
    }
  });

  it("on the shapes the codebase sends", () => {
    for (const pattern of ["%ü%", "%Ü%", "%STRASSE%", "%straße%", "%A\\_%", "a%", "%é", "%\\%%", "%\\\\%", "ab\\", "%", "", "%_%", "%a%b%", "_Ü_"]) {
      for (const caseInsensitive of [false, true]) {
        const want = expected(pattern, caseInsensitive);
        expect(run(pattern, caseInsensitive), pattern).toEqual(want);
        expect(run(pattern, caseInsensitive, 0), `${pattern} as substr`).toEqual(want);
      }
    }
  });
});

describe.skipIf(!DatabaseSync)("German and French documents, through buildSql", () => {
  let db: Db;
  const labels: Record<string, string | null> = {
    a: "Abitur Notenübersicht", b: "Notenübersicht (DE)", c: "Diplôme Infirmier", d: "Baccalauréat",
    e: "Relevé de notes du Baccalauréat", f: "Expérience professionnelle", g: "Certificat d'exercice de la profession infirmière",
    h: "Straße", i: "Ärztliche Bescheinigung", j: "Passeport", k: "Notenubersicht", l: null,
  };
  const ids = (q: QueryIntent) => {
    const b = built(q);
    return db.prepare(b.sql).all(...(b.params as never[])).map((r) => String(r.id)).sort();
  };

  beforeAll(() => {
    db = new DatabaseSync!(":memory:");
    db.exec(fs.readFileSync("d1/schema.sql", "utf8"));
    const doc = db.prepare(`INSERT INTO documents (id, user_id, file_name, file_path, file_type) VALUES (?, 'u', 'f', 'p', ?)`);
    for (const [id, label] of Object.entries(labels)) doc.run(id, label);
  });

  it("folds umlauts and accents in either direction", () => {
    expect(ids(intent([cmp("ilike", "%NOTENÜBERSICHT%")]))).toEqual(["a", "b"]);
    expect(ids(intent([cmp("ilike", "%notenÜbersicht%")]))).toEqual(["a", "b"]);
    expect(ids(intent([cmp("ilike", "%DIPLÔME%")]))).toEqual(["c"]);
    expect(ids(intent([cmp("ilike", "%BACCALAURÉAT%")]))).toEqual(["d", "e"]);
    expect(ids(intent([cmp("ilike", "%ÄRZTLICHE%")]))).toEqual(["i"]);
    expect(ids(intent([cmp("ilike", "%ÉXPERIENCE%")]))).toEqual([]);
    // One character to one: ß is not SS.
    expect(ids(intent([cmp("ilike", "%STRASSE%")]))).toEqual([]);
    // not.ilike leaves the NULL label out, as NOT(NULL) does in Postgres.
    expect(ids(intent([cmp("ilike", "%NOTENÜBERSICHT%", true)]))).toEqual(["c", "d", "e", "f", "g", "h", "i", "j", "k"]);
    // The .or() form of the admin search.
    const or: Group = { kind: "or", children: [cmp("ilike", "%DIPLÔME%"), cmp("ilike", "%BACCALAURÉAT%")] };
    expect(ids(intent([or]))).toEqual(["c", "d", "e"]);
  });

  it("keeps ASCII folding, escapes and wildcards", () => {
    // `_` is any one character — the ASCII `u` of "Notenubersicht" too.
    expect(ids(intent([cmp("ilike", "%NOTEN_BERSICHT%")]))).toEqual(["a", "b", "k"]);
    expect(ids(intent([cmp("ilike", "%noten\\_bersicht%")]))).toEqual([]);
    expect(ids(intent([cmp("ilike", "PASS%")]))).toEqual(["j"]);
    expect(ids(intent([cmp("like", "PASS%")]))).toEqual([]);
  });

  it("answers long patterns instead of failing", () => {
    const label = "Certificat d'exercice de la profession infirmière";
    expect(ids(intent([cmp("ilike", `%${label.toUpperCase()}%`)]))).toEqual(["g"]);
    expect(ids(intent([cmp("like", `%${label}%`)]))).toEqual(["g"]);
    expect(ids(intent([cmp("like", `%${label.toUpperCase()}%`)]))).toEqual([]);
    expect(ids(intent([cmp("ilike", label.replace("'", "\\'"))]))).toEqual(["g"]);
    expect(ids(intent([cmp("ilike", `${"%".repeat(50)}ÜBERSICHT`)]))).toEqual(["a"]);
    expect(ids(intent([cmp("ilike", `ABITUR${"%".repeat(50)}`)]))).toEqual(["a"]);
    expect(ids(intent([cmp("ilike", `%N_TEN%BERS_CHT${"%".repeat(50)}`)]))).toEqual(["a", "b", "k"]);
    expect(ids(intent([cmp("ilike", [`%${label}%`, "%pass%"], false, "any")]))).toEqual(["g", "j"]);
    expect(ids(intent([cmp("ilike", `%${label}%`, true)]))).toEqual(["a", "b", "c", "d", "e", "f", "h", "i", "j", "k"]);
  });
});

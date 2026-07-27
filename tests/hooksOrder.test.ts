import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * REACT #310 GUARD — "rendered more hooks than during the previous render".
 *
 * This shipped to production and killed the whole Batch Tracker page: three
 * hooks (useSensors + two useSensor + a useCallback) sat AFTER
 * `if (loading) return <PageLoader />`. The first render, while loading, ran
 * fewer hooks than the second — so the page exploded the instant its data
 * arrived. Type-checking cannot see it, the tests didn't cover it, and this
 * project has no ESLint config, so `react-hooks/rules-of-hooks` never ran.
 *
 * So the rule lives here instead: inside one component body, no hook may appear
 * after a conditional early return.
 *
 * Deliberately conservative — it only inspects statements at the TOP level of a
 * function body (brace depth 1). Hooks inside a nested component, a callback or
 * a block are somebody else's scope and are skipped, which is what keeps this
 * free of the false positives a naive line scan produces.
 */

const HOOK = /\b(useState|useEffect|useLayoutEffect|useMemo|useCallback|useRef|useReducer|useContext|useSensors|useSensor|useTransition|useDeferredValue|useId|useSyncExternalStore)\s*\(/;
/** `if (cond) return …` / `if (cond) { return … }` — a guard, not the final return. */
const EARLY_RETURN = /^\s*if\s*\(.+\)\s*(\{\s*)?return\b/;
/** Start of a component-ish function body we should walk. */
const FN_START = /^(export\s+)?(default\s+)?(async\s+)?function\s+[A-Z]\w*\s*\(|^(export\s+)?const\s+[A-Z]\w*\s*[:=].*(\(|=>)/;

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return filesUnder(p);
    return e.isFile() && p.endsWith(".tsx") ? [p] : [];
  });
}

/** Offences as "file:line — hook after the early return on line N". */
export function findHooksAfterEarlyReturn(source: string, file = "<src>"): string[] {
  const lines = source.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!FN_START.test(lines[i])) continue;

    // Walk this function body, tracking brace depth from its opening line.
    let depth = 0, started = false, guard = 0;
    for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      const code = line.replace(/\/\/.*$/, "");

      if (started && depth === 1) {
        if (!guard && EARLY_RETURN.test(code)) guard = j + 1;
        else if (guard && HOOK.test(code)) {
          out.push(`${file}:${j + 1} — hook after the early return on line ${guard}`);
          break;
        }
      }

      for (const ch of code) {
        if (ch === "{") { depth++; started = true; }
        else if (ch === "}") depth--;
      }
      if (started && depth === 0) { i = j; break; }   // function ended
    }
  }
  return out;
}

describe("react hooks order — the #310 guard", () => {
  it("catches the exact shape that took down the Batch Tracker", () => {
    const broken = `
export default function TrackerPage() {
  const [loading, setLoading] = useState(true);
  const members = useMemo(() => [], []);

  if (loading) return <PageLoader />;

  const sensors = useSensors(useSensor(PointerSensor));
  return <div />;
}`;
    const hits = findHooksAfterEarlyReturn(broken, "broken.tsx");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toContain("hook after the early return");
  });

  it("does not flag hooks that all run before the guard", () => {
    const ok = `
export default function TrackerPage() {
  const [loading, setLoading] = useState(true);
  const sensors = useSensors(useSensor(PointerSensor));

  if (loading) return <PageLoader />;

  return <div />;
}`;
    expect(findHooksAfterEarlyReturn(ok, "ok.tsx")).toEqual([]);
  });

  it("does not flag a SEPARATE component later in the same file", () => {
    // The naive line-scan version of this check drowned in these.
    const twoComponents = `
export default function Page() {
  const [a, setA] = useState(0);
  if (!a) return null;
  return <Child />;
}

function Child() {
  const [b, setB] = useState(0);
  return <div>{b}</div>;
}`;
    expect(findHooksAfterEarlyReturn(twoComponents, "two.tsx")).toEqual([]);
  });

  it("EVERY component in app/ and components/ obeys the rule", () => {
    const offences = [...filesUnder("app"), ...filesUnder("components")]
      .flatMap((f) => findHooksAfterEarlyReturn(fs.readFileSync(f, "utf8"), f));
    expect(offences, `\n${offences.join("\n")}\n`).toEqual([]);
  });
});

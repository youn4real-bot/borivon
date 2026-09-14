/**
 * Arguments of d1/parity-check.mjs, parsed where a test can reach them (the
 * check itself runs on import against the live databases).
 *
 *   node d1/parity-check.mjs <repo-root> [table…] [--ignore=table.column,…]
 *
 * --ignore exists for ONE caller: the rollback gate in d1/cutover.mjs. After a
 * journal replay, a few columns legitimately differ between D1 and Supabase
 * because Supabase recomputes them itself (a BEFORE UPDATE trigger stamping
 * updated_at with the replay time) — see REPLAY_RECOMPUTED in
 * d1/replay-journal.mjs. Without it the gate could never pass after any
 * employer edit; with a blanket "ignore timestamps" it could pass with real
 * losses. So it names exact columns, and the check prints each one it skipped.
 */
export function parseParityArgs(argv) {
  const [root, ...rest] = argv;
  const ignore = new Set();
  const only = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--ignore" || a.startsWith("--ignore=")) {
      const raw = a === "--ignore" ? (rest[++i] ?? "") : a.slice("--ignore=".length);
      for (const c of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(c)) throw new Error(`--ignore takes table.column, got "${c}"`);
        ignore.add(c);
      }
    } else if (a.startsWith("--")) {
      throw new Error(`unknown option ${a}`);
    } else {
      only.push(a);
    }
  }
  return { root, only, ignore };
}

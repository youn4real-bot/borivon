"use client";

/**
 * Temporary one-time admin tool: copy all existing Google Drive files into
 * Cloudflare R2. Click the button; it loops batches until "remaining: 0".
 * Safe to run repeatedly — it never deletes Drive and skips done files.
 * Delete this page once the migration is complete.
 */
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHead, Btn, Card, Seg, Dot, STATUS_TINT, type Status } from "@/components/fx/kit";

type Failed = { id: string; reason: string; name: string | null; type: string | null };

export default function MigrateToR2Page() {
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(0);
  const [failed, setFailed] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const [verifying, setVerifying] = useState(false);
  const [auditComplete, setAuditComplete] = useState(false);
  const [vLog, setVLog] = useState<string[]>([]);
  const [vSummary, setVSummary] = useState<{ verified: number; unchecked: number; missing: number; mismatch: number; notMigrated: number; total: number } | null>(null);

  // the one design: on a phone the two steps show one at a time (view only)
  const [tool, setTool] = useState<"copy" | "verify">("copy");

  const add = (line: string) => setLog(l => [...l, line]);
  const vadd = (line: string) => setVLog(l => [...l, line]);

  async function run() {
    setRunning(true);
    setCopied(0); setFailed(0); setRemaining(null); setLog([]);
    let totalCopied = 0, totalFailed = 0;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { add("⚠️ Not logged in — open this page while logged in as the supreme admin."); setRunning(false); return; }

      for (let i = 0; i < 2000; i++) {
        const res = await fetch("/api/portal/admin/migrate-drive-to-r2", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { add(`❌ Error: ${j.error ?? res.status}`); break; }

        totalCopied += j.copied ?? 0;
        totalFailed += (j.failed?.length ?? 0);
        setCopied(totalCopied); setFailed(totalFailed); setRemaining(j.remaining ?? 0);
        add(`Batch ${i + 1}: copied ${j.copied}, failed ${j.failed?.length ?? 0}, remaining ${j.remaining}`);
        (j.failed as Failed[] | undefined)?.forEach(f => add(`   ✗ ${f.name ?? f.id.slice(0, 8)} [${f.type ?? "?"}] — ${f.reason}`));

        if (j.done || (j.processed ?? 0) === 0) { add(`✅ All done. ${totalCopied} copied, ${totalFailed} failed.`); break; }
        // No progress this batch = only un-copyable files remain → stop (no infinite loop).
        if ((j.copied ?? 0) === 0) { add(`⏹ Stopped — the remaining ${j.remaining} file(s) can't be copied (see ✗ above). ${totalCopied} copied in total.`); break; }
      }
    } catch (e) {
      add(`💥 Crashed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setRunning(false);
  }

  async function verify() {
    setVerifying(true); setVLog([]); setVSummary(null); setAuditComplete(false);
    let verified = 0, unchecked = 0, missing = 0, mismatch = 0, notMigrated = 0, total = 0;
    let complete = false;
    type V = {
      verified?: number; presentNotCrossChecked?: number; missingInR2?: Failed[];
      sizeMismatch?: (Failed & { r2: number; drive: number })[];
      notMigrated?: Failed[]; total?: number; nextOffset?: number; done?: boolean; error?: string;
    };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { vadd("⚠️ Not logged in as the supreme admin."); setVerifying(false); return; }

      let offset = 0;
      for (let i = 0; i < 10000; i++) {
        // Retry a batch up to 3× — Drive can throttle / time out a batch.
        let j: V | null = null;
        for (let attempt = 1; attempt <= 3 && !j; attempt++) {
          try {
            const res = await fetch("/api/portal/admin/verify-r2", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ offset }),
            });
            if (res.ok) { j = (await res.json()) as V; }
            else { vadd(`… batch @${offset} returned ${res.status} — retry ${attempt}/3`); await new Promise(r => setTimeout(r, 1500 * attempt)); }
          } catch { vadd(`… batch @${offset} network hiccup — retry ${attempt}/3`); await new Promise(r => setTimeout(r, 1500 * attempt)); }
        }
        if (!j) { vadd(`⚠️ Audit paused at ${offset}. Click "Verify all files" again to finish.`); break; }

        verified += j.verified ?? 0;
        unchecked += j.presentNotCrossChecked ?? 0;
        missing += j.missingInR2?.length ?? 0;
        mismatch += j.sizeMismatch?.length ?? 0;
        notMigrated += j.notMigrated?.length ?? 0;
        total = j.total ?? total;

        j.missingInR2?.forEach(f => vadd(`   ❌ MISSING in R2: ${f.name ?? f.id.slice(0, 8)} [${f.type ?? "?"}]`));
        j.sizeMismatch?.forEach(f => vadd(`   ⚠️ SIZE DIFFERS: ${f.name ?? f.id.slice(0, 8)} [${f.type ?? "?"}] — R2 ${f.r2}B vs Drive ${f.drive}B`));
        j.notMigrated?.forEach(f => vadd(`   ⏭ not copied: ${f.name ?? f.id.slice(0, 8)} [${f.type ?? "?"}]`));

        setVSummary({ verified, unchecked, missing, mismatch, notMigrated, total });
        offset = j.nextOffset ?? (offset + 15);
        await new Promise(r => setTimeout(r, 250)); // gentle pacing vs Drive throttle
        if (j.done) { complete = true; break; }
      }
      if (complete) {
        setAuditComplete(true);
        vadd(`— audit complete: ${verified} verified, ${unchecked} present-but-unchecked, ${missing} missing, ${mismatch} size-diff, ${notMigrated} not copied —`);
        if (unchecked > 0) vadd(`   ⚠️ ${unchecked} file(s) are in R2 but could NOT be compared against the Drive original — Google is unreachable, so this run proves presence, not integrity.`);
      }
    } catch (e) {
      vadd(`💥 ${e instanceof Error ? e.message : String(e)}`);
    }
    setVerifying(false);
  }

  const logBox: React.CSSProperties = {
    marginTop: 14, padding: 12, background: "var(--bg2)", borderRadius: 12, color: "var(--w2)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 11.5, lineHeight: 1.5,
    whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto",
  };
  const num = (n: number, label: string, st?: Status) => (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 12.5, color: "var(--w3)" }}>
      {st && <span style={{ alignSelf: "center" }}><Dot st={st} size={7} /></span>}
      <b style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, color: "var(--w)", fontVariantNumeric: "tabular-nums" }}>{n}</b>{label}
    </span>
  );
  const h2: React.CSSProperties = { margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 21, lineHeight: 1.2, color: "var(--w)" };
  const p: React.CSSProperties = { fontSize: 13, lineHeight: 1.5, color: "var(--w3)", margin: "6px 0 14px" };

  // the verify verdict as one status row (kit palette)
  const verdict: [Status, string] | null = !vSummary ? null
    : verifying ? ["pending", "checking…"]
    : !auditComplete ? ["pending", "incomplete, click Verify again"]
    : vSummary.missing || vSummary.mismatch || vSummary.notMigrated ? ["rejected", "see the problems in the log"]
    : vSummary.unchecked ? ["pending", "present in R2, but NOT verified against Google (Google unreachable)"]
    : ["approved", "all files confirmed in R2"];

  // the one design (founder 2026-11-13): serif head, the two steps as paper cards, one black pill, numbers in serif,
  // status as dots (no emojis in the page itself — the log lines stay exactly as the tool writes them)
  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "88px 16px 64px" }}>
      <style>{".bvm-tabs{display:none}@media (max-width:640px){.bvm-tabs{display:block}.bvm-card{display:none}.bvm-card[data-on=\"1\"]{display:block}}"}</style>
      <PageHead back={{ label: "Back", href: "/portal/admin" }}
        title="Migrate files: Google Drive → Cloudflare R2"
        sub="Temporary one-time tool: copy every document into R2, then prove nothing was lost." />

      <div className="bvm-tabs" style={{ marginBottom: 12 }}>
        <Seg value={tool} onChange={setTool} options={[["copy", "Copy"], ["verify", "Verify"]]} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, alignItems: "start" }}>
        <Card className="bvm-card" data-on={tool === "copy" ? "1" : "0"} style={{ padding: "18px 20px" }}>
          <h2 style={h2}>Copy every file to R2</h2>
          <p style={p}>
            One-time copy of every existing document into R2. <b style={{ color: "var(--w2)", fontWeight: 600 }}>Safe:</b> it copies + verifies before recording,
            never deletes anything from Drive, and skips files already copied — click it as often as you like.
            Keep this tab open until it says <b style={{ color: "var(--w2)", fontWeight: 600 }}>remaining: 0</b>.
          </p>

          <Btn kind="primary" onClick={run} disabled={running}>
            {running ? "Copying…" : "Copy files to R2"}
          </Btn>

          {remaining !== null && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 18px", marginTop: 16 }}>
              {num(copied, "copied", "approved")}
              {num(failed, "failed", failed ? "rejected" : undefined)}
              {num(remaining, "remaining", remaining === 0 ? "approved" : "pending")}
              {remaining === 0 && <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--w)" }}>done</span>}
            </div>
          )}

          {log.length > 0 && <pre style={logBox}>{log.join("\n")}</pre>}
        </Card>

        <Card className="bvm-card" data-on={tool === "verify" ? "1" : "0"} style={{ padding: "18px 20px" }}>
          <h2 style={h2}>Verify every file is in R2</h2>
          <p style={p}>
            Read-only audit. For each document it confirms the file <b style={{ color: "var(--w2)", fontWeight: 600 }}>exists in R2</b> and its
            <b style={{ color: "var(--w2)", fontWeight: 600 }}> byte-size matches the original in Google Drive</b> — proof, file by file, that nothing was lost.
          </p>

          <Btn kind="ghost" onClick={verify} disabled={verifying}>
            {verifying ? "Verifying…" : "Verify all files"}
          </Btn>

          {vSummary && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 18px", marginTop: 16 }}>
                <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 12.5, color: "var(--w3)" }}>
                  <span style={{ alignSelf: "center" }}><Dot st="approved" size={7} /></span>
                  <b style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, color: "var(--w)", fontVariantNumeric: "tabular-nums" }}>{vSummary.verified}</b>/ {vSummary.total} verified
                </span>
                {num(vSummary.missing, "missing", vSummary.missing ? "rejected" : undefined)}
                {num(vSummary.mismatch, "size diff", vSummary.mismatch ? "pending" : undefined)}
                {num(vSummary.notMigrated, "not copied", vSummary.notMigrated ? "pending" : undefined)}
                {num(vSummary.unchecked, "unchecked", vSummary.unchecked ? "pending" : undefined)}
              </div>
              {/* The all-clear now has to be EARNED. It used to require only
                  missing === 0 && mismatch === 0 — but the Drive size comparison is
                  wrapped in a catch that yields -1, and a -1 skipped the comparison
                  and still counted the row as verified. So once the Google
                  credentials went away every run printed the celebration while
                  checking nothing, and `notMigrated` was not even part of the
                  condition: the one document that never made it to R2 was listed in
                  the log while the banner said all files confirmed. */}
              {verdict && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "9px 14px", borderRadius: 12, background: STATUS_TINT[verdict[0]], fontSize: 13, color: "var(--w)" }}>
                  <Dot st={verdict[0]} size={8} />{verdict[1]}
                </div>
              )}
            </>
          )}

          {vLog.length > 0 && <pre style={logBox}>{vLog.join("\n")}</pre>}
        </Card>
      </div>
    </main>
  );
}

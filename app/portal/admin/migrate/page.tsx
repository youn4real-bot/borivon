"use client";

/**
 * Temporary one-time admin tool: copy all existing Google Drive files into
 * Cloudflare R2. Click the button; it loops batches until "remaining: 0".
 * Safe to run repeatedly — it never deletes Drive and skips done files.
 * Delete this page once the migration is complete.
 */
import { useState } from "react";
import { supabase } from "@/lib/supabase";

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
  const [vSummary, setVSummary] = useState<{ verified: number; missing: number; mismatch: number; notMigrated: number; total: number } | null>(null);

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
    let verified = 0, missing = 0, mismatch = 0, notMigrated = 0, total = 0;
    let complete = false;
    type V = {
      verified?: number; missingInR2?: Failed[];
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
        missing += j.missingInR2?.length ?? 0;
        mismatch += j.sizeMismatch?.length ?? 0;
        notMigrated += j.notMigrated?.length ?? 0;
        total = j.total ?? total;

        j.missingInR2?.forEach(f => vadd(`   ❌ MISSING in R2: ${f.name ?? f.id.slice(0, 8)} [${f.type ?? "?"}]`));
        j.sizeMismatch?.forEach(f => vadd(`   ⚠️ SIZE DIFFERS: ${f.name ?? f.id.slice(0, 8)} [${f.type ?? "?"}] — R2 ${f.r2}B vs Drive ${f.drive}B`));
        j.notMigrated?.forEach(f => vadd(`   ⏭ not copied: ${f.name ?? f.id.slice(0, 8)} [${f.type ?? "?"}]`));

        setVSummary({ verified, missing, mismatch, notMigrated, total });
        offset = j.nextOffset ?? (offset + 15);
        await new Promise(r => setTimeout(r, 250)); // gentle pacing vs Drive throttle
        if (j.done) { complete = true; break; }
      }
      if (complete) {
        setAuditComplete(true);
        vadd(`— audit complete: ${verified} verified, ${missing} missing, ${mismatch} size-diff, ${notMigrated} not copied —`);
      }
    } catch (e) {
      vadd(`💥 ${e instanceof Error ? e.message : String(e)}`);
    }
    setVerifying(false);
  }

  return (
    <div style={{ maxWidth: 680, margin: "48px auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#e7e7e7" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Migrate files: Google Drive → Cloudflare R2</h1>
      <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, marginBottom: 20 }}>
        One-time copy of every existing document into R2. <b>Safe:</b> it copies + verifies before recording,
        never deletes anything from Drive, and skips files already copied — so you can click it as many times as you like.
        Keep this tab open until it says <b>remaining: 0</b>.
      </p>

      <button
        onClick={run}
        disabled={running}
        style={{
          background: running ? "#555" : "#c9a23a",
          color: "#131312", fontWeight: 700, fontSize: 14,
          padding: "12px 20px", borderRadius: 10, border: "none",
          cursor: running ? "default" : "pointer",
        }}
      >
        {running ? "Copying…" : "Copy files to R2"}
      </button>

      {remaining !== null && (
        <p style={{ marginTop: 16, fontSize: 15 }}>
          Copied: <b>{copied}</b> · Failed: <b style={{ color: failed ? "#ef4444" : undefined }}>{failed}</b> · Remaining: <b>{remaining}</b>
          {remaining === 0 ? "  ✅ done" : ""}
        </p>
      )}

      {log.length > 0 && (
        <pre style={{
          marginTop: 16, padding: 14, background: "#1a1a1a", borderRadius: 10,
          fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto",
        }}>{log.join("\n")}</pre>
      )}

      <hr style={{ margin: "32px 0", border: "none", borderTop: "1px solid #333" }} />

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Verify every file is in R2</h2>
      <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, marginBottom: 16 }}>
        Read-only audit. For each document it confirms the file <b>exists in R2</b> and its
        <b> byte-size matches the original in Google Drive</b> — proof, file by file, that nothing was lost.
      </p>

      <button
        onClick={verify}
        disabled={verifying}
        style={{
          background: verifying ? "#555" : "#2f6f6a",
          color: "#fff", fontWeight: 700, fontSize: 14,
          padding: "12px 20px", borderRadius: 10, border: "none",
          cursor: verifying ? "default" : "pointer",
        }}
      >
        {verifying ? "Verifying…" : "Verify all files"}
      </button>

      {vSummary && (
        <p style={{ marginTop: 16, fontSize: 15 }}>
          ✅ Verified: <b>{vSummary.verified}</b> / {vSummary.total} ·
          {" "}❌ Missing: <b style={{ color: vSummary.missing ? "#ef4444" : undefined }}>{vSummary.missing}</b> ·
          {" "}⚠️ Size diff: <b style={{ color: vSummary.mismatch ? "#f59e0b" : undefined }}>{vSummary.mismatch}</b> ·
          {" "}⏭ Not copied: <b>{vSummary.notMigrated}</b>
          {verifying ? "  — checking…"
            : auditComplete && vSummary.missing === 0 && vSummary.mismatch === 0 ? "  — ✅ all files confirmed in R2 🎉"
            : auditComplete ? "  — ⚠️ see problems above"
            : "  — incomplete, click Verify again"}
        </p>
      )}

      {vLog.length > 0 && (
        <pre style={{
          marginTop: 16, padding: 14, background: "#1a1a1a", borderRadius: 10,
          fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto",
        }}>{vLog.join("\n")}</pre>
      )}
    </div>
  );
}

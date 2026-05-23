"use client";

/**
 * Temporary one-time admin tool: copy all existing Google Drive files into
 * Cloudflare R2. Click the button; it loops batches until "remaining: 0".
 * Safe to run repeatedly — it never deletes Drive and skips done files.
 * Delete this page once the migration is complete.
 */
import { useState } from "react";
import { supabase } from "@/lib/supabase";

type Failed = { id: string; reason: string };

export default function MigrateToR2Page() {
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(0);
  const [failed, setFailed] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const add = (line: string) => setLog(l => [...l, line]);

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
        (j.failed as Failed[] | undefined)?.forEach(f => add(`   ✗ ${f.id.slice(0, 8)}… — ${f.reason}`));

        if (j.done || (j.processed ?? 0) === 0) { add(`✅ Finished. ${totalCopied} copied, ${totalFailed} failed.`); break; }
      }
    } catch (e) {
      add(`💥 Crashed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setRunning(false);
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
    </div>
  );
}

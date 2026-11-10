"use client";

import { useState } from "react";
import { useLang } from "@/components/LangContext";
import type { BundleDoc } from "@/lib/visaBundle";

/**
 * "Visa-Mappe": every approved document of one nurse as ONE PDF with a contents page (lib/visaBundle).
 * Built in the browser from the normal file downloads; nothing is stored or changed.
 */
export function VisaBundleButton({ docs, accessToken, name }: { docs: BundleDoc[]; accessToken: string; name: string }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const approved = docs.filter((d) => d.status === "approved").length;

  async function make() {
    if (busy) return;
    if (!approved) { setMsg(t.visaBundleEmpty); return; }
    setBusy(true); setMsg("");
    try {
      const { buildVisaBundle } = await import("@/lib/visaBundle");
      const fetchBytes = async (id: string) => {
        const r = await fetch(`/api/portal/file?docId=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
      };
      const l = (["de", "en", "fr"].includes(lang) ? lang : "de") as "de" | "en" | "fr";
      const { bytes, skipped } = await buildVisaBundle(docs, fetchBytes, { name, lang: l });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Visa-Mappe-${name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "Pflegekraft"}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (skipped.length) setMsg(`${t.visaBundleSkipped} ${skipped.join(", ")}`);
    } catch {
      setMsg(t.visaBundleFail);
    }
    setBusy(false);
  }

  return (
    <span className="inline-flex flex-col items-start flex-shrink-0">
      <button type="button" onClick={make} disabled={busy}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3.5 py-2 rounded-full transition-opacity hover:opacity-80 disabled:opacity-50"
        style={{ background: "transparent", color: "var(--w2)", border: "1px solid var(--border)" }}>
        {busy ? t.visaBundleBusy : t.visaBundleBtn}
      </button>
      {msg && <span className="text-[11px] mt-1" style={{ color: "var(--w3)" }} role="status">{msg}</span>}
    </span>
  );
}

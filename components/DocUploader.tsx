"use client";

/**
 * Clean, portal-matching uploader for the login-less link. Keeps Uppy's ENGINE
 * (@uppy/core + xhr-upload: progress, retry, restrictions) but NOT its Dashboard
 * UI — the chunky drop widget clashed with the portal. We render our own tile
 * with the app's design tokens and drive Uppy headlessly.
 */

import { useEffect, useRef, useState } from "react";
import Uppy from "@uppy/core";
import XHRUpload from "@uppy/xhr-upload";
import { UploadCloud, Loader2, RotateCcw, Camera } from "lucide-react";

export default function DocUploader({
  token,
  docKey,
  lang,
  onDone,
}: {
  token: string;
  docKey: string;
  lang: string;
  onDone: () => void;
}) {
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [drag, setDrag] = useState(false);

  const [uppy] = useState(() => {
    const u = new Uppy({
      autoProceed: true,
      restrictions: { maxNumberOfFiles: 1, maxFileSize: 25 * 1024 * 1024, allowedFileTypes: [".pdf", ".jpg", ".jpeg", ".png", ".webp"] },
    }).use(XHRUpload, { endpoint: `/api/portal/u/${token}`, method: "POST", fieldName: "file", formData: true, allowedMetaFields: ["docKey"] });
    u.setMeta({ docKey });
    return u;
  });

  useEffect(() => {
    const onProg = (p: number) => setPct(Math.max(2, Math.min(100, Math.round(p))));
    const onSucc = () => { setPhase("idle"); onDoneRef.current(); };
    const onErr = () => setPhase("error");
    uppy.on("progress", onProg);
    uppy.on("upload-success", onSucc);
    uppy.on("upload-error", onErr);
    uppy.on("error", onErr);
    uppy.on("restriction-failed", onErr);
    return () => { uppy.destroy(); };
  }, [uppy]);

  const add = (file: File) => {
    setPhase("uploading");
    setPct(0);
    try { uppy.addFile({ name: file.name, type: file.type, data: file }); }
    catch { setPhase("error"); }
  };
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) add(f);
    if (inputRef.current) inputRef.current.value = "";
  };

  if (phase === "uploading") {
    return (
      <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--w2)", marginBottom: 10 }}>
          <Loader2 size={15} className="animate-spin" style={{ color: "var(--gold)" }} />
          {L("Uploading…", "Envoi…", "Wird hochgeladen…")} {pct}%
        </div>
        <div style={{ height: 6, borderRadius: 4, background: "var(--card)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--gold)", transition: "width .2s" }} />
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div style={{ border: "1px solid var(--danger-border, var(--border))", borderRadius: 14, background: "var(--danger-bg)", padding: "16px" }}>
        <p style={{ fontSize: 13, color: "var(--danger)", marginBottom: 10 }}>
          {L("Upload failed. Please try again with a PDF or photo (max 25 MB).",
             "Échec de l'envoi. Réessayez avec un PDF ou une photo (max 25 Mo).",
             "Upload fehlgeschlagen. Bitte erneut mit PDF oder Foto (max. 25 MB).")}
        </p>
        <button type="button" onClick={() => { setPhase("idle"); inputRef.current?.click(); }}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 16px", borderRadius: 10, background: "var(--gold)", color: "#1a1205", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}>
          <RotateCcw size={14} /> {L("Try again", "Réessayer", "Erneut versuchen")}
        </button>
        <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: "none" }} onChange={onPick} />
      </div>
    );
  }

  return (
    <div
      role="button" tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) add(f); }}
      style={{
        cursor: "pointer", borderRadius: 14, padding: "22px 16px", textAlign: "center",
        border: `1.5px dashed ${drag ? "var(--gold)" : "var(--border)"}`,
        background: drag ? "var(--gdim)" : "var(--bg2)",
        transition: "border-color .15s, background .15s",
      }}>
      <span style={{ display: "inline-flex", width: 40, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center", background: "var(--gdim)", color: "var(--gold)", marginBottom: 10 }}>
        <UploadCloud size={20} strokeWidth={1.8} />
      </span>
      <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--w)", marginBottom: 3 }}>
        {L("Tap to choose a file or take a photo", "Touchez pour choisir un fichier ou prendre une photo", "Tippen, um eine Datei zu wählen oder ein Foto aufzunehmen")}
      </p>
      <p style={{ fontSize: 11.5, color: "var(--w3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
        <Camera size={12} /> {L("Photo or PDF · max 25 MB", "Photo ou PDF · max 25 Mo", "Foto oder PDF · max. 25 MB")}
      </p>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: "none" }} onChange={onPick} />
    </div>
  );
}

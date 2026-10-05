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
import { UploadCloud, Loader2, RotateCcw, Camera, PauseCircle } from "lucide-react";
import { isHeicUpload, heicRefusalMessage, HEIC_CODE } from "@/lib/heic";
import { isMaintenanceUploadError, MAINTENANCE_MESSAGES, type MaintenanceLang } from "@/lib/maintenance";

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
  // "paused" is NOT a failure: it is the site answering 503 during the final
  // Supabase -> D1 copy (dormant today, MAINTENANCE_WRITES="0"). It gets its
  // own tile because the error tile would blame her file for a planned pause.
  const [phase, setPhase] = useState<"idle" | "uploading" | "error" | "paused">("idle");
  // WHY the upload failed, not just THAT it did. An iPhone photo shared in
  // through Files arrives as a raw .heic, and "Upload failed. Please try again
  // with a PDF or photo" is a sentence that describes what she already gave
  // us — she retries with the same file and fails again. HEIC gets its own
  // answer (lib/heic.ts), which names the format and the two taps out of it.
  const [errKind, setErrKind] = useState<"generic" | "heic">("generic");
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
    const fail = (kind: "generic" | "heic" = "generic") => { setErrKind(kind); setPhase("error"); };
    // Uppy re-emits a failed upload on "error" AFTER "upload-error" (core's
    // upload() catch calls informAndEmit), so a plain setPhase("error") here
    // would overwrite the maintenance state a moment after it was set, and the
    // nurse would be back to "your file is wrong".
    const onErr = () => setPhase((p) => (p === "paused" ? p : "error"));
    /**
     * TWO things can come back that are not "your file is wrong", and the
     * response BODY is the only place either of them is written down. Uppy's
     * error handler used to throw that body away and show the generic line.
     *
     *  • PAUSED — during the final Supabase → D1 copy the route answers 503
     *    with the maintenance body (lib/maintenance.ts; dormant today). The
     *    generic tile would tell the nurse her FILE is wrong — "try again with
     *    a PDF or photo (max 25 MB)" — for a planned ten-minute pause. On the
     *    login-less link she has nobody to ask, so she re-shoots the photo,
     *    fails again, and concludes the document did not go through.
     *  • HEIC — the server answers an iPhone photo with its own code
     *    (app/api/portal/u/[token]/route.ts), including one renamed .jpg, which
     *    no name or MIME check on this side can catch. lib/heic.ts names the
     *    format and the two taps out of it.
     *
     * A pause outranks the file: a 503 says nothing about what she sent.
     */
    const onUploadErr = (_file: unknown, _error: unknown, response?: { status?: number; body?: unknown }) => {
      if (isMaintenanceUploadError(response)) { setPhase("paused"); return; }
      const code = (response?.body as { code?: string } | undefined)?.code;
      fail(code === HEIC_CODE ? "heic" : "generic");
    };
    uppy.on("progress", onProg);
    uppy.on("upload-success", onSucc);
    uppy.on("upload-error", onUploadErr);
    uppy.on("error", onErr);
    // A file the restrictions reject really IS the file's problem — it keeps
    // the error tile, which is the right words for it.
    uppy.on("restriction-failed", onErr);
    return () => { uppy.destroy(); };
  }, [uppy]);

  const add = (file: File) => {
    // Before Uppy, because its own allowedFileTypes would refuse this as a
    // bare restriction-failure with nothing to say. This is the commonest way
    // a nurse's photo arrives wrong: picked through Files (or shared in from
    // another app) instead of Photos, so iOS never transcodes it to JPEG.
    if (isHeicUpload(file.type, file.name)) {
      setErrKind("heic");
      setPhase("error");
      return;
    }
    setPhase("uploading");
    // A new attempt starts with no reason yet. This is the ONE place the reason
    // is cleared, and it has to be here: "error" re-emits after "upload-error"
    // (Uppy core's informAndEmit), so clearing it in that handler instead would
    // wipe the HEIC verdict the server just sent, and not clearing it anywhere
    // would show the HEIC wording for the next, unrelated failure.
    setErrKind("generic");
    setPct(0);
    // Drop whatever was added before. Without this, sending the SAME file again
    // — exactly what she does after "try again shortly" — is refused by Uppy as
    // a duplicate, which lands in the catch below and shows the file error.
    try { uppy.clear(); } catch { /* an upload in flight: addFile below decides */ }
    try { uppy.addFile({ name: file.name, type: file.type, data: file }); }
    catch { setErrKind("generic"); setPhase("error"); }
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

  if (phase === "paused") {
    // Not red, not "failed": nothing is wrong with her file or her document.
    // One calm line in her own language (LAW #19), and the same button so she
    // can send it the moment the pause ends.
    const key: MaintenanceLang = lang === "fr" ? "fr" : lang === "de" ? "de" : "en";
    return (
      <div style={{ border: "1px solid var(--border-gold)", borderRadius: 14, background: "var(--card)", padding: "16px" }}>
        <p style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--w2)", marginBottom: 10 }}>
          <PauseCircle size={15} strokeWidth={1.8} style={{ color: "var(--gold)", flexShrink: 0, marginTop: 1 }} />
          <span>{MAINTENANCE_MESSAGES[key]}</span>
        </p>
        <button type="button" onClick={() => { setPhase("idle"); inputRef.current?.click(); }}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 16px", borderRadius: 10, background: "var(--gold)", color: "#1a1205", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}>
          <RotateCcw size={14} /> {L("Try again", "Réessayer", "Erneut versuchen")}
        </button>
        <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: "none" }} onChange={onPick} />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div style={{ border: "1px solid var(--danger-border, var(--border))", borderRadius: 14, background: "var(--danger-bg)", padding: "16px" }}>
        <p style={{ fontSize: 13, color: "var(--danger)", marginBottom: 10, lineHeight: 1.5 }}>
          {errKind === "heic"
            ? heicRefusalMessage(lang)
            : L("Upload failed. Please try again with a PDF or photo (max 25 MB).",
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

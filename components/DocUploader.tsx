"use client";

/**
 * One Uppy uploader bound to ONE requested doc on a login-less link. Uppy is the
 * OSS uploader (progress, retry, preview, mobile camera picker for free). It POSTs
 * multipart to /api/portal/u/<token>/upload with the docKey as meta. Loaded only
 * on the client (the page imports it via next/dynamic ssr:false).
 */

import { useEffect, useRef, useState } from "react";
import Uppy from "@uppy/core";
import Dashboard from "@uppy/react/dashboard";
import XHRUpload from "@uppy/xhr-upload";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";

export default function DocUploader({
  token,
  docKey,
  note,
  onDone,
}: {
  token: string;
  docKey: string;
  note?: string;
  onDone: () => void;
}) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const [uppy] = useState(() => {
    const u = new Uppy({
      autoProceed: true,
      restrictions: {
        maxNumberOfFiles: 1,
        maxFileSize: 25 * 1024 * 1024,
        allowedFileTypes: [".pdf", ".jpg", ".jpeg", ".png", ".webp"],
      },
    }).use(XHRUpload, {
      endpoint: `/api/portal/u/${token}`,
      method: "POST",
      fieldName: "file",
      formData: true,
      allowedMetaFields: ["docKey"],
    });
    u.setMeta({ docKey });
    return u;
  });

  useEffect(() => {
    const cb = () => onDoneRef.current();
    uppy.on("upload-success", cb);
    return () => {
      uppy.off("upload-success", cb);
      uppy.destroy();
    };
  }, [uppy]);

  return (
    <Dashboard
      uppy={uppy}
      height={240}
      width="100%"
      note={note}
      proudlyDisplayPoweredByUppy={false}
      theme="auto"
    />
  );
}

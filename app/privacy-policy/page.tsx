"use client";

import { useLang } from "@/components/LangContext";
import { PrivacyView } from "@/components/PrivacyView";

/**
 * Privacy policy in the site language. German visitors are sent to /datenschutz
 * by middleware.ts (Accept-Language); the text lives in lib/privacyContent.ts.
 */
export default function PrivacyPolicyPage() {
  const { lang } = useLang();
  return <PrivacyView lang={lang} />;
}

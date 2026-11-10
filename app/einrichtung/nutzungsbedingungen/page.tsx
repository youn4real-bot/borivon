import type { Metadata } from "next";
import { LegalPage } from "@/components/fx/LegalPage";
import { TERMS } from "@/lib/facility/legal";

export const metadata: Metadata = { title: "Nutzungsbedingungen · Borivon-Plattform", robots: { index: false, follow: true } };

export default function Page() {
  return <LegalPage doc={TERMS} />;
}

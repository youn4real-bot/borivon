import type { Metadata } from "next";
import { LegalPage } from "@/components/fx/LegalPage";
import { AVV } from "@/lib/facility/legal";

export const metadata: Metadata = { title: "Auftragsverarbeitung (AVV) · Borivon-Plattform", robots: { index: false, follow: true } };

export default function Page() {
  return <LegalPage doc={AVV} />;
}

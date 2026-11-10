import type { Metadata } from "next";
import { Suspense } from "react";
import { StartView } from "./StartView";

export const metadata: Metadata = {
  title: "Ihre Plattform · Borivon",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <Suspense fallback={null}><StartView /></Suspense>;
}

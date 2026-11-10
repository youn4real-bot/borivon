import { redirect } from "next/navigation";

/** The facility's space lives in the portal since 2026-11-10 (DIY organization). */
export default function Page() {
  redirect("/portal");
}

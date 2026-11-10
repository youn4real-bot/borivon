import { redirect } from "next/navigation";

/** Facilities sign in to the portal like everyone else (since 2026-11-10). */
export default function Page() {
  redirect("/portal");
}

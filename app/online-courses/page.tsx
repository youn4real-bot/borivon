import type { Metadata } from "next";
import { OnlineCoursesRegistration } from "@/components/OnlineCoursesRegistration";

export const metadata: Metadata = {
  title: "Online German Courses – Borivon",
  description:
    "Register for Borivon's live online German courses — A0 to C1, small groups, qualified instructors. Reserve your seat in three quick steps.",
  alternates: { canonical: "/online-courses" },
  openGraph: {
    title: "Online German Courses – Borivon",
    description:
      "Live online German courses, A0–C1, small groups. Reserve your seat in three quick steps.",
    url: "/online-courses",
    type: "website",
  },
};

export default function OnlineCoursesPage() {
  return <OnlineCoursesRegistration />;
}

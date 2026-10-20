import type { Metadata } from "next";
import { BookingFlow } from "@/components/BookingFlow";

export const metadata: Metadata = {
  title: "Book a call – Borivon",
  description:
    "Book a free call with Borivon — for hospitals and care homes that need nurses, and for nurses who want to work in Germany.",
  alternates: { canonical: "/book" },
  openGraph: {
    title: "Book a call – Borivon",
    description: "Pick a time that suits you. Hospitals, care homes and nurses.",
    url: "/book",
    type: "website",
  },
};

export default function BookPage() {
  return <BookingFlow />;
}

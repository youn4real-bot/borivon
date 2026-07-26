import type { Metadata } from "next";
import { BookingFlow } from "@/components/BookingFlow";

export const metadata: Metadata = {
  title: "Book a call – Borivon",
  description:
    "Book a free 30-minute call with Borivon — for nurses who want to work in Germany, for healthcare facilities looking for nurses, and for companies that need German training for their team.",
  alternates: { canonical: "/book" },
  openGraph: {
    title: "Book a call – Borivon",
    description: "Pick a time that suits you. Nurses, healthcare facilities, and companies needing German training.",
    url: "/book",
    type: "website",
  },
};

export default function BookPage() {
  return <BookingFlow />;
}

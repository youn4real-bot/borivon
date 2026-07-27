import type { Metadata } from "next";
import { BookingManage } from "@/components/BookingManage";

// The URL carries a private token, so this page must never be indexed or have
// its link leaked to a search engine.
export const metadata: Metadata = {
  title: "Your appointment – Borivon",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function BookManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <BookingManage token={token} />;
}

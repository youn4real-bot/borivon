import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/BookingFlow";
import { loadEventType } from "@/lib/bookingEventTypes";

/**
 * The shareable booking link — one per audience.
 *
 *     /book/nurse      hand this to a candidate
 *     /book/clinic     hand this to a hospital or care home
 *     /book/company    hand this to a company wanting German training
 *
 * Plain /book still works and still asks the visitor to classify themselves;
 * this route just answers that question in advance, so the person you sent it
 * to lands directly on the calendar.
 *
 * Server component on purpose: the event type is resolved (and 404'd) before
 * any JS reaches the visitor, and the title/description below come from it, so
 * a link pasted into WhatsApp or LinkedIn previews as the right meeting rather
 * than a generic "Book a call".
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ type: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { type } = await params;
  const et = await loadEventType(type);
  if (!et) return { title: "Book a call – Borivon" };
  // English for the crawler; the page itself renders in the visitor's language.
  return {
    title: `${et.title.en} – Borivon`,
    description: et.blurb.en,
    alternates: { canonical: `/book/${et.slug}` },
    openGraph: {
      title: `${et.title.en} – Borivon`,
      description: et.blurb.en,
      url: `/book/${et.slug}`,
      type: "website",
    },
  };
}

export default async function BookTypePage({ params }: Params) {
  const { type } = await params;
  const et = await loadEventType(type);
  if (!et) notFound();
  return <BookingFlow initialKind={et.kind} eventType={et.slug} headline={et.title} blurb={et.blurb} />;
}

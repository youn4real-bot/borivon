import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/BookingFlow";
import { loadEventType } from "@/lib/bookingEventTypes";

/**
 * The shareable booking link — one per audience.
 *
 *     /book/nurse      hand this to a candidate
 *     /book/clinic     hand this to a hospital or care home
 *     /book/company    retired 2026-10-20 (nurses only) — next.config redirects it to /
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

type Params = {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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

export default async function BookTypePage({ params, searchParams }: Params) {
  const { type } = await params;
  const et = await loadEventType(type);
  if (!et) notFound();
  // ?embed=1: the frame on borivon.com/workshop. Decided here so the first paint is already the
  // embedded layout (no summary rail popping out after the JS loads).
  const embedded = (await searchParams).embed === "1";
  // the workshop calendar (shown inside borivon.com/workshop) is German only, like the page around it
  return <BookingFlow initialKind={et.kind} eventType={et.slug} headline={et.title} blurb={et.blurb} forceLang={et.slug === "workshop" ? "de" : undefined} embedded={embedded} />;
}

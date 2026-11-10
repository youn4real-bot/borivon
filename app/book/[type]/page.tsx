import type { CSSProperties } from "react";
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

/** Inside borivon.com/workshop the calendar wears the page's look (content/pflege/bv.css): warm paper,
 *  ink selections with paper text, hairlines. Set here as CSS variables, so the first paint is right. */
const EMBED_SKIN = {
  "--bg": "#fbfaf6", "--bg2": "#f4f1ea", "--card": "#ffffff", "--card2": "#fbfaf6",
  "--border": "rgba(21,19,15,0.10)", "--border2": "rgba(21,19,15,0.16)", "--border-gold": "rgba(21,19,15,0.16)",
  "--w": "#15130f", "--w2": "#3b372f", "--w3": "#6b6458",
  "--gold": "#7a5c20", "--gold2": "#a8843a", "--gdim": "rgba(168,132,58,0.08)",
  "--sel-bg": "#15130f", "--sel-ink": "#fbfaf6", "--sel-radius": "3px",
  color: "#15130f",
} as CSSProperties;

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
  const flow = <BookingFlow initialKind={et.kind} eventType={et.slug} headline={et.title} blurb={et.blurb} forceLang={et.slug === "workshop" ? "de" : undefined} embedded={embedded} />;
  if (!embedded) return flow;
  return (
    <div className="bv-embed-skin" style={EMBED_SKIN}>
      <style>{"html,body{background:#fbfaf6!important}"}</style>
      {flow}
    </div>
  );
}

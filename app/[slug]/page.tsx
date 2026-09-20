import { notFound } from "next/navigation";
import { isPossibleProfileSlug } from "./isProfileSlug";
import PublicProfileClient from "./PublicProfileClient";

/**
 * Public candidate profile, e.g. /yassine78492.
 *
 * This is a SERVER component on purpose, and it holds nothing but the guard.
 * The page used to be the client component now in PublicProfileClient.tsx, and
 * its only not-found path was a notFound() inside a useEffect — which runs in
 * the browser, long after the response status is settled. So every address the
 * rest of the app did not claim got HTTP 200 and the whole app shell, including
 * the /key.json and /.env probes a scanner was hammering. Deciding here, before
 * anything renders, is what makes the status code true.
 */
export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // notFound() from a server component is a real 404 status plus the site's own
  // app/not-found.tsx — the same page two-segment misses already get.
  if (!isPossibleProfileSlug(slug)) notFound();
  return <PublicProfileClient slug={slug} />;
}

/**
 * The Borivon wordmark for e-mail signatures.
 *
 * This route is now a permanent redirect to the pre-rendered PNG
 * (public/email-logo.png), and that is the whole of it.
 *
 * It used to render the wordmark on the fly with `ImageResponse` from
 * "next/og". That branch could never run in production: next/og is Satori plus
 * a resvg WASM module, which 500s on Cloudflare Workers, so the route already
 * detected workerd and redirected to the static PNG instead — and
 * lib/outboundEmail.ts has pointed every outgoing signature straight at
 * /email-logo.png for a long time. The unreachable branch was not free: it was
 * the ONLY reference to next/dist/compiled/@vercel/og anywhere in the server
 * build (verified: `grep -rl "compiled/@vercel/og" .next/server` matched
 * app/email-logo/route.js and nothing else), and it dragged that 720,939-byte
 * file into the single Cloudflare Worker script — where ~93 nurses on Moroccan
 * mobile data paid to parse it on every cold isolate, so that a route nobody
 * calls could fail in a way nobody would see.
 *
 * The route stays because old e-mails in people's inboxes still point at
 * /email-logo without the extension, and a broken logo in a two-year-old
 * message is a bad look for a nurse forwarding it to an employer.
 *
 * The Location is relative on purpose: it keeps whatever host the mail client
 * actually asked (www.borivon.com, a preview deployment, localhost in dev)
 * instead of the absolute NEXT_PUBLIC_BASE_URL the old Workers branch guessed
 * at. RFC 7231 allows a relative Location and every HTTP client follows it.
 */

// 308, not 302: this destination is never going to change, so mail clients,
// proxies and link-preview bots may cache the redirect instead of asking again.
export function GET(): Response {
  return new Response(null, {
    status: 308,
    headers: {
      Location: "/email-logo.png",
      // The wordmark is immutable — never make a client re-follow this.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

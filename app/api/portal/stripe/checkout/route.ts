import { NextRequest } from "next/server";
import Stripe from "stripe";
import { requireUser } from "@/lib/admin-auth";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key);
}

// Plan codes -> Stripe price lookup_keys. Prices are resolved at runtime so
// rebuilds of the Stripe product (live mode) don't require redeploys —
// rotating a price ID on Stripe's side is invisible to us as long as the
// lookup_key stays attached to the new price.
const LOOKUP_KEY: Record<string, string> = {
  premium_onetime: "premium_onetime_99",     // €99 one-off
  premium_monthly: "premium_monthly_6x",     // €19/month — open-ended subscription
};

const LABELS: Record<string, string> = {
  premium_onetime: "Premium — €99",
  premium_monthly: "Premium — €19/month",
};

type Plan = "premium_onetime" | "premium_monthly";

/**
 * POST /api/portal/stripe/checkout
 * Body: { plan: "premium_onetime" | "premium_monthly" }
 * Returns: { url: string }  — Stripe-hosted checkout URL
 *
 * premium_onetime → one-time €99 payment (mode: "payment")
 * premium_monthly → €19/month open-ended subscription (mode:
 *   "subscription"). Customer cancels via Stripe's customer portal.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const plan: Plan = body.plan === "premium_monthly" ? "premium_monthly" : "premium_onetime";
  const lookupKey = LOOKUP_KEY[plan];

  let stripe: Stripe;
  try { stripe = getStripe(); }
  catch { return Response.json({ error: "Payment not configured yet." }, { status: 503 }); }

  // Resolve the price by lookup_key — no hardcoded price IDs in the codebase.
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const priceId = prices.data[0]?.id;
  if (!priceId) {
    // Internal lookup_key stays in server logs only — don't disclose Stripe
    // product wiring to the client.
    console.error(`[checkout] no active price for lookup_key="${lookupKey}"`);
    return Response.json(
      { error: "Payment temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.borivon.com";
  const isMonthly = plan === "premium_monthly";

  const session = await stripe.checkout.sessions.create({
    mode: isMonthly ? "subscription" : "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { userId: auth.userId, plan },
    customer_email: auth.email ?? undefined,
    ...(isMonthly
      ? {
          // Open-ended subscription — runs until candidate cancels via
          // Stripe's customer portal. No cycle cap on our side.
          subscription_data: {
            metadata: { userId: auth.userId, plan },
          },
        }
      : {
          payment_intent_data: { description: LABELS[plan] },
        }),
    allow_promotion_codes: true,
    success_url: `${base}/portal/dashboard?payment=success&plan=${plan}`,
    cancel_url:  `${base}/portal/dashboard?payment=cancelled`,
  });

  return Response.json({ url: session.url });
}

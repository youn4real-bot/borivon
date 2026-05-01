import { NextRequest } from "next/server";
import Stripe from "stripe";
import { requireUser } from "@/lib/admin-auth";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key);
}

const PRICE: Record<string, string | undefined> = {
  starter:  process.env.STRIPE_PRICE_STARTER,
  kandidat: process.env.STRIPE_PRICE_KANDIDAT,
};

const LABELS: Record<string, string> = {
  starter:  "Starter — €9",
  kandidat: "Kandidat — €99",
};

/**
 * POST /api/portal/stripe/checkout
 * Body: { plan: "starter" | "kandidat" }
 * Returns: { url: string }  — Stripe-hosted checkout URL
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const plan = body.plan === "starter" ? "starter" : "kandidat";

  const priceId = PRICE[plan];
  if (!priceId) {
    return Response.json({ error: "Stripe price not configured — add env vars." }, { status: 500 });
  }

  let stripe: Stripe;
  try { stripe = getStripe(); }
  catch { return Response.json({ error: "Payment not configured yet." }, { status: 503 }); }

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.borivon.com";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { userId: auth.userId, plan },
    customer_email: auth.email ?? undefined,
    payment_intent_data: {
      description: LABELS[plan],
    },
    allow_promotion_codes: true,
    success_url: `${base}/portal/dashboard?payment=success&plan=${plan}`,
    cancel_url:  `${base}/portal/dashboard?payment=cancelled`,
  });

  return Response.json({ url: session.url });
}

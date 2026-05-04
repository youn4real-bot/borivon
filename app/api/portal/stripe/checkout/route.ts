import { NextRequest } from "next/server";
import Stripe from "stripe";
import { requireUser } from "@/lib/admin-auth";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key);
}

const PRICE: Record<string, string | undefined> = {
  kandidat:             process.env.STRIPE_PRICE_KANDIDAT,
  kandidat_installment: process.env.STRIPE_PRICE_KANDIDAT_INSTALLMENT,
};

const LABELS: Record<string, string> = {
  kandidat:             "Kandidat — €99",
  kandidat_installment: "Kandidat — €20/month × 5",
};

/**
 * POST /api/portal/stripe/checkout
 * Body: { plan: "kandidat" | "kandidat_installment" }
 * Returns: { url: string }  — Stripe-hosted checkout URL
 *
 * kandidat             → one-time €99 payment (mode: "payment")
 * kandidat_installment → €20/month subscription for 5 months (mode: "subscription")
 *   Set STRIPE_PRICE_KANDIDAT_INSTALLMENT to a recurring €20/month Stripe price.
 *   Cancel the subscription after 5 successful payments via the webhook or
 *   Stripe's built-in subscription schedule.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const plan: "kandidat" | "kandidat_installment" =
    body.plan === "kandidat_installment" ? "kandidat_installment" : "kandidat";

  const priceId = PRICE[plan];
  if (!priceId) {
    return Response.json({ error: "Stripe price not configured — add env vars." }, { status: 500 });
  }

  let stripe: Stripe;
  try { stripe = getStripe(); }
  catch { return Response.json({ error: "Payment not configured yet." }, { status: 503 }); }

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.borivon.com";
  const isInstallment = plan === "kandidat_installment";

  const session = await stripe.checkout.sessions.create({
    mode: isInstallment ? "subscription" : "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { userId: auth.userId, plan },
    customer_email: auth.email ?? undefined,
    ...(isInstallment ? {} : {
      payment_intent_data: { description: LABELS[plan] },
    }),
    allow_promotion_codes: true,
    success_url: `${base}/portal/dashboard?payment=success&plan=${plan}`,
    cancel_url:  `${base}/portal/dashboard?payment=cancelled`,
  });

  return Response.json({ url: session.url });
}

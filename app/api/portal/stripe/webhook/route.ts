import { NextRequest } from "next/server";
import Stripe from "stripe";
import { getServiceSupabase } from "@/lib/supabase";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key);
}

/**
 * POST /api/portal/stripe/webhook
 *
 * Stripe sends events here after payment.
 * On checkout.session.completed → update candidate_profiles.payment_tier.
 *
 * Register this URL in Stripe Dashboard → Developers → Webhooks:
 *   https://www.borivon.com/api/portal/stripe/webhook
 * Events to listen for: checkout.session.completed
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig     = req.headers.get("stripe-signature") ?? "";
  const secret  = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  if (!secret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET not set");
    return Response.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  let stripe: Stripe;
  try { stripe = getStripe(); }
  catch { return Response.json({ error: "Payment not configured" }, { status: 503 }); }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error("[stripe webhook] signature invalid:", err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId  = session.metadata?.userId;
    const plan    = session.metadata?.plan;

    if (!userId || !plan) {
      console.error("[stripe webhook] missing metadata", session.metadata);
      return Response.json({ received: true });
    }

    const db = getServiceSupabase();

    // Upsert so it works whether the profile row exists or not
    const { error } = await db
      .from("candidate_profiles")
      .upsert({ user_id: userId, payment_tier: plan }, { onConflict: "user_id" });

    if (error) {
      console.error("[stripe webhook] failed to update payment_tier:", error);
      return Response.json({ error: "DB update failed" }, { status: 500 });
    }

    console.log(`[stripe webhook] ${plan} payment recorded for ${userId}`);
  }

  return Response.json({ received: true });
}

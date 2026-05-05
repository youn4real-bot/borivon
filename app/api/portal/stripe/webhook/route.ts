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
 *
 * Events handled:
 *   - checkout.session.completed → set candidate_profiles.payment_tier = 'premium'
 *   - invoice.paid (subscription)  → enforce 6-cycle cap on premium_monthly
 *
 * Register this URL in Stripe Dashboard → Developers → Webhooks:
 *   https://www.borivon.com/api/portal/stripe/webhook
 *
 * NOTE: After regenerating the webhook secret in Stripe, update
 * STRIPE_WEBHOOK_SECRET in Vercel env vars.
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

  const db = getServiceSupabase();

  // ── checkout.session.completed → unlock premium tier ─────────────────────
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId  = session.metadata?.userId;
    const planRaw = session.metadata?.plan;

    if (!userId || !planRaw) {
      console.error("[stripe webhook] missing metadata", session.metadata);
      return Response.json({ received: true });
    }

    // Allowlist — both premium plan codes resolve to the same DB tier.
    if (planRaw !== "premium_onetime" && planRaw !== "premium_monthly") {
      console.error("[stripe webhook] unknown plan rejected:", planRaw);
      return Response.json({ error: "Unknown plan" }, { status: 400 });
    }

    const { error } = await db
      .from("candidate_profiles")
      .upsert({ user_id: userId, payment_tier: "premium" }, { onConflict: "user_id" });

    if (error) {
      // 500 forces Stripe to retry — better double-process than lose payment.
      console.error("[stripe webhook] failed to update payment_tier:", error);
      return Response.json({ error: "DB update failed" }, { status: 500 });
    }

    console.log(`[stripe webhook] premium (${planRaw}) recorded for ${userId}`);
    return Response.json({ received: true });
  }

  // ── invoice.paid → cap premium_monthly at 6 cycles ───────────────────────
  // We can't rely on Stripe's recurring price metadata to limit cycles, so we
  // count successful invoices on the subscription and cancel it after the 6th.
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    // Subscription invoices have an attached subscription — non-subscription
    // invoices (e.g. one-off charges) don't.
    const subId = typeof (invoice as unknown as { subscription?: string | null }).subscription === "string"
      ? (invoice as unknown as { subscription: string }).subscription
      : null;
    if (!subId) return Response.json({ received: true });

    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      const max = parseInt(sub.metadata?.max_cycles ?? "0", 10);
      if (!max || sub.metadata?.plan !== "premium_monthly") {
        return Response.json({ received: true });
      }

      // Count paid invoices on this subscription. Stripe paginates at 100,
      // which is well above our cap (6) — single page is enough.
      const invoices = await stripe.invoices.list({ subscription: subId, status: "paid", limit: 100 });
      const paidCount = invoices.data.length;

      if (paidCount >= max && sub.status !== "canceled") {
        await stripe.subscriptions.cancel(subId);
        console.log(`[stripe webhook] premium_monthly cap reached (${paidCount}/${max}) — cancelled ${subId}`);
      }
    } catch (err) {
      console.error("[stripe webhook] cycle-cap enforcement failed:", err);
      // Don't 500 the webhook — Stripe would retry the invoice.paid event
      // forever and the customer is already paid up.
    }
    return Response.json({ received: true });
  }

  return Response.json({ received: true });
}

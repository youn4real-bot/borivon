import { NextRequest } from "next/server";
import Stripe from "stripe";
import { getServiceSupabase, getAuthSchemaClient } from "@/lib/supabase";
import { ciEmail } from "@/lib/admin-auth";

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
 *   - checkout.session.completed    → set candidate_profiles.payment_tier = 'premium'
 *   - customer.subscription.deleted → revoke premium (monthly cancel / dunning end)
 *   - invoice.paid                  → log-only (recurring cycle visibility)
 *
 * Register this URL in Stripe Dashboard → Developers → Webhooks AND enable the
 * `customer.subscription.deleted` event there (otherwise cancellations won't
 * reach us and premium would never be revoked):
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

  // ── customer.subscription.deleted → revoke premium ───────────────────────
  // Monthly subs only — one-time payments create NO subscription, so their
  // premium stays permanent (intended). Fires on candidate cancel AND when
  // Stripe ends the sub after dunning (repeated failed payments) gives up.
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    let userId = (sub.metadata?.userId ?? "").trim();

    // Fallback for any legacy sub created without userId metadata: map the
    // Stripe customer's email → auth.users → candidate_profiles.
    if (!userId && sub.customer) {
      try {
        const custId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const cust = await stripe.customers.retrieve(custId);
        const email = "deleted" in cust ? "" : (cust.email ?? "").trim().toLowerCase();
        if (email) {
          const { data: u } = await getAuthSchemaClient()
            .from("users").select("id").ilike("email", ciEmail(email)).limit(1).maybeSingle();
          userId = (u as { id: string } | null)?.id ?? "";
        }
      } catch (e) {
        console.warn("[stripe webhook] subscription.deleted email fallback failed:", e);
      }
    }

    if (!userId) {
      console.warn(`[stripe webhook] subscription.deleted with no resolvable user (sub=${sub.id})`);
      return Response.json({ received: true });
    }

    const { error } = await db
      .from("candidate_profiles")
      .update({ payment_tier: "free" })
      .eq("user_id", userId);
    if (error) {
      console.error("[stripe webhook] failed to revoke payment_tier:", error);
      return Response.json({ error: "DB update failed" }, { status: 500 });
    }
    console.log(`[stripe webhook] premium revoked (subscription canceled) for ${userId}`);
    return Response.json({ received: true });
  }

  // ── invoice.paid → recurring monthly cycle ───────────────────────────────
  // Monthly subscriptions run uncapped (founder decision). This handler is
  // log-only for visibility in Vercel logs.
  if (event.type === "invoice.paid") {
    const inv = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } };
    const subRaw = inv.subscription;
    const subId = typeof subRaw === "string" ? subRaw : subRaw?.id ?? null;
    console.log(`[stripe webhook] invoice.paid sub=${subId} amount=${inv.amount_paid} cycle=${inv.metadata?.cycle ?? "?"} event=${event.id}`);
    return Response.json({ received: true });
  }

  return Response.json({ received: true });
}

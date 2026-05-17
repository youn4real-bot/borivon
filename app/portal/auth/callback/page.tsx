"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Suspense } from "react";
import { Spinner } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";

// Minimal translations for the auth callback page
const CB_T = {
  fr: {
    invalid: "Le lien est invalide ou a expiré. Veuillez vous inscrire à nouveau.",
    verifying: "Vérification en cours…",
    back: "Retour à l'accueil",
  },
  en: {
    invalid: "The link is invalid or has expired. Please sign up again.",
    verifying: "Verifying…",
    back: "Back to home",
  },
  de: {
    invalid: "Der Link ist ungültig oder abgelaufen. Bitte erneut registrieren.",
    verifying: "Wird überprüft…",
    back: "Zurück zur Startseite",
  },
} as const;

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");
  const { lang } = useLang();
  const cbT = CB_T[lang] ?? CB_T.fr;

  useEffect(() => {
    // Cleanup tokens are hoisted into the synchronous effect scope so the
    // effect's returned cleanup actually fires. Previously the cleanup was
    // returned from inside an async function — useEffect only saw the
    // Promise, so the auth listener and timeout leaked across navigations.
    let cancelled = false;
    let subscription: ReturnType<typeof supabase.auth.onAuthStateChange>["data"]["subscription"] | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // ONE routing path for EVERY auth outcome: redeem any pending invite,
    // then route by the redeemed type OR the server-resolved role. This is
    // why a sub-admin could still land on the candidate dashboard — the
    // fallback branches below used to hardcode /portal/dashboard with no
    // redeem and no role check.
    const routeAfter = async (accessToken: string) => {
      const inviteCode = params.get("invite")
        || (typeof window !== "undefined" ? localStorage.getItem("bv_invite_code") : null);
      let inviteType: string | null = null;
      if (inviteCode && accessToken) {
        try {
          const r = await fetch(`/api/portal/invite/${encodeURIComponent(inviteCode)}`, {
            method: "POST", headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (r.ok) inviteType = (await r.json()).type ?? null;
        } catch { /* ignore */ }
        try { localStorage.removeItem("bv_invite_code"); } catch { /* ignore */ }
      }
      if (inviteType === "member")    { router.replace("/portal/org/dashboard"); return; }
      if (inviteType === "sub-admin") { router.replace("/portal/admin"); return; }
      // No invite (or candidate invite) → trust the server role so an
      // existing sub-admin/org account never gets the candidate dashboard.
      if (accessToken) {
        try {
          const rr = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${accessToken}` } });
          const j = await rr.json().catch(() => ({}));
          if (j?.role === "admin" || j?.role === "sub_admin") { router.replace("/portal/admin"); return; }
          if (j?.role === "org_member") { router.replace("/portal/org/dashboard"); return; }
        } catch { /* offline — fall through */ }
      }
      router.replace("/portal/dashboard");
    };

    (async () => {
      const code = params.get("code");
      if (code) {
        let sessionData: Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>>["data"] | null = null;
        try {
          const res = await supabase.auth.exchangeCodeForSession(code);
          if (cancelled) return;
          if (res.error) {
            setError(cbT.invalid);
            return;
          }
          sessionData = res.data;
        } catch {
          if (cancelled) return;
          setError(cbT.invalid);
          return;
        }
        const user = sessionData?.user;
        const accessToken = sessionData?.session?.access_token ?? "";
        if (user?.created_at && accessToken) {
          const ageSec = (Date.now() - new Date(user.created_at).getTime()) / 1000;
          if (ageSec < 600) {
            fetch("/api/portal/admin/signup-notify", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            }).catch(() => {});
          }
        }
        await routeAfter(accessToken);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        await routeAfter(session.access_token ?? "");
        return;
      }

      const sub = supabase.auth.onAuthStateChange((event, session) => {
        if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
          routeAfter(session.access_token ?? "");
        }
      });
      subscription = sub.data.subscription;

      // Issue 2.2: 30 s — slow mobile connections need longer than 8 s
      timeoutId = setTimeout(() => {
        if (!cancelled) setError(cbT.invalid);
      }, 30_000);
    })();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [params, router, cbT]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4"
        style={{ background: "var(--bg, #161614)" }}>
        <div className="w-full max-w-sm text-center">
          <p className="text-[1.05rem] font-semibold tracking-[0.18em] uppercase mb-7"
            style={{ color: "var(--gold, #c9a240)" }}>Borivon</p>
          <p className="text-[13.5px] mb-6" style={{ color: "rgba(238,236,234,0.55)" }}>{error}</p>
          <a href="/portal" className="text-sm underline underline-offset-4"
            style={{ color: "var(--gold, #c9a240)" }}>
            {cbT.back}
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--bg, #161614)" }}>
      <div className="text-center">
        <p className="text-[1.05rem] font-semibold tracking-[0.18em] uppercase mb-7"
          style={{ color: "var(--gold, #c9a240)" }}>Borivon</p>
        <div className="flex justify-center"><Spinner size="lg" /></div>
        <p className="mt-4 text-[12.5px]" style={{ color: "rgba(238,236,234,0.5)" }}>
          {cbT.verifying}
        </p>
      </div>
    </main>
  );
}

function CallbackFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--bg, #161614)" }}>
      <div className="text-center">
        <p className="text-[1.05rem] font-semibold tracking-[0.18em] uppercase mb-7"
          style={{ color: "var(--gold, #c9a240)" }}>Borivon</p>
        <div className="flex justify-center"><Spinner size="lg" /></div>
      </div>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackFallback />}>
      <CallbackInner />
    </Suspense>
  );
}

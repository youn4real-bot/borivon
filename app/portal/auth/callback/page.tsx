"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Suspense } from "react";
import { Spinner } from "@/components/ui/states";

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    // Cleanup tokens are hoisted into the synchronous effect scope so the
    // effect's returned cleanup actually fires. Previously the cleanup was
    // returned from inside an async function — useEffect only saw the
    // Promise, so the auth listener and timeout leaked across navigations.
    let cancelled = false;
    let subscription: ReturnType<typeof supabase.auth.onAuthStateChange>["data"]["subscription"] | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const code = params.get("code");
      if (code) {
        const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (error) {
          setError("Le lien est invalide ou a expiré. Veuillez vous inscrire à nouveau.");
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
        router.replace("/portal/dashboard");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        router.replace("/portal/dashboard");
        return;
      }

      const sub = supabase.auth.onAuthStateChange((event, session) => {
        if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
          router.replace("/portal/dashboard");
        }
      });
      subscription = sub.data.subscription;

      timeoutId = setTimeout(() => {
        if (!cancelled) setError("Le lien est invalide ou a expiré. Veuillez vous inscrire à nouveau.");
      }, 8000);
    })();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [params, router]);

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
            Retour à l&apos;accueil
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
          Vérification en cours…
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

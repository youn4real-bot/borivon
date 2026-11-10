"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ArrivalPanel } from "@/components/fx/ArrivalPanel";

/**
 * A nurse's arrival plan, seen by her facility or Borivon (founder 2026-11-10). Access is decided by
 * the API (canActOnCandidate), so a DIY facility only ever reaches its own nurses.
 */
export default function Page() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

function Inner() {
  const { userId } = useParams<{ userId: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace(`/portal?next=/portal/admin/ankunft/${userId}`);
      else setOk(true);
    });
  }, [router, userId]);
  return (
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "88px" }}>
      {ok && <ArrivalPanel userId={userId} name={sp.get("name") ?? undefined} />}
    </main>
  );
}

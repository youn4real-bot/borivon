"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ArrivalPanel } from "@/components/fx/ArrivalPanel";

/** The nurse's own arrival plan (founder 2026-11-10: the first weeks, step by step, offices nearby). */
export default function Page() {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/portal?next=/portal/ankunft");
      else setOk(true);
    });
  }, [router]);
  return (
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "88px" }}>
      {ok && <ArrivalPanel />}
    </main>
  );
}

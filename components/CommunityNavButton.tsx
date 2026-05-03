"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";

const LABEL = { fr: "Communauté", en: "Community", de: "Community" } as const;

/**
 * Top-left Community nav link — visible to admins and candidates only.
 * Org members (partner organisations) do not see it.
 */
export function CommunityNavButton() {
  const pathname = usePathname() ?? "";
  const { lang } = useLang();
  const [show, setShow] = useState(false);
  const isActive = pathname === "/portal/feed";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch("/api/portal/me/role", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).catch(() => null);
      if (!res?.ok || cancelled) return;

      const json = await res.json().catch(() => null);
      if (!cancelled && json?.role !== "org_member") setShow(true);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;

  return (
    <a
      href="/portal/feed"
      className="hidden sm:inline-flex items-center gap-1.5 text-[13px] font-semibold no-underline transition-all duration-150 hover:opacity-100 active:scale-95"
      style={{
        color: isActive ? "var(--gold)" : "var(--w3)",
        letterSpacing: "-0.01em",
      }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.color = "var(--w)"; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.color = "var(--w3)"; }}
    >
      <span style={{ fontSize: 15 }}>✦</span>
      {LABEL[lang as keyof typeof LABEL] ?? LABEL.en}
    </a>
  );
}

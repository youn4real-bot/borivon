"use client";

// Legacy /p/<slug> URLs — redirect to the new canonical /<slug>.
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function LegacyProfileRedirect() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug ?? "";
  useEffect(() => {
    if (slug) router.replace(`/${slug}`);
  }, [slug, router]);
  return (
    <main className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <p className="text-sm" style={{ color: "var(--w3)" }}>…</p>
    </main>
  );
}

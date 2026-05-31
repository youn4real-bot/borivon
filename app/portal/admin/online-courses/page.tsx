"use client";

/**
 * Admin list of online-course registrations (supreme admin + sub-admins).
 * Reached from the profile-avatar menu → "Online Courses". Read-only.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { ArrowLeft, Mail, Phone, MapPin, Clock } from "lucide-react";

type Reg = {
  id: string; first_name: string; last_name: string; email: string;
  phone: string; address: string; group_slot: string; level: string; created_at: string;
};

export default function AdminOnlineCoursesPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [loading, setLoading] = useState(true);
  const [regs, setRegs] = useState<Reg[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      // Fresh token (same stale-token guard as the other portal pages).
      let token = session.access_token ?? "";
      const expMs = (session.expires_at ?? 0) * 1000;
      if (!expMs || expMs - Date.now() < 60_000) {
        try { const { data: r } = await supabase.auth.refreshSession(); if (r?.session?.access_token) token = r.session.access_token; } catch { /* keep token */ }
        if (cancelled) return;
      }
      const res = await fetch("/api/portal/admin/online-courses", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 || res.status === 403) { router.replace("/portal/dashboard"); return; }
      const j = await res.json().catch(() => ({ registrations: [] }));
      if (cancelled) return;
      setRegs((j.registrations ?? []) as Reg[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  if (loading) return <PageLoader />;

  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
    } catch { return iso; }
  };

  return (
    <main id="bv-main" className="mx-auto px-5 py-8 sm:py-12 bv-page-bottom" style={{ maxWidth: 920 }}>
      <button onClick={() => router.push("/portal/admin")} className="bv-btn bv-btn-ghost mb-6 inline-flex">
        <ArrowLeft size={15} strokeWidth={2} /> {T("Back to admin", "Zurück zum Admin", "Retour à l'admin")}
      </button>

      <div className="mb-6">
        <h1 className="bv-h1">{T("Online Courses", "Online-Kurse", "Cours en ligne")}</h1>
        <p className="bv-body mt-1">
          {regs.length}{" "}
          {T("registration(s) from the public /online-courses page",
             "Anmeldung(en) von der öffentlichen Seite /online-courses",
             "inscription(s) depuis la page publique /online-courses")}
        </p>
      </div>

      {regs.length === 0 ? (
        <div className="text-center py-16 text-[14px]" style={{ color: "var(--w3)" }}>
          {T("No registrations yet.", "Noch keine Anmeldungen.", "Aucune inscription pour le moment.")}
        </div>
      ) : (
        <div className="space-y-3">
          {regs.map((r) => (
            <div key={r.id} className="p-4 sm:p-5"
              style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>
                    {`${r.first_name} ${r.last_name}`.trim() || "—"}
                  </p>
                  <div className="mt-1.5 flex flex-col gap-1 text-[13px]" style={{ color: "var(--w2)" }}>
                    <span className="inline-flex items-center gap-1.5">
                      <Mail size={13} style={{ color: "var(--w3)", flexShrink: 0 }} />
                      <a className="bv-link break-all" href={`mailto:${r.email}`}>{r.email}</a>
                    </span>
                    {r.phone && (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone size={13} style={{ color: "var(--w3)", flexShrink: 0 }} /> {r.phone}
                      </span>
                    )}
                    {r.address && (
                      <span className="inline-flex items-start gap-1.5">
                        <MapPin size={13} style={{ color: "var(--w3)", flexShrink: 0, marginTop: 2 }} /> {r.address}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <div className="flex flex-wrap justify-end gap-2">
                    {r.group_slot && <span className="bv-chip">{r.group_slot}</span>}
                    {r.level && <span className="bv-chip bv-chip-gold">{r.level}</span>}
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--w3)" }}>
                    <Clock size={12} /> {fmt(r.created_at)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

"use client";

/**
 * ACADEMY — live class (Daily video, embedded in-app).
 *
 * Loads the candidate's join URL from /api/portal/academy/class and embeds the
 * Daily room so students never leave Borivon. Attendance is captured server-side
 * via the Daily webhook (no client trust). If Daily isn't configured yet, shows
 * a friendly "video not ready" state. Trilingual per LAW #19.
 */
import { useEffect, useState, Suspense } from "react";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { PageLoader } from "@/components/ui/states";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Video } from "lucide-react";

function ClassInner() {
  const { lang } = useLang();
  const router = useRouter();
  const id = useSearchParams().get("id") ?? "";

  const T = {
    en: { class: "Live class", notReady: "Video not ready", notReadySub: "Your teacher hasn't opened the room yet. Check back at class time.", ended: "This class has ended.", back: "Back to Academy" },
    fr: { class: "Cours en direct", notReady: "Vidéo pas prête", notReadySub: "Ton prof n'a pas encore ouvert la salle. Reviens à l'heure du cours.", ended: "Ce cours est terminé.", back: "Retour à l'Académie" },
    de: { class: "Live-Kurs", notReady: "Video nicht bereit", notReadySub: "Deine Lehrkraft hat den Raum noch nicht geöffnet. Komm zur Kurszeit wieder.", ended: "Dieser Kurs ist beendet.", back: "Zurück zur Akademie" },
  };
  const L = T[lang] ?? T.en;

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<{ title: string; joinUrl: string | null; ended: boolean } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      if (id) {
        const r = await fetch(`/api/portal/academy/class?id=${id}`, { headers: { Authorization: `Bearer ${tk}` } });
        const j = await r.json().catch(() => null);
        if (j && !j.error) setInfo(j);
      }
      setLoading(false);
    });
  }, [router, id]);

  if (loading) return <PageLoader />;

  const canJoin = info?.joinUrl && !info.ended;

  return (
    <main id="bv-main" tabIndex={-1} className="min-h-screen flex flex-col" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <button onClick={() => router.push("/portal/academy")} className="flex items-center justify-center rounded-full"
          style={{ width: 34, height: 34, background: "var(--bg2)", border: "1px solid var(--border)", cursor: "pointer", flexShrink: 0 }} aria-label={L.back}>
          <ChevronLeft size={20} strokeWidth={2.2} style={{ color: "var(--w2)" }} />
        </button>
        <span className="text-[16px] font-extrabold truncate" style={{ color: "var(--w)" }}>{info?.title || L.class}</span>
      </div>

      {canJoin ? (
        <iframe
          src={info!.joinUrl!}
          title={info?.title || L.class}
          allow="camera; microphone; fullscreen; speaker; display-capture; autoplay"
          className="flex-1 w-full"
          style={{ border: "none", minHeight: "calc(100vh - 110px)" }}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
          <span className="flex items-center justify-center rounded-full mb-4" style={{ width: 72, height: 72, background: "var(--bg2)" }}>
            <Video size={32} strokeWidth={1.7} style={{ color: "var(--w3)" }} />
          </span>
          <div className="text-[18px] font-extrabold mb-1" style={{ color: "var(--w)" }}>{info?.ended ? L.class : L.notReady}</div>
          <div className="text-[13px] mb-6 max-w-[300px]" style={{ color: "var(--w3)" }}>{info?.ended ? L.ended : L.notReadySub}</div>
          <button onClick={() => router.push("/portal/academy")} className="px-5 py-3 rounded-2xl text-[14px] font-extrabold" style={{ background: "var(--gold)", color: "#131312", border: "none", cursor: "pointer" }}>
            {L.back}
          </button>
        </div>
      )}
    </main>
  );
}

export default function AcademyClassPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ClassInner />
    </Suspense>
  );
}

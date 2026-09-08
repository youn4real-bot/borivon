"use client";

/** Landing at affiliates.borivon.com (no token). Points affiliates to their
 *  private dashboard link. Its own chrome (global navbar is suppressed on the
 *  affiliate subdomain). Translated FR/EN/DE with a self-contained toggle. */
import { useState } from "react";
import { Link2, Mail, LogIn } from "lucide-react";

const CONTACT_EMAIL = "contact@borivon.com";

export default function AffiliateLanding() {
  const [lang, setLang] = useState<"fr" | "en" | "de">("fr");
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--w)", display: "flex", flexDirection: "column" }}>
      <header className="flex items-center justify-between px-5 sm:px-8 h-[58px] border-b" style={{ borderColor: "var(--border)", background: "var(--nav-bg)" }}>
        <span className="font-[family-name:var(--font-dm-serif)] italic" style={{ fontSize: "1.3rem" }}>
          Borivon<span style={{ color: "var(--gold)" }} className="not-italic">.</span>
          <span className="not-italic ml-2 align-middle text-[11px] font-semibold tracking-wide" style={{ color: "var(--w3)" }}>{L("AFFILIATE", "AFFILIÉ", "AFFILIATE")}</span>
        </span>
        <div className="flex gap-1">
          {(["fr", "en", "de"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)}
              className="text-[11px] font-bold px-2 py-1 rounded-md uppercase"
              style={{ color: lang === l ? "#1a1205" : "var(--w3)", background: lang === l ? "var(--gold)" : "transparent", border: "none", cursor: "pointer" }}>
              {l}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[440px] text-center">
          <span className="inline-flex w-14 h-14 rounded-2xl items-center justify-center mb-5" style={{ background: "var(--gdim)", color: "var(--gold)" }}>
            <Link2 size={26} strokeWidth={1.8} />
          </span>
          <h1 className="text-[23px] font-bold tracking-tight" style={{ color: "var(--w)" }}>
            {L("Borivon Affiliate Portal", "Espace Affilié Borivon", "Borivon Affiliate-Portal")}
          </h1>
          <p className="text-[13.5px] mt-3 leading-relaxed" style={{ color: "var(--w2)" }}>
            {L("Earn a commission for every nurse you refer to Borivon who is placed in Germany.",
               "Gagnez une commission pour chaque infirmière que vous recommandez à Borivon et qui est placée en Allemagne.",
               "Verdienen Sie eine Provision für jede von Ihnen empfohlene Pflegekraft, die über Borivon in Deutschland vermittelt wird.")}
          </p>
          <div className="rounded-2xl p-4 mt-6 text-left" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--w2)" }}>
              {L("Open your personal dashboard using the private link Borivon gave you — it shows your referral link, your placements and what you've earned.",
                 "Ouvrez votre tableau de bord avec le lien privé que Borivon vous a remis — il affiche votre lien de parrainage, vos placements et vos gains.",
                 "Öffnen Sie Ihr persönliches Dashboard über den privaten Link von Borivon — es zeigt Ihren Empfehlungslink, Ihre Vermittlungen und Ihre Einnahmen.")}
            </p>
          </div>
          <p className="text-[12.5px] mt-6" style={{ color: "var(--w3)" }}>
            {L("Don't have your link yet?", "Vous n'avez pas encore votre lien ?", "Sie haben Ihren Link noch nicht?")}
          </p>
          <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(L("Affiliate program", "Programme d'affiliation", "Affiliate-Programm"))}`}
            className="inline-flex items-center gap-2 mt-3 px-5 py-2.5 rounded-full text-[13px] font-semibold no-underline"
            style={{ background: "var(--gold)", color: "#1a1205" }}>
            <Mail size={15} /> {L("Contact Borivon", "Contacter Borivon", "Borivon kontaktieren")}
          </a>
          <p className="text-[11.5px] mt-3" style={{ color: "var(--w3)" }}>{CONTACT_EMAIL}</p>
          {/* Borivon team entry — logs the admin in and lands them on their
              affiliate management dashboard (create partners, copy links). */}
          <div className="mt-8 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
            <a href="https://www.borivon.com/portal?next=/portal/admin/affiliates"
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold no-underline"
              style={{ color: "var(--w2)" }}>
              <LogIn size={13} /> {L("Borivon team — log in", "Équipe Borivon — connexion", "Borivon-Team — Anmelden")}
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

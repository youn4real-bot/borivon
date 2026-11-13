"use client";

/** Landing at affiliates.borivon.com (no token). Points affiliates to their
 *  private dashboard link. Its own chrome (global navbar is suppressed on the
 *  affiliate subdomain). Translated FR/EN/DE with a self-contained toggle.
 *  The one design (founder 2026-11-13, components/fx/kit): serif title, one hairline card, one black pill. */
import { Wordmark } from "@/components/Wordmark";
import { useState } from "react";
import { Mail, LogIn } from "lucide-react";
import { KitStyle, Card, Seg } from "@/components/fx/kit";

const CONTACT_EMAIL = "contact@borivon.com";

export default function AffiliateLanding() {
  const [lang, setLang] = useState<"fr" | "en" | "de">("fr");
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--w)", display: "flex", flexDirection: "column" }}>
      <KitStyle />
      <header className="flex items-center justify-between px-5 sm:px-8 h-[58px] border-b" style={{ borderColor: "var(--border)", background: "var(--nav-bg)", gap: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Wordmark size="1.3rem" />
          <span style={{ paddingLeft: 10, borderLeft: "1px solid var(--border)", fontSize: 13, lineHeight: "16px", color: "var(--w3)", whiteSpace: "nowrap" }}>{L("Affiliate", "Affilié", "Affiliate")}</span>
        </span>
        <Seg value={lang} onChange={setLang} options={[["fr", "FR"], ["en", "EN"], ["de", "DE"]]} />
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[440px] text-center">
          <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 34, lineHeight: 1.1, letterSpacing: "-.01em", color: "var(--w)" }}>
            {L("Borivon Affiliate Portal", "Espace Affilié Borivon", "Borivon Affiliate-Portal")}
          </h1>
          <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.55, color: "var(--w3)" }}>
            {L("Earn a commission for every nurse you refer to Borivon who is placed in Germany.",
               "Gagnez une commission pour chaque infirmière que vous recommandez à Borivon et qui est placée en Allemagne.",
               "Verdienen Sie eine Provision für jede von Ihnen empfohlene Pflegekraft, die über Borivon in Deutschland vermittelt wird.")}
          </p>
          <Card style={{ marginTop: 24, padding: "16px 18px", textAlign: "left" }}>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--w2)" }}>
              {L("Open your personal dashboard using the private link Borivon gave you — it shows your referral link, your placements and what you've earned.",
                 "Ouvrez votre tableau de bord avec le lien privé que Borivon vous a remis — il affiche votre lien de parrainage, vos placements et vos gains.",
                 "Öffnen Sie Ihr persönliches Dashboard über den privaten Link von Borivon — es zeigt Ihren Empfehlungslink, Ihre Vermittlungen und Ihre Einnahmen.")}
            </p>
          </Card>
          <p style={{ margin: "26px 0 0", fontSize: 13, color: "var(--w3)" }}>
            {L("Don't have your link yet?", "Vous n'avez pas encore votre lien ?", "Sie haben Ihren Link noch nicht?")}
          </p>
          <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(L("Affiliate program", "Programme d'affiliation", "Affiliate-Programm"))}`}
            className="bvk-btn bvk-primary" style={{ marginTop: 12 }}>
            <Mail size={15} /> {L("Contact Borivon", "Contacter Borivon", "Borivon kontaktieren")}
          </a>
          <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--w3)" }}>{CONTACT_EMAIL}</p>
          {/* Borivon team entry — logs the admin in and lands them on their
              affiliate management dashboard (create partners, copy links). */}
          <div style={{ marginTop: 30, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
            <a href="https://www.borivon.com/portal?next=/portal/admin/affiliates"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--w3)", textDecoration: "none" }}>
              <LogIn size={13} /> {L("Borivon team — log in", "Équipe Borivon — connexion", "Borivon-Team — Anmelden")}
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

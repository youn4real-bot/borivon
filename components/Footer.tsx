"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "./LangContext";
import { Dialog } from "./ui/dialog";
import { Mail, Phone, Check } from "lucide-react";
import { isValidEmail } from "@/lib/utils";

export function Footer() {
  const { t, lang } = useLang();
  const router = useRouter();
  const [contactOpen, setContactOpen] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [contactMsg, setContactMsg] = useState("");
  const [contactSent, setContactSent] = useState(false);
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactError, setContactError] = useState(false);

  const cookieLabels = {
    fr: "Paramètres des cookies",
    en: "Cookie Settings",
    de: "Cookie-Einstellungen",
  };
  const refundLabels = {
    fr: "Politique de remboursement",
    en: "Refund Policy",
    de: "Rückerstattungsrichtlinie",
  };

  const contactLabels = {
    fr: {
      title: "Nous contacter",
      emailLbl: "Votre e-mail",
      msgLbl: "Votre message",
      msgOpt: "(optionnel)",
      ph: "vous@exemple.com",
      phMsg: "Comment pouvons-nous vous aider ?",
      send: "Envoyer",
      sent: "Message envoyé — nous vous répondrons dans les 48 h.",
    },
    en: {
      title: "Contact us",
      emailLbl: "Your email",
      msgLbl: "Your message",
      msgOpt: "(optional)",
      ph: "you@example.com",
      phMsg: "How can we help you?",
      send: "Send message",
      sent: "Message sent — we'll get back to you within 48 h.",
    },
    de: {
      title: "Kontakt",
      emailLbl: "Ihre E-Mail",
      msgLbl: "Ihre Nachricht",
      msgOpt: "(optional)",
      ph: "sie@beispiel.de",
      phMsg: "Wie können wir Ihnen helfen?",
      send: "Nachricht senden",
      sent: "Nachricht gesendet — wir melden uns innerhalb von 48 Stunden.",
    },
  };
  const cl = contactLabels[lang] ?? contactLabels.en;

  function openCookieSettings() {
    window.dispatchEvent(new Event("bv:open-cookie-settings"));
  }

  async function submitContact() {
    if (!isValidEmail(contactEmail)) { setContactError(true); return; }
    if (contactSubmitting) return;
    setContactSubmitting(true);
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "contact", email: contactEmail, message: contactMsg }),
      });
    } catch { /* ignore — lead still considered sent */ }
    setContactSubmitting(false);
    setContactSent(true);
  }

  function onCloseContact() {
    setContactOpen(false);
    setTimeout(() => {
      setContactSent(false);
      setContactEmail("");
      setContactMsg("");
      setContactError(false);
    }, 300);
  }

  return (
    <>
      <footer className="relative z-10 bg-bg2 border-t border-border px-4 sm:px-[3.5vw] pt-8 sm:pt-[2.5rem] pb-4 flex flex-col gap-4">
        {/* Main row */}
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-0">
          <div className="flex-1 sm:text-left font-[family-name:var(--font-dm-serif)] text-[1.15rem] italic text-w">
            Borivon<span className="text-gold not-italic">.</span>
          </div>

          <nav className="flex-1 flex justify-center gap-[4px] flex-wrap" aria-label="Legal links">
            {/* Contact — opens form modal */}
            <button
              onClick={() => setContactOpen(true)}
              className="foot-link text-[0.74rem] text-w3 px-[0.75rem] py-[0.4rem] rounded-[8px] hover:text-w hover:bg-bg/40 transition-all duration-200 cursor-pointer bg-transparent border-none"
            >
              {t.ftContact}
            </button>

            {/* Privacy Policy */}
            <button
              onClick={() => router.push("/privacy-policy")}
              className="foot-link text-[0.74rem] text-w3 px-[0.75rem] py-[0.4rem] rounded-[8px] hover:text-w hover:bg-bg/40 transition-all duration-200 cursor-pointer bg-transparent border-none"
            >
              {t.ftPrivacy}
            </button>

            {/* Terms */}
            <button
              onClick={() => router.push("/terms")}
              className="foot-link text-[0.74rem] text-w3 px-[0.75rem] py-[0.4rem] rounded-[8px] hover:text-w hover:bg-bg/40 transition-all duration-200 cursor-pointer bg-transparent border-none"
            >
              {t.ftTerms}
            </button>

            {/* Refund Policy */}
            <button
              onClick={() => router.push("/refund-policy")}
              className="foot-link text-[0.74rem] text-w3 px-[0.75rem] py-[0.4rem] rounded-[8px] hover:text-w hover:bg-bg/40 transition-all duration-200 cursor-pointer bg-transparent border-none"
            >
              {refundLabels[lang] ?? refundLabels.en}
            </button>

            {/* Cookie Settings */}
            <button
              onClick={openCookieSettings}
              className="foot-link text-[0.74rem] text-w3 px-[0.75rem] py-[0.4rem] rounded-[8px] hover:text-w hover:bg-bg/40 transition-all duration-200 cursor-pointer bg-transparent border-none"
            >
              {cookieLabels[lang] ?? cookieLabels.en}
            </button>
          </nav>

          <p className="flex-1 sm:text-right foot-copy-txt text-[0.68rem] text-w3 tracking-wide">{t.footerCopy}</p>
        </div>
      </footer>

      {/* Contact Modal */}
      <Dialog open={contactOpen} onClose={onCloseContact} title={cl.title}>
        {contactSent ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}
            >
              <Check size={20} style={{ color: "var(--gold)" }} />
            </div>
            <p className="text-[14px] leading-relaxed" style={{ color: "var(--w2)" }}>
              {cl.sent}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Contact info */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <Mail size={14} strokeWidth={1.7} style={{ color: "var(--gold)", flexShrink: 0 }} />
                <a
                  href="mailto:contact@borivon.com"
                  className="text-[13.5px] hover:underline"
                  style={{ color: "var(--gold)" }}
                >
                  contact@borivon.com
                </a>
              </div>
              <div className="flex items-center gap-3">
                <Phone size={14} strokeWidth={1.7} style={{ color: "var(--w3)", flexShrink: 0 }} />
                <a
                  href="tel:+4915731504759"
                  className="text-[13.5px] hover:underline"
                  style={{ color: "var(--w2)" }}
                >
                  +49 157 315 047 59
                </a>
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: "1px", background: "var(--border)" }} />

            {/* Form */}
            <div className="flex flex-col gap-3">
              <div>
                <label
                  htmlFor="bv-footer-contact-email"
                  className="block text-[11px] font-semibold tracking-[0.12em] uppercase mb-1.5"
                  style={{ color: "var(--w3)" }}
                >
                  {cl.emailLbl}{" "}
                  <span style={{ color: "var(--gold)" }} aria-hidden="true">✱</span>
                </label>
                <input
                  id="bv-footer-contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => { setContactEmail(e.target.value); setContactError(false); }}
                  placeholder={cl.ph}
                  required aria-required="true"
                  aria-invalid={contactError}
                  autoComplete="email"
                  className="w-full rounded-[10px] outline-none"
                  style={{
                    fontSize: "14px",
                    padding: "10px 14px",
                    background: "var(--bg2)",
                    border: `1px solid ${contactError ? "var(--danger-border)" : "var(--border2)"}`,
                    color: "var(--w)",
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor="bv-footer-contact-msg"
                  className="block text-[11px] font-semibold tracking-[0.12em] uppercase mb-1.5"
                  style={{ color: "var(--w3)" }}
                >
                  {cl.msgLbl}{" "}
                  <span style={{ color: "var(--w3)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                    {cl.msgOpt}
                  </span>
                </label>
                <textarea
                  id="bv-footer-contact-msg"
                  value={contactMsg}
                  onChange={(e) => setContactMsg(e.target.value)}
                  placeholder={cl.phMsg}
                  rows={3}
                  className="w-full rounded-[10px] outline-none resize-y leading-[1.6]"
                  style={{
                    fontSize: "14px",
                    padding: "10px 14px",
                    background: "var(--bg2)",
                    border: "1px solid var(--border2)",
                    color: "var(--w)",
                    minHeight: "80px",
                  }}
                />
              </div>
              <button
                onClick={submitContact}
                disabled={contactSubmitting}
                className="w-full font-bold cursor-pointer active:scale-[0.98] border-none"
                style={{
                  padding: "12px",
                  background: "var(--gold)",
                  color: "#131312",
                  borderRadius: "16px",
                  boxShadow: "var(--shadow-gold-lg)",
                  fontSize: "14px",
                  opacity: contactSubmitting ? 0.7 : 1,
                  transition: "opacity 0.2s, box-shadow 0.2s",
                }}
                onMouseEnter={(e) => { if (!contactSubmitting) (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-hover)"; }}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-gold-lg)")}
              >
                {cl.send}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

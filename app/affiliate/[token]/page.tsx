"use client";

/**
 * Affiliate self-serve dashboard — served at affiliates.borivon.com/<token>
 * (and www.borivon.com/affiliate/<token>). No login: the private token in the
 * URL IS the key. Read-only, no candidate PII — just the affiliate's own
 * numbers. Simple yet clear.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Copy, Check, Link2, Users, Plane, Wallet, Loader2, MessageCircle } from "lucide-react";
import { waMeUrl } from "@/lib/waLink";

type Earning = { placed_at: string; status: string; amount_eur: number };
type Stats = {
  name: string; active: boolean; currency: string; commissionEur: number;
  shareUrl: string; clicks: number; referred: number; placed: number;
  owedEur: number; paidEur: number; earnings: Earning[];
  termsAccepted: boolean; termsVersion: string;
};

export default function AffiliateDashboard() {
  const params = useParams();
  const token = String((params?.token as string) ?? "");
  const [lang, setLang] = useState<"en" | "fr" | "de">("fr");
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [copied, setCopied] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/affiliate/${encodeURIComponent(token)}`);
        if (!alive) return;
        if (!r.ok) { setState("notfound"); return; }
        setStats(await r.json());
        setState("ok");
      } catch { if (alive) setState("notfound"); }
    })();
    return () => { alive = false; };
  }, [token]);

  const money = (n: number) => {
    const s = (stats?.currency ?? "EUR") === "EUR" ? "€" : `${stats?.currency ?? ""} `;
    return `${s}${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };
  const acceptTerms = async () => {
    if (!agreed || accepting) return;
    setAccepting(true);
    try {
      const r = await fetch(`/api/affiliate/${encodeURIComponent(token)}`, { method: "POST" });
      if (r.ok) setStats((s) => (s ? { ...s, termsAccepted: true } : s));
    } catch { /* ignore */ }
    setAccepting(false);
  };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--w)" }}>
      {/* Minimal header (portal chrome is suppressed on /affiliate) */}
      <header className="flex items-center justify-between px-5 sm:px-8 h-[58px] border-b" style={{ borderColor: "var(--border)", background: "var(--nav-bg)" }}>
        <span className="font-[family-name:var(--font-dm-serif)] italic" style={{ fontSize: "1.3rem", color: "var(--w)" }}>
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

      <main className="mx-auto w-full max-w-[680px] px-5 sm:px-6 py-8">
        {state === "loading" && (
          <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin" style={{ color: "var(--gold)" }} /></div>
        )}

        {state === "notfound" && (
          <div className="text-center py-24">
            <p className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>{L("This link isn't valid.", "Ce lien n'est pas valide.", "Dieser Link ist ungültig.")}</p>
            <p className="text-[12.5px] mt-2" style={{ color: "var(--w3)" }}>{L("Ask Borivon for your personal affiliate link.", "Demandez à Borivon votre lien d'affilié personnel.", "Bitte fordern Sie Ihren persönlichen Affiliate-Link bei Borivon an.")}</p>
          </div>
        )}

        {/* Terms & Conditions gate — affiliate must declare + confirm before use. */}
        {state === "ok" && stats && !stats.termsAccepted && (() => {
          const terms: { t: string; b: string }[] = [
            { t: L("1. Independent referrer", "1. Apporteur indépendant", "1. Unabhängiger Vermittler"),
              b: L("You refer people to Borivon as an independent partner — not an employee or agent. You may not sign anything, collect documents or money, or make promises on Borivon's behalf.",
                   "Vous recommandez des personnes à Borivon en tant que partenaire indépendant — ni employé ni mandataire. Vous ne pouvez rien signer, ni collecter de documents ou d'argent, ni faire de promesses au nom de Borivon.",
                   "Sie empfehlen Borivon Personen als unabhängiger Partner — kein Angestellter oder Vertreter. Sie dürfen nichts unterschreiben, keine Dokumente oder Gelder einsammeln und keine Zusagen im Namen von Borivon machen.") },
            { t: L("2. Commission", "2. Commission", "2. Provision"),
              b: L("You earn a fixed amount for each nurse you refer whom Borivon CONFIRMS as placed in Germany (arrived). Borivon alone confirms a placement. Candidates who do not reach that stage earn nothing.",
                   "Vous gagnez un montant fixe pour chaque infirmière recommandée que Borivon CONFIRME comme placée en Allemagne (arrivée). Seul Borivon confirme un placement. Les candidats n'atteignant pas cette étape ne génèrent rien.",
                   "Sie erhalten einen festen Betrag für jede empfohlene Pflegekraft, die Borivon als in Deutschland vermittelt (angekommen) BESTÄTIGT. Nur Borivon bestätigt eine Vermittlung. Kandidaten, die diese Stufe nicht erreichen, bringen keine Provision.") },
            { t: L("3. Payment", "3. Paiement", "3. Zahlung"),
              b: L("Commission is due after Borivon confirms the placement and is paid by the agreed method. Your dashboard shows what is owed and what has been paid.",
                   "La commission est due après confirmation du placement par Borivon et payée selon la méthode convenue. Votre tableau de bord indique ce qui est dû et ce qui a été payé.",
                   "Die Provision ist nach Bestätigung der Vermittlung durch Borivon fällig und wird auf die vereinbarte Weise gezahlt. Ihr Dashboard zeigt Offenes und Bezahltes.") },
            { t: L("4. Honest referrals only", "4. Recommandations honnêtes uniquement", "4. Nur ehrliche Empfehlungen"),
              b: L("Refer real people who genuinely want to go to Germany. No spam, no misleading claims, no self-referral, no fake or duplicate sign-ups. Any abuse forfeits commissions and ends your participation.",
                   "Recommandez de vraies personnes réellement intéressées par l'Allemagne. Pas de spam, pas d'allégations trompeuses, pas d'auto-parrainage, pas d'inscriptions fausses ou en double. Tout abus entraîne la perte des commissions et la fin de votre participation.",
                   "Empfehlen Sie echte Personen mit echtem Interesse an Deutschland. Kein Spam, keine irreführenden Aussagen, keine Selbstempfehlung, keine gefälschten oder doppelten Anmeldungen. Missbrauch führt zum Verfall der Provisionen und zum Ausschluss.") },
            { t: L("5. Privacy", "5. Confidentialité", "5. Datenschutz"),
              b: L("You only ever see your own totals. You never receive candidates' personal data.",
                   "Vous ne voyez que vos propres totaux. Vous ne recevez jamais les données personnelles des candidats.",
                   "Sie sehen ausschließlich Ihre eigenen Summen. Sie erhalten niemals personenbezogene Daten der Kandidaten.") },
            { t: L("6. Changes", "6. Modifications", "6. Änderungen"),
              b: L("Borivon may update these terms or end the program at any time. Placements already confirmed are still paid.",
                   "Borivon peut modifier ces conditions ou mettre fin au programme à tout moment. Les placements déjà confirmés restent payés.",
                   "Borivon kann diese Bedingungen jederzeit ändern oder das Programm beenden. Bereits bestätigte Vermittlungen werden dennoch bezahlt.") },
          ];
          return (
            <div>
              <h1 className="text-[20px] font-bold tracking-tight" style={{ color: "var(--w)" }}>{L("Affiliate Terms", "Conditions d'affiliation", "Affiliate-Bedingungen")}</h1>
              <p className="text-[12.5px] mt-1 mb-4" style={{ color: "var(--w3)" }}>{L("Please read and confirm to activate your affiliate dashboard.", "Veuillez lire et confirmer pour activer votre tableau de bord.", "Bitte lesen und bestätigen Sie, um Ihr Dashboard zu aktivieren.")}</p>
              <div className="rounded-2xl p-4 mb-4 space-y-3" style={{ background: "var(--card)", border: "1px solid var(--border)", maxHeight: "48vh", overflowY: "auto" }}>
                {terms.map((s, i) => (
                  <div key={i}>
                    <p className="text-[12.5px] font-bold" style={{ color: "var(--w)" }}>{s.t}</p>
                    <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: "var(--w2)" }}>{s.b}</p>
                  </div>
                ))}
              </div>
              <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 w-4 h-4" style={{ accentColor: "var(--gold)" }} />
                <span className="text-[12.5px]" style={{ color: "var(--w)" }}>{L("I have read and accept the Borivon Affiliate Terms.", "J'ai lu et j'accepte les conditions d'affiliation Borivon.", "Ich habe die Borivon Affiliate-Bedingungen gelesen und akzeptiere sie.")}</span>
              </label>
              <button disabled={!agreed || accepting} onClick={acceptTerms}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-semibold disabled:opacity-40"
                style={{ background: "var(--gold)", color: "#1a1205", border: "none", cursor: agreed && !accepting ? "pointer" : "not-allowed" }}>
                {accepting ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {L("Confirm & continue", "Confirmer et continuer", "Bestätigen & fortfahren")}
              </button>
            </div>
          );
        })()}

        {state === "ok" && stats && stats.termsAccepted && (
          <>
            <div className="mb-6">
              <h1 className="text-[20px] font-bold tracking-tight" style={{ color: "var(--w)" }}>{L("Hi", "Bonjour", "Hallo")} {stats.name} 👋</h1>
              <p className="text-[12.5px] mt-1" style={{ color: "var(--w3)" }}>
                {L("You earn", "Vous gagnez", "Sie erhalten")} <b style={{ color: "var(--gold)" }}>{money(stats.commissionEur)}</b> {L("for every nurse you refer who is placed in Germany.", "pour chaque infirmière que vous parrainez et qui est placée en Allemagne.", "für jede von Ihnen empfohlene Pflegekraft, die in Deutschland vermittelt wird.")}
              </p>
              {!stats.active && (
                <p className="text-[11.5px] mt-2 inline-block px-2 py-1 rounded" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>{L("Your affiliate account is currently paused.", "Votre compte affilié est en pause.", "Ihr Affiliate-Konto ist derzeit pausiert.")}</p>
              )}
            </div>

            {/* Share link */}
            <div className="rounded-2xl p-4 mb-6" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--w3)" }}>{L("Your referral link", "Votre lien de parrainage", "Ihr Empfehlungslink")}</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                  <Link2 size={14} style={{ color: "var(--gold)", flexShrink: 0 }} />
                  <span className="text-[12.5px] truncate" style={{ color: "var(--w)" }}>{stats.shareUrl}</span>
                </div>
                <button onClick={() => copy(stats.shareUrl)}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[12.5px] font-semibold flex-shrink-0"
                  style={{ background: "var(--gold)", color: "#1a1205", border: "none", cursor: "pointer" }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? L("Copied", "Copié", "Kopiert") : L("Copy", "Copier", "Kopieren")}
                </button>
              </div>
              {/* One-tap share — opens WhatsApp with a ready invite + the link, no
                  recipient set, so the affiliate just picks who to send it to. */}
              <a
                href={waMeUrl("", L(
                  `Want to work as a nurse in Germany? Borivon handles the whole process — visa, recognition, the lot. Start here: ${stats.shareUrl}`,
                  `Envie de travailler comme infirmier·ère en Allemagne ? Borivon s'occupe de tout — visa, reconnaissance, etc. Commencez ici : ${stats.shareUrl}`,
                  `Möchten Sie als Pflegekraft in Deutschland arbeiten? Borivon übernimmt alles — Visum, Anerkennung, den kompletten Weg. Starten Sie hier: ${stats.shareUrl}`,
                ))}
                target="_blank" rel="noopener noreferrer"
                className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12.5px] font-semibold no-underline"
                style={{ background: "#25d366", color: "#0b3d1f", border: "none" }}>
                <MessageCircle size={15} /> {L("Share on WhatsApp", "Partager sur WhatsApp", "Auf WhatsApp teilen")}
              </a>
              <p className="text-[11px] mt-2" style={{ color: "var(--w3)" }}>{L("Share it. When a nurse joins through your link and reaches Germany, you get paid.", "Partagez-le. Quand une infirmière s'inscrit via votre lien et arrive en Allemagne, vous êtes payé.", "Teilen Sie ihn. Wenn eine Pflegekraft über Ihren Link beitritt und Deutschland erreicht, werden Sie bezahlt.")}</p>
            </div>

            {/* Stat tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { icon: <Link2 size={16} />, label: L("Clicks", "Clics", "Klicks"), value: String(stats.clicks) },
                { icon: <Users size={16} />, label: L("Referred", "Parrainés", "Empfohlen"), value: String(stats.referred) },
                { icon: <Plane size={16} />, label: L("Placed", "Placés", "Vermittelt"), value: String(stats.placed) },
                { icon: <Wallet size={16} />, label: L("Earned", "Gagné", "Verdient"), value: money(stats.owedEur + stats.paidEur) },
              ].map((t, i) => (
                <div key={i} className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--gold)" }}>{t.icon}</span>
                  <p className="text-[22px] font-bold mt-2 leading-none" style={{ color: "var(--w)" }}>{t.value}</p>
                  <p className="text-[11px] mt-1.5" style={{ color: "var(--w3)" }}>{t.label}</p>
                </div>
              ))}
            </div>

            {/* Payout summary */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--warning)" }}>{L("To be paid", "À payer", "Ausstehend")}</p>
                <p className="text-[24px] font-bold mt-1" style={{ color: "var(--w)" }}>{money(stats.owedEur)}</p>
              </div>
              <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--success)" }}>{L("Paid", "Payé", "Bezahlt")}</p>
                <p className="text-[24px] font-bold mt-1" style={{ color: "var(--w)" }}>{money(stats.paidEur)}</p>
              </div>
            </div>

            {/* Placement list (no nurse PII — date + status only) */}
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide px-4 py-3" style={{ color: "var(--w3)", background: "var(--bg2)" }}>{L("Your placements", "Vos placements", "Ihre Vermittlungen")}</p>
              {stats.earnings.length === 0 ? (
                <p className="text-[12.5px] px-4 py-6 text-center" style={{ color: "var(--w3)" }}>{L("No placements yet — keep sharing your link.", "Aucun placement pour l'instant — continuez à partager votre lien.", "Noch keine Vermittlungen — teilen Sie Ihren Link weiter.")}</p>
              ) : (
                stats.earnings.map((e, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3" style={{ borderTop: i ? "1px solid var(--border)" : "none" }}>
                    <span className="text-[12.5px]" style={{ color: "var(--w2)" }}>
                      {new Date(e.placed_at).toLocaleDateString(lang === "fr" ? "fr-FR" : lang === "de" ? "de-DE" : "en-GB", { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-[12.5px] font-semibold" style={{ color: "var(--w)" }}>{money(e.amount_eur)}</span>
                      <span className="text-[10.5px] font-semibold px-2 py-1 rounded-full" style={{
                        background: e.status === "paid" ? "var(--success-bg, rgba(22,163,74,0.14))" : "var(--warning-bg, rgba(245,158,11,0.14))",
                        color: e.status === "paid" ? "var(--success)" : "var(--warning)",
                      }}>
                        {e.status === "paid" ? L("Paid", "Payé", "Bezahlt") : L("Pending", "En attente", "Ausstehend")}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </div>

            <p className="text-[11px] text-center mt-8" style={{ color: "var(--w3)" }}>
              {L("Payouts are handled directly by Borivon.", "Les paiements sont gérés directement par Borivon.", "Auszahlungen werden direkt von Borivon abgewickelt.")}{" · "}
              <a href="mailto:contact@borivon.com" className="no-underline" style={{ color: "var(--gold)" }}>{L("Contact", "Contact", "Kontakt")}</a>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

"use client";

/**
 * Affiliate self-serve dashboard — served at affiliates.borivon.com/<token>
 * (and www.borivon.com/affiliate/<token>). No login: the private token in the
 * URL IS the key. Read-only, no candidate PII — just the affiliate's own
 * numbers. Simple yet clear.
 * The one design (founder 2026-11-13, components/fx/kit): serif greeting, the link as one hairline card,
 * the numbers in serif, the placements as hairline rows with a status dot that flip instead of scrolling.
 */
import { Wordmark } from "@/components/Wordmark";
import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { Copy, Check, Loader2, MessageCircle } from "lucide-react";
import { waMeUrl } from "@/lib/waLink";
import { KitStyle, PageHead, Btn, Card, Seg, Dot, Field, Empty, Pager, usePaged, type Status } from "@/components/fx/kit";

type Earning = { placed_at: string; status: string; amount_eur: number };
type Stats = {
  name: string; active: boolean; currency: string; commissionEur: number;
  shareUrl: string; clicks: number; referred: number; placed: number;
  owedEur: number; paidEur: number; earnings: Earning[];
  termsAccepted: boolean; termsVersion: string;
};

// this page's few layout rules (phone: the link row stacks, the accept row stacks, the terms go one column)
const AF_CSS = ".bvaf-share{display:flex;align-items:flex-end;gap:8px}.bvaf-share>.bvk-field{flex:1;min-width:0}"
  + ".bvaf-acts{display:flex;gap:8px}.bvaf-acts>.bvk-btn{height:42px}"
  + ".bvaf-nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}"
  + ".bvaf-terms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 28px}"
  + ".bvaf-accept{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px}"
  + "@media (max-width:640px){.bvaf-share{flex-direction:column;align-items:stretch}.bvaf-acts>.bvk-btn{flex:1}"
  + ".bvaf-terms{grid-template-columns:minmax(0,1fr)}.bvaf-accept{flex-direction:column;align-items:stretch;gap:14px}}";

export default function AffiliateDashboard() {
  const params = useParams();
  const token = String((params?.token as string) ?? "");
  const [lang, setLang] = useState<"en" | "fr" | "de">("fr");
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [copied, setCopied] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [accepting, setAccepting] = useState(false);
  // nobody scrolls: the placements flip (laptop 4, phone 3 per page)
  const placements = usePaged(stats?.earnings ?? [], 4, 3);

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

  const serifNum: CSSProperties = { fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: "clamp(24px, 6.4vw, 30px)", lineHeight: 1.1, color: "var(--w)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--w)" }}>
      <KitStyle />
      <style>{AF_CSS}</style>
      {/* Minimal header (portal chrome is suppressed on /affiliate) */}
      <header className="flex items-center justify-between px-5 sm:px-8 h-[58px] border-b" style={{ borderColor: "var(--border)", background: "var(--nav-bg)", gap: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Wordmark size="1.3rem" />
          <span style={{ paddingLeft: 10, borderLeft: "1px solid var(--border)", fontSize: 13, lineHeight: "16px", color: "var(--w3)", whiteSpace: "nowrap" }}>{L("Affiliate", "Affilié", "Affiliate")}</span>
        </span>
        <Seg value={lang} onChange={setLang} options={[["fr", "FR"], ["en", "EN"], ["de", "DE"]]} />
      </header>

      <main className="mx-auto w-full max-w-[680px] px-5 sm:px-6" style={{ paddingTop: "clamp(20px, 2.2vw, 28px)", paddingBottom: 16 }}>
        {state === "loading" && (
          <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin" style={{ color: "var(--w3)" }} /></div>
        )}

        {state === "notfound" && (
          <div style={{ textAlign: "center", padding: "96px 0" }}>
            <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 30, lineHeight: 1.15, color: "var(--w)" }}>{L("This link isn't valid.", "Ce lien n'est pas valide.", "Dieser Link ist ungültig.")}</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--w3)" }}>{L("Ask Borivon for your personal affiliate link.", "Demandez à Borivon votre lien d'affilié personnel.", "Bitte fordern Sie Ihren persönlichen Affiliate-Link bei Borivon an.")}</p>
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
              <PageHead title={L("Affiliate Terms", "Conditions d'affiliation", "Affiliate-Bedingungen")}
                sub={L("Please read and confirm to activate your affiliate dashboard.", "Veuillez lire et confirmer pour activer votre tableau de bord.", "Bitte lesen und bestätigen Sie, um Ihr Dashboard zu aktivieren.")} />
              <TermsCard terms={terms} />
              {/* the box starts unticked and only a human click ticks it */}
              <div className="bvaf-accept">
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0, cursor: "pointer" }}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 18, height: 18, margin: "1px 0 0", flex: "none", accentColor: "var(--w)", cursor: "pointer" }} />
                  <span style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--w)" }}>{L("I have read and accept the Borivon Affiliate Terms.", "J'ai lu et j'accepte les conditions d'affiliation Borivon.", "Ich habe die Borivon Affiliate-Bedingungen gelesen und akzeptiere sie.")}</span>
                </label>
                <Btn kind="primary" disabled={!agreed || accepting} onClick={acceptTerms} style={{ flex: "none" }}>
                  {accepting ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {L("Confirm & continue", "Confirmer et continuer", "Bestätigen & fortfahren")}
                </Btn>
              </div>
            </div>
          );
        })()}

        {state === "ok" && stats && stats.termsAccepted && (
          <>
            <PageHead title={<>{L("Hi", "Bonjour", "Hallo")} {stats.name}</>}
              sub={<>
                {L("You earn", "Vous gagnez", "Sie erhalten")} <b style={{ fontWeight: 600, color: "var(--w)" }}>{money(stats.commissionEur)}</b> {L("for every nurse you refer who is placed in Germany.", "pour chaque infirmière que vous parrainez et qui est placée en Allemagne.", "für jede von Ihnen empfohlene Pflegekraft, die in Deutschland vermittelt wird.")}
                {!stats.active && (
                  <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12.5, fontWeight: 600, color: "var(--w)" }}>
                    <Dot st="rejected" size={8} />{L("Your affiliate account is currently paused.", "Votre compte affilié est en pause.", "Ihr Affiliate-Konto ist derzeit pausiert.")}
                  </span>
                )}
              </>} />

            {/* Share link — one hairline card: the link, copy, WhatsApp */}
            <Card style={{ padding: "16px 18px", marginBottom: 14 }}>
              <div className="bvaf-share">
                <Field label={L("Your referral link", "Votre lien de parrainage", "Ihr Empfehlungslink")}>
                  <input className="bvk-input" readOnly value={stats.shareUrl} style={{ textOverflow: "ellipsis" }} />
                </Field>
                <div className="bvaf-acts">
                  <Btn kind="primary" onClick={() => copy(stats.shareUrl)}>
                    {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? L("Copied", "Copié", "Kopiert") : L("Copy", "Copier", "Kopieren")}
                  </Btn>
                  {/* One-tap share — opens WhatsApp with a ready invite + the link, no
                      recipient set, so the affiliate just picks who to send it to. */}
                  <a
                    href={waMeUrl("", L(
                      `Want to work as a nurse in Germany? Borivon handles the whole process — visa, recognition, the lot. Start here: ${stats.shareUrl}`,
                      `Envie de travailler comme infirmier·ère en Allemagne ? Borivon s'occupe de tout — visa, reconnaissance, etc. Commencez ici : ${stats.shareUrl}`,
                      `Möchten Sie als Pflegekraft in Deutschland arbeiten? Borivon übernimmt alles — Visum, Anerkennung, den kompletten Weg. Starten Sie hier: ${stats.shareUrl}`,
                    ))}
                    target="_blank" rel="noopener noreferrer"
                    className="bvk-btn bvk-ghost"
                    aria-label={L("Share on WhatsApp", "Partager sur WhatsApp", "Auf WhatsApp teilen")} title={L("Share on WhatsApp", "Partager sur WhatsApp", "Auf WhatsApp teilen")}>
                    <MessageCircle size={15} style={{ color: "#25d366" }} /> WhatsApp
                  </a>
                </div>
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.45, color: "var(--w3)" }}>{L("Share it: when a nurse joins through it and reaches Germany, you get paid.", "Partagez-le : quand une infirmière inscrite via ce lien arrive en Allemagne, vous êtes payé.", "Teilen Sie ihn: Kommt eine Pflegekraft über Ihren Link nach Deutschland, werden Sie bezahlt.")}</p>
            </Card>

            {/* The numbers, quiet on the paper — activity on top, money below (earned = to be paid + paid) */}
            <div style={{ padding: "4px 2px 0", marginBottom: 20 }}>
              {([
                [
                  [L("Clicks", "Clics", "Klicks"), String(stats.clicks)],
                  [L("Referred", "Parrainés", "Empfohlen"), String(stats.referred)],
                  [L("Placed", "Placés", "Vermittelt"), String(stats.placed)],
                ],
                [
                  [L("Earned", "Gagné", "Verdient"), money(stats.owedEur + stats.paidEur)],
                  [L("To be paid", "À payer", "Ausstehend"), money(stats.owedEur), "pending"],
                  [L("Paid", "Payé", "Bezahlt"), money(stats.paidEur), "approved"],
                ],
              ] as [string, string, Status?][][]).map((row, r) => (
                <div key={r} className="bvaf-nums" style={r ? { marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" } : undefined}>
                  {row.map(([label, value, st], i) => (
                    <div key={i} style={{ minWidth: 0 }}>
                      <div style={serifNum}>{value}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 12.5, color: "var(--w3)", whiteSpace: "nowrap" }}>{st && <Dot st={st} size={7} />}{label}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Placement list (no nurse PII — date + status only) */}
            <h2 style={{ margin: "0 0 6px", fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, lineHeight: 1.2, color: "var(--w)" }}>{L("Your placements", "Vos placements", "Ihre Vermittlungen")}</h2>
            {stats.earnings.length === 0 ? (
              <Card><Empty>{L("No placements yet — keep sharing your link.", "Aucun placement pour l'instant — continuez à partager votre lien.", "Noch keine Vermittlungen — teilen Sie Ihren Link weiter.")}</Empty></Card>
            ) : (
              <>
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  {placements.slice.map((e, i) => (
                    <div key={`${e.placed_at}-${i}`} className="bvk-row" style={{ padding: "10px 4px" }}>
                      <span style={{ flex: 1, minWidth: 0, color: "var(--w2)" }}>
                        {new Date(e.placed_at).toLocaleDateString(lang === "fr" ? "fr-FR" : lang === "de" ? "de-DE" : "en-GB", { year: "numeric", month: "short", day: "numeric" })}
                      </span>
                      <span style={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{money(e.amount_eur)}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 92, fontSize: 12, fontWeight: 600, color: "var(--w)" }}>
                        <Dot st={e.status === "paid" ? "approved" : "pending"} size={8} />
                        {e.status === "paid" ? L("Paid", "Payé", "Bezahlt") : L("Pending", "En attente", "Ausstehend")}
                      </span>
                    </div>
                  ))}
                </div>
                <Pager page={placements.page} pages={placements.pages} onPage={placements.setPage} />
              </>
            )}

            <p style={{ margin: "14px 0 0", textAlign: "center", fontSize: 12, color: "var(--w3)" }}>
              {L("Payouts are handled directly by Borivon.", "Les paiements sont gérés directement par Borivon.", "Auszahlungen werden direkt von Borivon abgewickelt.")}{" · "}
              <a href="mailto:contact@borivon.com" style={{ color: "var(--w2)", textDecoration: "underline", textUnderlineOffset: 3 }}>{L("Contact", "Contact", "Kontakt")}</a>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

/** the six terms in one hairline card: laptop shows all in two columns, the phone flips two at a time (nobody scrolls) */
function TermsCard({ terms }: { terms: { t: string; b: string }[] }) {
  const { slice, page, pages, setPage } = usePaged(terms, 6, 2);
  return (
    <Card style={{ padding: "18px 20px" }}>
      <div className="bvaf-terms">
        {slice.map((s) => (
          <div key={s.t} style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--w)" }}>{s.t}</p>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--w2)" }}>{s.b}</p>
          </div>
        ))}
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </Card>
  );
}

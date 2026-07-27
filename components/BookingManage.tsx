"use client";

/**
 * /book/manage/<token> — the page behind the "reschedule or cancel" link.
 *
 * No login, no account: the token in the URL is the whole credential. Someone
 * who can move their own call moves it; someone who can't just doesn't show up.
 *
 * Times are rendered in the VISITOR's own timezone, same as the booking page.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "@/components/LangContext";
import { CalendarDays, Loader2, Check, X, ArrowLeft, Video } from "lucide-react";

const tr = (l: string, en: string, de: string, fr: string) => (l === "de" ? de : l === "fr" ? fr : en);

type Booking = {
  kind: "nurse" | "clinic" | "company";
  name: string; company: string | null;
  startsAt: number; status: string; meetLink: string | null; past: boolean;
};

function localDays(instants: number[], lang: string) {
  const loc = lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB";
  const byDay = new Map<string, number[]>();
  for (const at of instants) {
    const d = new Date(at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(at);
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, list]) => {
    const first = new Date(list[0]);
    return {
      key,
      weekday: first.toLocaleDateString(loc, { weekday: "short" }),
      date: first.toLocaleDateString(loc, { day: "numeric", month: "short" }),
      slots: list.sort((a, b) => a - b).map((at) => ({
        at, label: new Date(at).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }),
      })),
    };
  });
}

export function BookingManage({ token }: { token: string }) {
  const { lang } = useLang();
  const T = useCallback((en: string, de: string, fr: string) => tr(lang, en, de, fr), [lang]);
  const loc = lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB";

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [instants, setInstants] = useState<number[]>([]);
  const [picking, setPicking] = useState(false);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"cancelled" | "moved" | null>(null);
  // Cancelling is FINAL — it drops the Google event for both sides, emails them,
  // and deletes the founder's follow-up chase. There is no undo anywhere, and
  // the button sits a thumb-width from "Move to another time". So: two taps.
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/book/manage?t=${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!r.ok) { setNotFound(true); return; }
      const j = await r.json();
      setBooking(j.booking as Booking);
      type RawDay = { slots?: { at?: unknown }[] };
      setInstants((Array.isArray(j?.days) ? (j.days as RawDay[]) : [])
        .flatMap((d) => (d.slots ?? []).map((s) => Number(s?.at)))
        .filter((n) => Number.isFinite(n)));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const days = useMemo(() => localDays(instants, lang), [instants, lang]);
  const selected = useMemo(() => days.find((d) => d.key === dayKey) ?? days[0] ?? null, [days, dayKey]);

  async function act(action: "cancel" | "reschedule") {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/book/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, ...(action === "reschedule" ? { at } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j?.error === "slot_unavailable"
          ? T("That time was just taken — please pick another.",
              "Der Termin wurde gerade vergeben — bitte wählen Sie einen anderen.",
              "Ce créneau vient d'être pris — merci d'en choisir un autre.")
          : j?.error === "already_past"
            ? T("That appointment has already taken place.",
                "Dieser Termin hat bereits stattgefunden.",
                "Ce rendez-vous a déjà eu lieu.")
            : T("Something went wrong. Please try again.",
                "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
                "Une erreur est survenue. Merci de réessayer."));
        if (j?.error === "slot_unavailable") { setAt(null); await load(); }
        return;
      }
      setOutcome(action === "cancel" ? "cancelled" : "moved");
    } catch {
      setErr(T("Network error. Please try again.", "Netzwerkfehler. Bitte erneut versuchen.", "Erreur réseau. Merci de réessayer."));
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto px-5 py-20 bv-page-bottom bv-enter" style={{ maxWidth: 560 }}>{children}</main>
  );

  if (loading) {
    return shell(<div className="bv-skeleton" style={{ height: 220, borderRadius: 20 }} aria-busy="true" />);
  }

  // Deliberately the same message whether the token is wrong, expired or never
  // existed — it must never confirm that some other booking is out there.
  if (notFound || !booking) {
    return shell(
      <div className="bv-card p-8 text-center" style={{ borderRadius: 20 }}>
        <CalendarDays size={22} style={{ color: "var(--w3)" }} className="mx-auto mb-3" />
        <h1 className="text-[1.2rem] font-medium mb-2" style={{ color: "var(--w)" }}>
          {T("Link not valid", "Link ungültig", "Lien non valide")}
        </h1>
        <p className="text-[14px] mb-5" style={{ color: "var(--w3)" }}>
          {T("This link doesn't open an appointment. It may have already been used.",
             "Dieser Link öffnet keinen Termin. Möglicherweise wurde er bereits verwendet.",
             "Ce lien n'ouvre aucun rendez-vous. Il a peut-être déjà été utilisé.")}
        </p>
        <a href="/book" className="bv-btn bv-btn-primary bv-tap inline-flex">
          {T("Book a time", "Termin buchen", "Réserver un créneau")}
        </a>
      </div>,
    );
  }

  if (outcome) {
    return shell(
      <div className="bv-card p-8 text-center" style={{ borderRadius: 20 }} role="status" aria-live="polite">
        <div
          className="mx-auto mb-5 grid place-items-center"
          style={{ width: 56, height: 56, borderRadius: 999, background: "rgba(22,163,74,.14)", border: "1px solid rgba(22,163,74,.4)" }}
        >
          <Check size={26} style={{ color: "#16a34a" }} />
        </div>
        <h1 className="text-[1.3rem] font-medium mb-2" style={{ color: "var(--w)" }}>
          {outcome === "cancelled"
            ? T("Cancelled", "Abgesagt", "Annulé")
            : T("New time confirmed", "Neuer Termin bestätigt", "Nouvel horaire confirmé")}
        </h1>
        <p className="text-[14px] mb-6" style={{ color: "var(--w3)" }}>
          {outcome === "cancelled"
            ? T("Thanks for letting us know. You're welcome back any time.",
                "Danke für die Nachricht. Sie sind jederzeit willkommen.",
                "Merci de nous avoir prévenus. Vous êtes le bienvenu à tout moment.")
            : T("Your calendar invitation has been updated.",
                "Ihre Kalendereinladung wurde aktualisiert.",
                "Votre invitation a été mise à jour.")}
        </p>
        <a href="/book" className="bv-link text-[14px]">
          {T("Book another time", "Neuen Termin buchen", "Réserver un autre créneau")} →
        </a>
      </div>,
    );
  }

  const when = new Date(booking.startsAt).toLocaleString(loc, {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
  const locked = booking.past || booking.status === "cancelled";

  return shell(
    <>
      <p className="bv-eyebrow mb-2">{T("Your appointment", "Ihr Termin", "Votre rendez-vous")}</p>
      <div className="bv-card p-7 mb-5" style={{ borderRadius: 20 }}>
        <p className="text-[17px] font-medium mb-1" style={{ color: "var(--w)" }}>{when}</p>
        <p className="text-[13px]" style={{ color: "var(--w3)" }}>
          {booking.company || booking.name}
          {" · "}
          {T("shown in your local time", "in Ihrer Ortszeit", "dans votre heure locale")}
        </p>
        {booking.meetLink && !locked && (
          <a href={booking.meetLink} target="_blank" rel="noopener noreferrer"
            className="bv-link text-[13.5px] mt-3 inline-flex items-center gap-2">
            <Video size={14} aria-hidden /> {T("Join the video call", "Zum Videoanruf", "Rejoindre la visio")}
          </a>
        )}
        {booking.status === "cancelled" && (
          <p className="text-[13px] mt-3" style={{ color: "#ef4444" }}>
            {T("This appointment was cancelled.", "Dieser Termin wurde abgesagt.", "Ce rendez-vous a été annulé.")}
          </p>
        )}
        {booking.past && booking.status !== "cancelled" && (
          <p className="text-[13px] mt-3" style={{ color: "var(--w3)" }}>
            {T("This appointment has already taken place.", "Dieser Termin hat bereits stattgefunden.", "Ce rendez-vous a déjà eu lieu.")}
          </p>
        )}
      </div>

      {!locked && !picking && !confirming && (
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => setPicking(true)} className="bv-btn bv-btn-primary bv-tap bv-touch">
            {T("Move to another time", "Termin verschieben", "Déplacer le rendez-vous")}
          </button>
          <button onClick={() => setConfirming(true)}
            className="bv-btn bv-btn-ghost bv-tap bv-touch inline-flex items-center gap-2" style={{ color: "var(--w3)" }}>
            <X size={14} aria-hidden />
            {T("Cancel it", "Absagen", "Annuler")}
          </button>
        </div>
      )}

      {/* Safe choice on the LEFT, destructive on the RIGHT — the same order as
          Back / "Confirm new time" below, and the question above pushes the row
          down a line so a double-tap can't land on the confirm button. */}
      {!locked && !picking && confirming && (
        <div className="bv-enter-soft">
          <p className="text-[15px] mb-4" style={{ color: "var(--w)" }}>
            {T("Cancel this appointment?", "Diesen Termin absagen?", "Annuler ce rendez-vous ?")}
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setConfirming(false)} disabled={busy}
              className="bv-btn bv-btn-ghost bv-tap bv-touch">
              {T("Keep it", "Behalten", "Le garder")}
            </button>
            <button onClick={() => act("cancel")} disabled={busy}
              className="bv-btn bv-btn-danger bv-tap bv-touch inline-flex items-center gap-2">
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <X size={14} aria-hidden />}
              {T("Yes, cancel", "Ja, absagen", "Oui, annuler")}
            </button>
          </div>
        </div>
      )}

      {!locked && picking && (
        <div className="bv-enter-soft">
          {!days.length ? (
            <p className="bv-body">
              {T("No other times are open right now.", "Aktuell sind keine anderen Termine frei.", "Aucun autre créneau disponible.")}
            </p>
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto pb-3 bv-scroll" role="group" aria-label={T("Day", "Tag", "Jour")}>
                {days.map(({ key, weekday, date }) => {
                  const on = key === selected?.key;
                  return (
                    <button key={key} type="button" aria-label={`${weekday} ${date}`} aria-pressed={on}
                      onClick={() => { setDayKey(key); setAt(null); }}
                      className="bv-tap bv-touch flex-shrink-0 px-4 py-2.5 text-center"
                      style={{
                        borderRadius: 12, minWidth: 76,
                        border: `1px solid ${on ? "var(--border-gold)" : "var(--border)"}`,
                        background: on ? "rgba(212,175,55,.08)" : "var(--card)",
                      }}>
                      <span className="block text-[11px] uppercase" style={{ color: on ? "var(--gold)" : "var(--w3)", letterSpacing: ".06em" }}>{weekday}</span>
                      <span className="block text-[14px] mt-0.5" style={{ color: "var(--w)" }}>{date}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}>
                {(selected?.slots ?? []).map((s) => {
                  const on = at === s.at;
                  return (
                    <button key={s.at} type="button" aria-pressed={on}
                      onClick={() => { setAt(s.at); setErr(null); }}
                      className="bv-tap bv-touch py-2.5 text-[14px]"
                      style={{
                        borderRadius: 10,
                        border: `1px solid ${on ? "var(--border-gold)" : "var(--border)"}`,
                        background: on ? "var(--gold)" : "var(--card)",
                        color: on ? "var(--bg)" : "var(--w)",
                        fontWeight: on ? 600 : 400,
                      }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {err && <p className="text-[13px] mt-4" style={{ color: "#ef4444" }} role="alert">{err}</p>}

          <div className="flex items-center gap-3 mt-7">
            <button onClick={() => { setPicking(false); setAt(null); setErr(null); }} disabled={busy}
              className="bv-btn bv-btn-ghost bv-tap inline-flex items-center gap-2">
              <ArrowLeft size={15} aria-hidden /> {T("Back", "Zurück", "Retour")}
            </button>
            <button onClick={() => act("reschedule")} disabled={busy || at == null}
              className="bv-btn bv-btn-primary bv-tap inline-flex items-center gap-2"
              style={{ opacity: at == null ? 0.45 : 1 }}>
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
              {T("Confirm new time", "Neuen Termin bestätigen", "Confirmer le nouvel horaire")}
            </button>
          </div>
        </div>
      )}

      {err && !picking && <p className="text-[13px] mt-4" style={{ color: "#ef4444" }} role="alert">{err}</p>}
    </>,
  );
}

"use client";

/**
 * Book an appointment BY HAND — shared by the Bookings page and the Kalender.
 *
 * Most people never touch /book: they agree a time on WhatsApp or during a
 * call. Those still have to land in the system, because the follow-up chain is
 * the whole point and it cannot start from a conversation nobody recorded.
 * A booking made here gets the same Google Calendar event, Meet link, invite
 * and three-step chase as one made on the public page.
 *
 * Lives in its own file so the calendar can open it on a clicked day instead of
 * sending the founder to another page to do the thing he was already looking at.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Loader2, Check } from "lucide-react";

type Kind = "nurse" | "clinic" | "company";

const KIND_LABEL: Record<Kind, { en: string; de: string; fr: string }> = {
  nurse:   { en: "Nurse",   de: "Pflegekraft",  fr: "Infirmier·ère" },
  clinic:  { en: "Clinic",  de: "Einrichtung",  fr: "Établissement" },
  company: { en: "Company", de: "Unternehmen",  fr: "Entreprise" },
};

export function AddBookingModal({
  token, T, onClose, onSaved, presetWhen,
}: {
  token: string;
  T: (en: string, de: string, fr: string) => string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  /** "YYYY-MM-DDTHH:mm" to open on — the calendar passes the day you clicked. */
  presetWhen?: string;
}) {
  const [kind, setKind] = useState<Kind>("nurse");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(presetWhen ?? "");     // datetime-local, in the admin's own clock
  const [minutes, setMinutes] = useState(30);
  const [invite, setInvite] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const at = Date.parse(when);
    if (name.trim().length < 2) { setErr(T("Enter a name.", "Namen eingeben.", "Indiquez un nom.")); return; }
    if (!Number.isFinite(at))   { setErr(T("Pick a date and time.", "Datum und Uhrzeit wählen.", "Choisissez une date et une heure.")); return; }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/portal/admin/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, at, name: name.trim(), email: email.trim(), phone: phone.trim(), company: company.trim(), note: note.trim(), minutes, invite }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j?.error === "slot_taken"
          ? T("There's already a booking at that time.", "Zu dieser Zeit gibt es bereits einen Termin.", "Un rendez-vous existe déjà à cette heure.")
          : T("Couldn't save. Please try again.", "Konnte nicht gespeichert werden. Bitte erneut versuchen.", "Échec de l'enregistrement. Réessayez."));
        return;
      }
      await onSaved();
    } catch {
      setErr(T("Network error.", "Netzwerkfehler.", "Erreur réseau."));
    } finally {
      setSaving(false);
    }
  }

  const isOrg = kind === "clinic" || kind === "company";

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      size="md"
      title={T("Add a booking", "Termin eintragen", "Ajouter un rendez-vous")}
      footer={
        <>
          <button onClick={onClose} disabled={saving} className="bv-btn bv-btn-ghost bv-tap">
            {T("Cancel", "Abbrechen", "Annuler")}
          </button>
          <button onClick={save} disabled={saving} className="bv-btn bv-btn-primary bv-tap inline-flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            {T("Save", "Speichern", "Enregistrer")}
          </button>
        </>
      }
    >
      {/* px-5 py-4 like every other Modal caller — Modal doesn't pad its own
          children, so without this the form sits flush against the edges. */}
      <div className="grid gap-4 px-5 py-4">
        <p className="text-[13px]" style={{ color: "var(--w3)" }}>
          {T("For calls agreed on WhatsApp or by phone. They get the same follow-up reminders as a self-booked call.",
             "Für Termine, die per WhatsApp oder Telefon vereinbart wurden. Sie erhalten dieselben Follow-up-Erinnerungen wie selbst gebuchte.",
             "Pour les appels convenus par WhatsApp ou téléphone. Ils reçoivent les mêmes relances qu'une réservation en ligne.")}
        </p>

        <div className="flex gap-2 flex-wrap">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button
              key={k} type="button" onClick={() => setKind(k)}
              className="bv-tap px-3 py-2 text-[13px]"
              style={{
                borderRadius: 10,
                border: `1px solid ${kind === k ? "var(--border-gold)" : "var(--border)"}`,
                background: kind === k ? "rgba(212,175,55,.08)" : "var(--card)",
                color: kind === k ? "var(--gold)" : "var(--w2)",
              }}
              aria-pressed={kind === k}
            >
              {T(KIND_LABEL[k].en, KIND_LABEL[k].de, KIND_LABEL[k].fr)}
            </button>
          ))}
        </div>

        <div>
          <label className="bv-label" htmlFor="ab-name">{T("Name", "Name", "Nom")}</label>
          <input id="ab-name" className="bv-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>

        {isOrg && (
          <div>
            <label className="bv-label" htmlFor="ab-org">{T("Organisation", "Organisation", "Organisation")}</label>
            <input id="ab-org" className="bv-input" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={160} />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="bv-label" htmlFor="ab-when">{T("When", "Wann", "Quand")}</label>
            <input id="ab-when" className="bv-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
            <label className="bv-label" htmlFor="ab-min">{T("Length", "Dauer", "Durée")}</label>
            <select id="ab-min" className="bv-input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="bv-label" htmlFor="ab-email">
              {T("Email", "E-Mail", "E-mail")} <span style={{ color: "var(--w3)" }}>({T("optional", "optional", "facultatif")})</span>
            </label>
            <input id="ab-email" className="bv-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
          </div>
          <div>
            <label className="bv-label" htmlFor="ab-phone">
              {T("Phone", "Telefon", "Téléphone")} <span style={{ color: "var(--w3)" }}>({T("optional", "optional", "facultatif")})</span>
            </label>
            <input id="ab-phone" className="bv-input" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </div>
        </div>

        <div>
          <label className="bv-label" htmlFor="ab-note">{T("Note", "Notiz", "Note")}</label>
          <textarea id="ab-note" className="bv-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} style={{ resize: "vertical" }} />
        </div>

        <label className="flex items-center gap-2.5 text-[13.5px] bv-tap" style={{ color: "var(--w2)" }}>
          <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
          {T("Email them a calendar invite", "Kalendereinladung per E-Mail senden", "Envoyer une invitation par e-mail")}
        </label>
        {invite && !email.trim() && (
          <p className="text-[12px] -mt-2" style={{ color: "var(--w3)" }}>
            {T("No email given — the event is added to your calendar only.",
               "Keine E-Mail angegeben — der Termin wird nur in Ihren Kalender eingetragen.",
               "Aucun e-mail — l'événement est ajouté à votre agenda uniquement.")}
          </p>
        )}

        {err && <p className="text-[13px]" style={{ color: "#ef4444" }} role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

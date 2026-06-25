"use client";

/** /v2/contact — "talk to an expert" lead form. POSTs to /api/v2/contact, which
 *  emails the lead to the Borivon inbox (Gmail/Resend). Honeypot + client guard. */
import { useState } from "react";
import { useLang } from "@/components/LangContext";
import { COPY, type Tri } from "../_copy";
import { Up, GlowField, Check } from "../_components";

export default function ContactPage() {
  const { lang } = useLang();
  const T = (t: Tri) => t[lang];
  const C = COPY.contact;

  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", message: "", audience: "business", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const fieldStyle: React.CSSProperties = { background: "var(--bg2)", border: "1px solid var(--border2)", color: "var(--w)", borderRadius: "var(--r-lg, 12px)" };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) { setState("error"); return; }
    setState("sending");
    try {
      const r = await fetch("/api/v2/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, lang }),
      });
      setState(r.ok ? "ok" : "error");
    } catch { setState("error"); }
  }

  return (
    <GlowField className="min-h-[100dvh] px-[6vw] pt-[140px] pb-28 sm:pt-[170px]">
      <div className="mx-auto max-w-[640px]">
        <Up className="text-center">
          <span className="bv-eyebrow">{T(C.eyebrow)}</span>
          <h1 className="mx-auto mt-5 max-w-[16ch] font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(2.2rem, 5.4vw, 3.6rem)", lineHeight: 1.06, letterSpacing: "-0.03em", color: "var(--w)" }}>{T(C.title)}</h1>
          <p className="mx-auto mt-5 max-w-[520px]" style={{ fontFamily: "var(--font-sans)", fontSize: "1.05rem", lineHeight: 1.65, color: "var(--w2)" }}>{T(C.sub)}</p>
        </Up>

        {state === "ok" ? (
          <Up className="mt-12">
            <div className="rounded-[22px] p-10 text-center" style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full" style={{ background: "var(--gold)" }}><Check size={24} color="#131312" /></div>
              <h2 className="mt-5 font-medium" style={{ fontFamily: "var(--font-sans)", fontSize: "1.4rem", color: "var(--w)" }}>{T(C.okTitle)}</h2>
              <p className="mt-2" style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", color: "var(--w2)" }}>{T(C.okBody)}</p>
            </div>
          </Up>
        ) : (
          <Up className="mt-12">
            <form onSubmit={submit} className="rounded-[22px] p-7 sm:p-9" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              {/* audience toggle */}
              <div className="mb-5">
                <label className="mb-2 block text-[12px] font-semibold" style={{ color: "var(--w2)" }}>{T(C.audienceLabel)}</label>
                <div className="flex gap-2">
                  {([["business", C.audBusiness], ["individual", C.audIndividual]] as const).map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setForm((f) => ({ ...f, audience: val }))}
                      className="flex-1 rounded-lg py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-80"
                      style={{ background: form.audience === val ? "var(--gdim)" : "var(--bg2)", color: form.audience === val ? "var(--gold)" : "var(--w3)", border: `1px solid ${form.audience === val ? "var(--border-gold)" : "var(--border)"}` }}>
                      {T(label)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={T(C.fName)} required value={form.name} onChange={set("name")} style={fieldStyle} />
                <Field label={T(C.fCompany)} value={form.company} onChange={set("company")} style={fieldStyle} />
                <Field label={T(C.fEmail)} type="email" required value={form.email} onChange={set("email")} style={fieldStyle} />
                <Field label={T(C.fPhone)} value={form.phone} onChange={set("phone")} style={fieldStyle} />
              </div>
              <div className="mt-4">
                <label className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--w2)" }}>{T(C.fMessage)} <span style={{ color: "var(--gold)" }}>*</span></label>
                <textarea value={form.message} onChange={set("message")} rows={4} placeholder={T(C.fMessagePh)}
                  className="w-full px-3.5 py-2.5 text-[14px] outline-none resize-y" style={{ ...fieldStyle, minHeight: 110 }} />
              </div>

              {/* honeypot — hidden from humans, bots fill it */}
              <input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")}
                aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />

              {state === "error" && (
                <p className="mt-4 text-[13px]" style={{ color: "var(--danger, #ef4444)" }}>
                  {!form.name.trim() || !form.email.trim() || !form.message.trim() ? T(C.errValidation) : T(C.errMsg)}
                </p>
              )}

              <button type="submit" disabled={state === "sending"}
                className="bv-glow-gold bv-press mt-6 w-full rounded-full py-3.5 text-[15px] font-semibold disabled:opacity-60"
                style={{ background: "var(--gold)", color: "#131312", letterSpacing: "-0.01em" }}>
                {state === "sending" ? T(C.sending) : T(C.submit)}
              </button>
            </form>
          </Up>
        )}
      </div>
    </GlowField>
  );
}

function Field({ label, required, type = "text", value, onChange, style }: {
  label: string; required?: boolean; type?: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; style: React.CSSProperties;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--w2)" }}>
        {label} {required && <span style={{ color: "var(--gold)" }}>*</span>}
      </label>
      <input type={type} value={value} onChange={onChange} className="w-full px-3.5 py-2.5 text-[14px] outline-none" style={style} />
    </div>
  );
}

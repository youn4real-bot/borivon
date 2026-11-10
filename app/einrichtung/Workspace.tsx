"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FxShell, useFxLang, Arrow } from "@/components/fx/Shell";
import { Plan, fmtDate } from "@/components/fx/Plan";
import { fxT, fill } from "@/components/fx/i18n";
import { STEPS, dueDate, type Lang, type StepId } from "@/lib/facility/steps";
import type { Facility, Nurse } from "@/lib/facility/db";
import { demoApi } from "@/components/fx/demo";

type Me = { id: string; email: string; role: "owner" | "member"; salutation: string; last_name: string };
type Member = { id: string; email: string; role: "owner" | "member"; last_login_at: string };
type Data = { facility: Facility; me: Me; team: Member[]; nurses: Nurse[]; limits: { nurses: number; users: number } };
type T = ReturnType<typeof fxT>;

/** fetch, or the example's in-memory look-alike (/einrichtung/beispiel) */
const Api = createContext<{ api: typeof fetch; demo: boolean; base: string }>({ api: (...a) => fetch(...a), demo: false, base: "/einrichtung" });
const json = (method: string, body?: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * The facility workspace (founder 2026-11-10: "so minimalist; cut off so much"). Three places only:
 * the nurses (each with her arrival plan), the team, the facility. Nothing else.
 */
export function Workspace({ demo = false }: { demo?: boolean }) {
  const { lang, setLang, ready } = useFxLang();
  const ctx = useMemo(() => ({ api: demo ? demoApi() : (...a: Parameters<typeof fetch>) => fetch(...a), demo, base: demo ? "/einrichtung/beispiel" : "/einrichtung" }), [demo]);
  const api = ctx.api;
  const t = fxT(lang);
  const router = useRouter();
  const sp = useSearchParams();
  const view = sp.get("v") ?? "list";
  const nid = sp.get("n");
  const [d, setD] = useState<Data | null>(null);

  const load = useCallback(async () => {
    const r = await api("/api/einrichtung/me", { cache: "no-store" }).catch(() => null);
    if (!r || r.status === 401) { router.replace("/einrichtung/login"); return; }
    if (r.ok) setD(await r.json());
  }, [router, api]);
  useEffect(() => { load(); }, [load]);

  const go = (q: string) => { router.push(`${ctx.base}${q}`); window.scrollTo({ top: 0 }); };
  const setNurse = (n: Nurse) => setD((x) => (x ? { ...x, nurses: x.nurses.map((y) => (y.id === n.id ? n : y)) } : x));

  async function logout() {
    if (demo) { router.push("/einrichtung/login"); return; }
    await fetch("/api/einrichtung/logout", json("POST")).catch(() => {});
    router.replace("/einrichtung/login");
  }

  const nav = d ? (
    <>
      <button type="button" aria-current={view === "list" ? "page" : undefined} onClick={() => go("")}>{t.nurses}</button>
      <button type="button" aria-current={view === "team" ? "page" : undefined} onClick={() => go("?v=team")}>{t.team}</button>
      <button type="button" aria-current={view === "settings" ? "page" : undefined} onClick={() => go("?v=settings")}>{t.settings}</button>
      <button type="button" onClick={logout}>{t.logout}</button>
    </>
  ) : null;

  const nurse = d && nid ? d.nurses.find((n) => n.id === nid) : null;

  return (
    <Api.Provider value={ctx}>
    <FxShell lang={lang} setLang={setLang} ready={ready && !!d} who={d?.facility.name} nav={nav}>
      {demo && d && <div className="c"><p className="fx-small" style={{ margin: "-18px 0 30px", paddingBottom: 14, borderBottom: "1px solid var(--line)" }}><span className="fx-tag" style={{ marginLeft: 0, marginRight: 10 }}>{t.example}</span>{t.demoBar}</p></div>}
      {d && (nurse ? <NurseView key={nurse.id} t={t} lang={lang} nurse={nurse} onChange={setNurse} onBack={() => go("")} onRemoved={() => { load(); go(""); }} />
        : view === "team" ? <TeamView t={t} lang={lang} d={d} reload={load} />
        : view === "settings" ? <SettingsView t={t} d={d} onSaved={(f) => setD({ ...d, facility: f })} onDeleted={() => router.replace("/")} />
        : <ListView t={t} lang={lang} d={d} onOpen={(id) => go(`?n=${id}`)} onAdded={(n) => { setD({ ...d, nurses: [...d.nurses, n] }); go(`?n=${n.id}`); }} />)}
    </FxShell>
    </Api.Provider>
  );
}

/* ── the list ─────────────────────────────────────────────────────────────────────────────── */
function nextStep(n: Nurse) {
  const s = STEPS.find((x) => !n.steps[x.id]);
  return s ? { s, due: dueDate(n.arrival, s) } : null;
}

function ListView({ t, lang, d, onOpen, onAdded }: { t: T; lang: Lang; d: Data; onOpen: (id: string) => void; onAdded: (n: Nurse) => void }) {
  const [adding, setAdding] = useState(false);
  const real = d.nurses.filter((n) => !n.sample).length;
  return (
    <div className="c">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-end", justifyContent: "space-between", marginBottom: 34 }}>
        <h1 className="fx-h1 fx-rise">{t.nursesH}</h1>
        {!adding && <button className="fx-btn fx-rise d1" onClick={() => setAdding(true)}>{t.add}<Arrow /></button>}
      </div>
      {adding && (
        real >= d.limits.nurses
          ? <p className="fx-ok" style={{ borderLeftColor: "var(--gold)", color: "var(--ink2)", background: "rgba(168,132,58,.08)" }}>{fill(t.limitNurses, { n: d.limits.nurses })}</p>
          : <NurseForm t={t} facility={d.facility} onCancel={() => setAdding(false)} onSaved={(n) => { setAdding(false); onAdded(n); }} />
      )}
      {d.nurses.length === 0 && !adding && <p className="fx-lede">{t.emptyP}</p>}
      <ul className="fx-rows">
        {d.nurses.map((n) => {
          const done = STEPS.filter((s) => n.steps[s.id]).length;
          const nx = nextStep(n);
          return (
            <li key={n.id}>
              <button className="fx-row" onClick={() => onOpen(n.id)}>
                <div>
                  <div className="nm">{n.first_name} {n.last_name}{n.sample && <span className="fx-tag">{t.example}</span>}</div>
                  <div className="meta">
                    {n.arrival ? `${t.arrival} ${fmtDate(n.arrival, lang, true)}` : t.noDate}
                    {(n.plz || n.city) && ` · ${[n.plz, n.city].filter(Boolean).join(" ")}`}
                    {n.country && ` · ${t.from} ${n.country}`}
                  </div>
                  <div className="nx">
                    {nx ? <><b>{t.next}:</b> {nx.s.title[lang]}{nx.due && `, ${fill(t.until, { d: fmtDate(nx.due, lang) })}`}</> : t.allDone}
                  </div>
                </div>
                <div className="fx-prog">
                  <span className="fx-bar"><i style={{ width: `${(done / STEPS.length) * 100}%` }} /></span>
                  {fill(t.stepsOf, { a: done, b: STEPS.length })}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── add / edit a nurse ───────────────────────────────────────────────────────────────────── */
function NurseForm({ t, facility, nurse, onCancel, onSaved }: { t: T; facility: Facility; nurse?: Nurse; onCancel: () => void; onSaved: (n: Nurse) => void }) {
  const [f, setF] = useState({
    first_name: nurse?.first_name ?? "", last_name: nurse?.last_name ?? "", country: nurse?.country ?? "",
    arrival: nurse?.arrival ?? "", start: nurse?.start ?? "", plz: nurse?.plz ?? facility.plz, city: nurse?.city ?? facility.city,
  });
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const { api } = useContext(Api);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "plz" ? e.target.value.replace(/\D/g, "").slice(0, 5) : e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!f.first_name.trim()) return setErr(t.errFirst);
    if (f.plz && !/^\d{5}$/.test(f.plz)) return setErr(t.errPlz);
    setBusy(true); setErr("");
    const r = await api(nurse ? `/api/einrichtung/nurses/${nurse.id}` : "/api/einrichtung/nurses", json(nurse ? "PATCH" : "POST", f)).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok && j.nurse) onSaved(j.nurse);
    else setErr(j.error === "limit" ? fill(t.limitNurses, { n: j.limit }) : t.errGeneric);
  }

  return (
    <form className="fx-card fx-rise" onSubmit={save} noValidate style={{ marginBottom: 34 }}>
      <div className="fx-grid2">
        <label className="fx-field"><span>{t.firstName}</span><input className="fx-input" value={f.first_name} onChange={set("first_name")} maxLength={60} autoFocus /></label>
        <label className="fx-field"><span>{t.lastName}</span><input className="fx-input" value={f.last_name} onChange={set("last_name")} maxLength={60} /></label>
        <label className="fx-field"><span>{t.country}</span><input className="fx-input" value={f.country} onChange={set("country")} maxLength={60} /></label>
        <span />
        <label className="fx-field"><span>{t.arrivalDate}</span><input className="fx-input" type="date" value={f.arrival} onChange={set("arrival")} /></label>
        <label className="fx-field"><span>{t.startDate}</span><input className="fx-input" type="date" value={f.start} onChange={set("start")} /></label>
      </div>
      <p className="fx-small" style={{ margin: "4px 0 10px" }}>{t.homeHint}</p>
      <div className="fx-grid3">
        <label className="fx-field"><span>{t.plz}</span><input className="fx-input" value={f.plz} onChange={set("plz")} inputMode="numeric" /></label>
        <label className="fx-field"><span>{t.city}</span><input className="fx-input" value={f.city} onChange={set("city")} maxLength={80} /></label>
      </div>
      {err && <p className="fx-err" role="alert">{err}</p>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
        <button className="fx-btn" type="submit" disabled={busy}>{t.save}</button>
        <button className="fx-btn ghost" type="button" onClick={onCancel}>{t.cancel}</button>
      </div>
    </form>
  );
}

/* ── one nurse: her plan ──────────────────────────────────────────────────────────────────── */
function NurseView({ t, lang, nurse, onChange, onBack, onRemoved }: { t: T; lang: Lang; nurse: Nurse; onChange: (n: Nurse) => void; onBack: () => void; onRemoved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const { api, demo } = useContext(Api);
  const [origin, setOrigin] = useState("https://borivon.com");
  useEffect(() => setOrigin(window.location.origin), []);
  const shareUrl = `${origin}/ankunft/${nurse.share_token}`;
  const name = nurse.first_name;

  async function toggle(id: StepId, done: boolean) {
    const steps = { ...nurse.steps };
    if (done) steps[id] = new Date().toISOString(); else delete steps[id];
    onChange({ ...nurse, steps }); // at once; the server follows
    const r = await api(`/api/einrichtung/nurses/${nurse.id}`, json("PATCH", { step: id, done })).catch(() => null);
    if (r?.ok) { const j = await r.json().catch(() => null); if (j?.nurse) onChange(j.nurse); }
  }
  async function remove() {
    if (!window.confirm(fill(t.removeQ, { name: `${nurse.first_name} ${nurse.last_name}`.trim() }))) return;
    const r = await api(`/api/einrichtung/nurses/${nurse.id}`, json("DELETE")).catch(() => null);
    if (r?.ok) onRemoved();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2200); } catch { /* the link is visible to copy by hand */ }
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(fill(t.waText, { name, url: shareUrl }))}`;
  const where = [nurse.plz, nurse.city].filter(Boolean).join(" ");

  return (
    <div className="c">
      <button className="fx-link" onClick={onBack} style={{ textDecoration: "none", color: "var(--mute)", fontSize: 13.5, marginBottom: 26 }}>← {t.back}</button>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <p className="fx-lbl">{t.planH}</p>
          <h1 className="fx-h1">{nurse.first_name} {nurse.last_name}{nurse.sample && <span className="fx-tag" style={{ verticalAlign: 14 }}>{t.example}</span>}</h1>
          <p className="fx-mute" style={{ margin: "14px 0 0" }}>
            {[nurse.country && `${t.from} ${nurse.country}`, nurse.arrival && `${t.arrival} ${fmtDate(nurse.arrival, lang, true)}`, nurse.start && `${t.firstDay} ${fmtDate(nurse.start, lang, true)}`, where].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          <button className="fx-link" onClick={() => setEditing((x) => !x)}>{t.edit}</button>
          <button className="fx-link danger" onClick={remove}>{t.remove}</button>
        </div>
      </div>
      {editing && <div style={{ marginTop: 26 }}><NurseForm t={t} facility={{ plz: nurse.plz, city: nurse.city } as Facility} nurse={nurse} onCancel={() => setEditing(false)} onSaved={(n) => { setEditing(false); onChange(n); }} /></div>}
      {where && <p className="fx-lede" style={{ maxWidth: "none" }}>{fill(t.planP, { where })}</p>}
      {nurse.plz && <Plan lang={lang} arrival={nurse.arrival} steps={nurse.steps} placesUrl={`/api/einrichtung/places?plz=${nurse.plz}&city=${encodeURIComponent(nurse.city)}${demo ? "&demo=1" : ""}`} onToggle={toggle} />}
      <div className="fx-share">
        <h2 className="fx-h3">{fill(t.shareH, { name })}</h2>
        <p className="fx-small" style={{ margin: "8px 0 0", maxWidth: "40em" }}>{fill(t.shareP, { name })}</p>
        {demo ? <p className="fx-small" style={{ marginTop: 12 }}>{t.demoNote}</p> : <div className="row">
          <button className="fx-btn sm" onClick={copy}>{copied ? t.copied : t.copy}</button>
          <a className="fx-btn sm ghost" href={wa} target="_blank" rel="noopener noreferrer">{t.whatsapp}</a>
          <a className="fx-link" href={shareUrl} target="_blank" rel="noopener" style={{ alignSelf: "center", fontSize: 13, color: "var(--mute)", wordBreak: "break-all" }}>{shareUrl.replace(/^https?:\/\//, "")}</a>
        </div>}
      </div>
    </div>
  );
}

/* ── the team ─────────────────────────────────────────────────────────────────────────────── */
function TeamView({ t, lang, d, reload }: { t: T; lang: Lang; d: Data; reload: () => void }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = d.me.role === "owner";
  const full = d.team.length >= d.limits.users;
  const { api, demo } = useContext(Api);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setMsg({ ok: false, text: t.errEmail });
    setBusy(true); setMsg(null);
    if (demo) return setMsg({ ok: false, text: t.demoNote });
    const r = await api("/api/einrichtung/team", json("POST", { email: email.trim(), lang })).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok) { setEmail(""); setMsg({ ok: true, text: t.inviteSent }); }
    else setMsg({ ok: false, text: j.error === "limit" ? fill(t.limitUsers, { n: d.limits.users }) : j.error === "already" ? t.already : j.error === "other" ? t.otherFac : r?.status === 429 ? t.errMany : t.errGeneric });
  }
  async function removeUser(m: Member) {
    if (!window.confirm(fill(t.removeUserQ, { email: m.email }))) return;
    if (demo) return setMsg({ ok: false, text: t.demoNote });
    const r = await api(`/api/einrichtung/team/${m.id}`, json("DELETE")).catch(() => null);
    if (r?.ok) reload();
  }

  return (
    <div className="c narrow">
      <h1 className="fx-h1 fx-rise">{t.teamH}</h1>
      <p className="fx-lede fx-rise d1">{t.teamP}</p>
      <ul className="fx-rows" style={{ marginTop: 34 }}>
        {d.team.map((m) => (
          <li key={m.id} style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", padding: "18px 2px" }}>
            <div>
              <div style={{ fontWeight: 500 }}>{m.email}</div>
              <div className="fx-small">{m.role === "owner" ? t.owner : t.member} · {m.last_login_at ? fill(t.lastLogin, { d: fmtDate(m.last_login_at.slice(0, 10), lang) }) : t.never}</div>
            </div>
            {owner && m.role !== "owner" && <button className="fx-link danger" onClick={() => removeUser(m)}>{t.remove}</button>}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 30 }}>
        {!owner ? <p className="fx-small">{t.inviteOwner}</p>
          : full ? <p className="fx-small">{fill(t.limitUsers, { n: d.limits.users })}</p>
          : (
            <form onSubmit={invite} noValidate style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input className="fx-input" style={{ flex: "1 1 240px" }} type="email" placeholder={t.email} value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="fx-btn" type="submit" disabled={busy}>{t.invite}</button>
            </form>
          )}
        {msg && <p className={msg.ok ? "fx-ok" : "fx-err"} style={{ marginTop: 16 }} role="status">{msg.text}</p>}
      </div>
    </div>
  );
}

/* ── the facility ─────────────────────────────────────────────────────────────────────────── */
function SettingsView({ t, d, onSaved, onDeleted }: { t: T; d: Data; onSaved: (f: Facility) => void; onDeleted: () => void }) {
  const [f, setF] = useState({ name: d.facility.name, street: d.facility.street, plz: d.facility.plz, city: d.facility.city });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const owner = d.me.role === "owner";
  const { demo } = useContext(Api);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setMsg({ ok: false, text: t.errName });
    if (!/^\d{5}$/.test(f.plz)) return setMsg({ ok: false, text: t.errPlz });
    if (demo) return setMsg({ ok: false, text: t.demoNote });
    const r = await fetch("/api/einrichtung/facility", json("PATCH", f)).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok && j.facility) { onSaved(j.facility); setMsg({ ok: true, text: t.saved }); } else setMsg({ ok: false, text: t.errGeneric });
  }
  async function del() {
    if (demo) return setMsg({ ok: false, text: t.demoNote });
    if (!window.confirm(t.deleteQ)) return;
    const r = await fetch("/api/einrichtung/facility", json("DELETE", { confirm: true })).catch(() => null);
    if (r?.ok) onDeleted();
  }

  return (
    <div className="c narrow">
      <h1 className="fx-h1 fx-rise">{t.settingsH}</h1>
      <form onSubmit={save} noValidate style={{ marginTop: 34 }}>
        <label className="fx-field"><span>{t.facName}</span><input className="fx-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} /></label>
        <label className="fx-field"><span>{t.street}</span><input className="fx-input" value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} maxLength={120} /></label>
        <div className="fx-grid3">
          <label className="fx-field"><span>{t.plz}</span><input className="fx-input" value={f.plz} onChange={(e) => setF({ ...f, plz: e.target.value.replace(/\D/g, "").slice(0, 5) })} inputMode="numeric" /></label>
          <label className="fx-field"><span>{t.city}</span><input className="fx-input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} maxLength={80} /></label>
        </div>
        {msg && <p className={msg.ok ? "fx-ok" : "fx-err"} role="status">{msg.text}</p>}
        <button className="fx-btn" type="submit">{t.save}</button>
      </form>

      <div style={{ marginTop: 56, paddingTop: 28, borderTop: "1px solid var(--line)" }}>
        <h2 className="fx-h3">{t.legalH}</h2>
        <p className="fx-small" style={{ margin: "8px 0 14px" }}>{t.legalP}</p>
        <div style={{ display: "flex", gap: 22 }}>
          <a className="fx-link" href="/einrichtung/nutzungsbedingungen" target="_blank" rel="noopener">{t.terms}</a>
          <a className="fx-link" href="/einrichtung/avv" target="_blank" rel="noopener">{t.avv}</a>
        </div>
      </div>

      {owner && (
        <div style={{ marginTop: 44, paddingTop: 28, borderTop: "1px solid var(--line)" }}>
          <h2 className="fx-h3">{t.deleteH}</h2>
          <p className="fx-small" style={{ margin: "8px 0 14px" }}>{t.deleteP}</p>
          <button className="fx-link danger" onClick={del}>{t.deleteB}</button>
        </div>
      )}
    </div>
  );
}

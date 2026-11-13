"use client";
/**
 * THE one design kit of the portal (founder 2026-11-13: "one system, one design, one everything").
 * Every portal / admin screen builds from these pieces — never a new style per page:
 *   PageHead   serif title + quiet sub line + actions on the right (stacks on a phone)
 *   BackLink   "← Zurück" as quiet text, never a grey box
 *   Btn        primary = black pill · ghost = hairline pill · quiet = text · danger = red text pill
 *   Card       paper card, 1px hairline, radius 16
 *   Seg        segmented filter (like Alle · Anerkennung · Visum)
 *   Pager      ‹ 1 / 3 ›  + usePaged(items, perLaptop, perPhone): nobody scrolls, lists flip
 *   Dot / Tint status colours (LAW #4: green done · orange waiting · red redo · grey missing)
 *   Field      label + input/select in the one look
 *   Empty      one quiet line with an icon
 * Colours only from the CSS variables (light theme only); gold = small accents, never a filled button.
 */
import React from "react";

export const STATUS_DOT = { approved: "#16a34a", pending: "#f59e0b", rejected: "#dc2626", missing: "#d8d0c0" } as const;
export const STATUS_TINT = { approved: "rgba(22,163,74,.10)", pending: "rgba(245,158,11,.16)", rejected: "rgba(220,38,38,.12)", missing: "transparent" } as const;
export type Status = keyof typeof STATUS_DOT;

const KIT_CSS = `
.bvk-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:20px}
.bvk-head h1{margin:0;font-family:var(--font-serif);font-weight:400;font-size:32px;line-height:1.1;letter-spacing:-.01em;color:var(--w)}
.bvk-head .bvk-sub{margin-top:4px;font-size:13.5px;color:var(--w3)}
.bvk-head .bvk-act{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
@media (max-width:640px){.bvk-head{flex-direction:column;align-items:stretch}.bvk-head h1{font-size:28px}.bvk-head .bvk-act{justify-content:flex-start}}
.bvk-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 18px;border-radius:999px;font-weight:500;font-size:14px;line-height:1;font-family:inherit;cursor:pointer;white-space:nowrap;text-decoration:none;transition:opacity .15s,background .15s}
.bvk-btn:disabled{opacity:.45;cursor:default}
.bvk-primary{background:var(--w);color:var(--bg);border:1px solid var(--w);font-weight:600}
.bvk-primary:hover:not(:disabled){opacity:.88}
.bvk-ghost{background:var(--card);color:var(--w);border:1px solid var(--border)}
.bvk-ghost:hover:not(:disabled){background:var(--bg2)}
.bvk-quiet{background:none;border:0;color:var(--w3);padding:0 4px;height:auto}
.bvk-quiet:hover:not(:disabled){color:var(--w)}
.bvk-danger{background:var(--card);color:#dc2626;border:1px solid rgba(220,38,38,.25)}
.bvk-sm{height:34px;padding:0 14px;font-size:13px}
.bvk-icon{width:36px;padding:0}
.bvk-card{background:var(--card);border:1px solid var(--border);border-radius:16px}
.bvk-seg{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:var(--bg2)}
.bvk-seg button{padding:6px 14px;border-radius:999px;font-size:13px;font-weight:500;border:0;cursor:pointer;font-family:inherit;background:transparent;color:var(--w3)}
.bvk-seg button[aria-selected=true]{background:var(--card);color:var(--w);box-shadow:0 2px 8px -4px rgba(21,19,15,.3)}
.bvk-field{display:flex;flex-direction:column;gap:6px}
.bvk-field>span{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--w3)}
.bvk-input{height:42px;border-radius:10px;border:1px solid var(--border);background:var(--bg);padding:0 12px;font-size:14px;color:var(--w);font-family:inherit;outline:none;width:100%}
.bvk-input:focus{border-color:var(--w)}
textarea.bvk-input{height:auto;min-height:84px;padding:10px 12px;resize:vertical}
.bvk-row{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--border);font-size:14px;color:var(--w)}
.bvk-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:34px 16px;color:var(--w3);font-size:14px;text-align:center}
`;

/** put once per page (cheap; identical tags are fine) */
export function KitStyle() { return <style>{KIT_CSS}</style>; }

export function PageHead({ title, sub, actions, back }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; back?: { label?: string; onClick?: () => void; href?: string } }) {
  return (
    <>
      <KitStyle />
      {back && <div style={{ marginBottom: 14 }}><BackLink {...back} /></div>}
      <div className="bvk-head">
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {sub && <div className="bvk-sub">{sub}</div>}
        </div>
        {actions && <div className="bvk-act">{actions}</div>}
      </div>
    </>
  );
}

export function BackLink({ label = "Zurück", onClick, href }: { label?: string; onClick?: () => void; href?: string }) {
  const inner = <><span aria-hidden="true">←</span>{label}</>;
  const style: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: 0, padding: 0, fontSize: 13, color: "var(--w3)", cursor: "pointer", textDecoration: "none", fontFamily: "inherit" };
  return href ? <a href={href} style={style}>{inner}</a> : <button type="button" onClick={onClick} style={style}>{inner}</button>;
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "ghost" | "quiet" | "danger"; size?: "md" | "sm"; icon?: boolean };
export const Btn = React.forwardRef<HTMLButtonElement, BtnProps>(function Btn({ kind = "ghost", size = "md", icon, className, type, ...rest }, ref) {
  return <button ref={ref} type={type ?? "button"} className={`bvk-btn bvk-${kind}${size === "sm" ? " bvk-sm" : ""}${icon ? " bvk-icon" : ""}${className ? ` ${className}` : ""}`} {...rest} />;
});

export function Card({ children, style, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`bvk-card${className ? ` ${className}` : ""}`} style={style} {...rest}>{children}</div>;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, React.ReactNode][]; onChange: (v: T) => void }) {
  return (
    <span className="bvk-seg" role="tablist">
      {options.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </span>
  );
}

export function Dot({ st, size = 9 }: { st: Status; size?: number }) {
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: "50%", background: STATUS_DOT[st], flex: "none", display: "inline-block" }} />;
}

export function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <label className="bvk-field"><span>{label}</span>{children}</label>;
}

export function Empty({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return <div className="bvk-empty">{icon}{children}</div>;
}

/** lists flip instead of scrolling: per page from the viewport (laptop / phone) */
export function usePaged<T>(items: T[], perLaptop = 10, perPhone = 7) {
  const [page, setPage] = React.useState(0);
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const m = window.matchMedia("(max-width:640px)");
    const f = () => setNarrow(m.matches);
    f(); m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  const per = narrow ? perPhone : perLaptop;
  const pages = Math.max(1, Math.ceil(items.length / per));
  const p = Math.min(page, pages - 1);
  return { slice: items.slice(p * per, p * per + per), page: p, pages, setPage, narrow };
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const btn = (dis: boolean): React.CSSProperties => ({ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: dis ? "var(--border)" : "var(--w2)", cursor: dis ? "default" : "pointer" });
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 14 }}>
      <button type="button" aria-label="‹" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))} style={btn(page === 0)}>‹</button>
      <span style={{ fontSize: 12, color: "var(--w3)" }}>{page + 1} / {pages}</span>
      <button type="button" aria-label="›" disabled={page >= pages - 1} onClick={() => onPage(Math.min(pages - 1, page + 1))} style={btn(page >= pages - 1)}>›</button>
    </div>
  );
}

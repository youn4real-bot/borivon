import "./fx.css";
import type { LegalDoc } from "@/lib/facility/legal";

/** A contract page in the platform's look (German: the binding language). Server-rendered. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="fx">
      <header className="fx-top">
        <div className="c"><a className="fx-logo" href="/einrichtung">Borivon<b>.</b></a></div>
      </header>
      <main id="main-content" className="fx-main">
        <article className="c narrow">
          <p className="fx-lbl">Borivon-Plattform</p>
          <h1 className="fx-h2">{doc.title}</h1>
          <p className="fx-small" style={{ margin: "12px 0 0" }}>{doc.stand}</p>
          {doc.intro && <p style={{ margin: "26px 0 0", fontSize: 15, color: "var(--ink2)" }}>{doc.intro}</p>}
          {doc.sections.map((s) => (
            <section key={s.h} style={{ borderTop: "1px solid var(--line)", marginTop: 30, paddingTop: 24 }}>
              <h2 className="fx-h3" style={{ fontSize: "1.15rem" }}>{s.h}</h2>
              {s.p.map((p, i) => <p key={i} style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.7, color: "var(--ink2)" }}>{p}</p>)}
            </section>
          ))}
        </article>
      </main>
      <footer className="fx-foot">
        <div className="c">
          <span>© Borivon LLC</span>
          <a href="/impressum">Impressum</a>
          <a href="/datenschutz">Datenschutz</a>
          <a href="/einrichtung/nutzungsbedingungen">Nutzungsbedingungen</a>
          <a href="/einrichtung/avv">AVV</a>
        </div>
      </footer>
    </div>
  );
}

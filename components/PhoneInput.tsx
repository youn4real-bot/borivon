"use client";

/**
 * PhoneInput — country-code dropdown (ALL countries, SVG flags) + number input.
 *
 * Shared by the CV builder and the registration form so both offer the full
 * country list and behave identically. COUNTRY_CODES is derived from
 * COUNTRY_MAP + ISO3_TO_PHONE, so adding a country to lib/countries.ts adds it
 * here automatically. Value is a single string: "<dialCode> <number>"
 * (e.g. "+212 600 000 000"). Morocco is the default + gets digit grouping.
 */
import { useState, useEffect } from "react";
import { useLang } from "@/components/LangContext";
import { COUNTRY_MAP, ISO3_TO_ISO2, ISO3_TO_PHONE } from "@/lib/countries";
import { X as XIcon } from "lucide-react";

const COUNTRY_CODES: { code: string; iso: string; iso3: string; name: string }[] =
  Object.entries(COUNTRY_MAP)
    .filter(([iso3]) => ISO3_TO_PHONE[iso3] && ISO3_TO_ISO2[iso3])
    .map(([iso3, names]) => ({
      iso3,
      iso: ISO3_TO_ISO2[iso3],
      code: ISO3_TO_PHONE[iso3],
      name: names.en, // sort key — UI re-localizes via lang at render time
    }));

function formatPhoneNumber(digits: string): string {
  // Morocco numbers are 9 digits (after +212). Cap to 9 and group into 3s.
  const clean = digits.replace(/\D/g, "").slice(0, 9);
  return clean.match(/.{1,3}/g)?.join(" ") ?? clean;
}

export function CountryFlag({ iso, size = 22 }: { iso: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://flagcdn.com/${iso}.svg`} alt={iso}
      width={size} height={size * 0.72} style={{ display: "inline-block", borderRadius: "3px", objectFit: "cover", flexShrink: 0 }} />
  );
}

export function PhoneInput({ value, onChange, hasError = false }: { value: string; onChange: (v: string) => void; hasError?: boolean }) {
  const { lang } = useLang();
  // Localize the names + sort alphabetically by current language (A-Z).
  const sortedCountries = COUNTRY_CODES
    .map(c => {
      const names = COUNTRY_MAP[c.iso3];
      return { ...c, name: names ? (names[lang as "fr" | "en" | "de"] ?? c.name) : c.name };
    })
    .sort((a, b) => a.name.localeCompare(b.name, lang));
  // Track the chosen country by ISO (so when 2 countries share a code like +1, we remember which).
  const [selectedIso, setSelectedIso] = useState<string>(() => {
    const m = value.match(/^(\+\d+)\s*/);
    if (m) {
      const found = COUNTRY_CODES.find(c => c.code === m[1]);
      return found?.iso ?? "ma";
    }
    return "ma";
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const selected = COUNTRY_CODES.find(c => c.iso === selectedIso) ?? COUNTRY_CODES[0];

  const m = value.match(/^(\+\d+)\s*(.*)$/);
  const currentNum = m?.[2] ?? "";
  const isMorocco = selected.iso === "ma";

  function pickCountry(iso: string) {
    const c = COUNTRY_CODES.find(x => x.iso === iso);
    if (!c) return;
    setSelectedIso(iso);
    setOpen(false);
    const stripped = currentNum.replace(/\s+/g, "");
    const next = c.iso === "ma" ? formatPhoneNumber(stripped) : stripped;
    onChange(`${c.code} ${next}`.trim());
  }
  function setNum(raw: string) {
    const next = isMorocco ? formatPhoneNumber(raw) : raw.replace(/\D/g, "");
    onChange(`${selected.code} ${next}`.trim());
  }

  return (
    <div className="flex gap-2 relative" data-cv-error={hasError ? "1" : undefined}>
      <button type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-3.5 text-[15px] font-medium outline-none cursor-pointer transition-all"
        style={{ background: "var(--bg2)", border: "1px solid transparent", color: "var(--w)", borderRadius: "12px", flexShrink: 0 }}
        onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
        onBlur={e => (e.currentTarget.style.borderColor = "transparent")}
      >
        <CountryFlag iso={selected.iso} size={20} />
        <span>{selected.code}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <input
        type="tel"
        inputMode="numeric"
        value={currentNum}
        onChange={e => setNum(e.target.value)}
        placeholder={isMorocco ? "600 000 000" : ""}
        className="flex-1 w-full px-4 py-3.5 text-[15px] font-medium outline-none transition-all"
        style={{ background: "var(--bg2)", border: `1px solid ${hasError ? "var(--danger)" : "transparent"}`, color: "var(--w)", borderRadius: "12px" }}
        onFocus={e => (e.currentTarget.style.borderColor = "var(--gold)")}
        onBlur={e => (e.currentTarget.style.borderColor = hasError ? "var(--danger)" : "transparent")}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-[1100]"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", animation: "bvFadeRise 0.2s var(--ease-out)" }}
            onClick={() => setOpen(false)} />
          <div className="fixed inset-0 z-[1101] flex items-center justify-center p-4 pb-[88px] sm:pb-4 pointer-events-none">
            <div className="w-full max-w-[360px] max-h-[70dvh] overflow-hidden flex flex-col pointer-events-auto"
              style={{ background: "var(--card)", borderRadius: "20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", animation: "bvFadeRise 0.24s var(--ease-out)" }}>
              <div className="flex items-center justify-between px-5 py-4">
                <h3 className="text-[15px] font-semibold" style={{ color: "var(--w)" }}>
                  {lang === "de" ? "Land auswählen" : lang === "en" ? "Select country" : "Choisir un pays"}
                </h3>
                <button type="button" onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex items-center justify-center w-8 h-8 transition-opacity hover:opacity-70"
                  style={{ background: "var(--bg2)", border: "none", borderRadius: "10px", color: "var(--w2)", cursor: "pointer" }}>
                  <XIcon size={15} strokeWidth={2} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2">
                {sortedCountries.map(c => (
                  <button key={c.iso} type="button" onClick={() => pickCountry(c.iso)}
                    onMouseEnter={e => { if (c.iso !== selectedIso) e.currentTarget.style.background = "var(--bg2)"; }}
                    onMouseLeave={e => { if (c.iso !== selectedIso) e.currentTarget.style.background = "transparent"; }}
                    className="w-full flex items-center gap-3 px-3 py-3 text-[14px] text-left transition-colors"
                    style={{ background: c.iso === selectedIso ? "var(--bg2)" : "transparent", border: "none", color: "var(--w)", borderRadius: "10px", cursor: "pointer" }}>
                    <CountryFlag iso={c.iso} size={22} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span style={{ color: "var(--w3)" }}>{c.code}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

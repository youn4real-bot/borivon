/**
 * Reusable Intl.DateTimeFormat instances.
 *
 * Constructing a formatter loads and configures ICU data, which is one of the
 * genuinely expensive things a Worker isolate can do. The codebase builds them
 * inside loops — once per booking slot, once per calendar event, once per
 * reminder — and that showed up on production as roughly two seconds of the
 * booking API's response time with nothing else to blame it on. Formatters are
 * stateless (the instant is an argument to format/formatToParts), so one
 * instance per configuration serves every call and there is nothing to
 * invalidate.
 *
 * Keyed on locale + options. The map is bounded in practice by the handful of
 * distinct configurations the code actually uses.
 */
const CACHE = new Map<string, Intl.DateTimeFormat>();

export function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = CACHE.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    CACHE.set(key, f);
  }
  return f;
}

/** Formatted parts as a plain record, minus the literals nobody wants. */
export function dtfParts(
  locale: string,
  options: Intl.DateTimeFormatOptions,
  at: Date,
): Record<string, string> {
  return dtf(locale, options).formatToParts(at).reduce((a, p) => {
    if (p.type !== "literal") a[p.type] = p.value;
    return a;
  }, {} as Record<string, string>);
}

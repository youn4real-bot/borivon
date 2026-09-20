import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isPossibleProfileSlug } from "../app/[slug]/isProfileSlug";
import {
  ADMIN_PROFILE_SLUG,
  RESERVED_SLUGS,
  buildProfileSlug,
  parseProfileSlug,
} from "../lib/profile-slug";

/**
 * AN ADDRESS THAT DOES NOT EXIST MUST NOT ANSWER 200.
 *
 * /[slug] is the last route in the tree, so every one-segment address nobody
 * else claims landed on it — and it was a client component whose only
 * not-found path was a notFound() inside a useEffect, which runs in the browser
 * long after the status code is settled. Measured against production on
 * 2026-09-20: /key.json, /google-key.json, /credentials.json, /gcp-sa.json,
 * /sa.json and /.env each answered 200 with ~21 KB of app shell, while a
 * scanner walked exactly that list. Two-segment misses (/foo/bar) already
 * answered 404 correctly; this route alone was answering for the unknown.
 *
 * The other half of this suite is the half that matters more: the guard must
 * never 404 a real nurse's profile. That is why it refuses exactly — and only —
 * the slugs that GET /api/p/<slug> already refuses on shape, before it touches
 * the database.
 */

/** Read a file with comments blanked, preserving offsets — the fixes here are
 *  commented with the broken pattern they replace, so scanning raw text would
 *  match the explanation instead of the code. Same helper as
 *  tests/adminPanelHonesty.test.ts. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const PAGE   = code("app/[slug]/page.tsx");
const CLIENT = code("app/[slug]/PublicProfileClient.tsx");
const API    = code("app/api/p/[slug]/route.ts");
const NOTFND = code("app/not-found.tsx");

// The exact paths that were 200ing in production, plus the rest of the family
// a credential scanner walks.
const SCANNER_PROBES = [
  "key.json", "google-key.json", "credentials.json", "gcp-sa.json", "sa.json",
  ".env", ".env.local", ".git", "config.json", "secrets.json",
  "wp-admin", "wp-login.php", "phpinfo.php", "backup.sql", "id_rsa",
];

describe("an address that cannot be a profile is refused", () => {
  it("refuses every path the production scanner was probing", () => {
    for (const probe of SCANNER_PROBES) {
      expect(isPossibleProfileSlug(probe), probe).toBe(false);
    }
  });

  it("refuses every reserved top-level path", () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(isPossibleProfileSlug(reserved), reserved).toBe(false);
    }
  });

  it("refuses anything that is not <ascii-name><5 digits>", () => {
    expect(isPossibleProfileSlug("yassine")).toBe(false);      // no id suffix
    expect(isPossibleProfileSlug("yassine1234")).toBe(false);  // only 4 digits
    expect(isPossibleProfileSlug("78492")).toBe(false);        // no name
    expect(isPossibleProfileSlug("yassine-78492")).toBe(false); // hyphen: slugs have no separator
    expect(isPossibleProfileSlug("yassine 78492")).toBe(false); // space
    expect(isPossibleProfileSlug("yassiné78492")).toBe(false);  // accent: build folds it to "yassine"

    // NOT a counter-example: six trailing digits still parses, as "yassine1"
    // plus the five-digit id. The guard has to accept it for the same reason
    // /api/p does — a first name ending in a digit is a name the builder can
    // produce, and refusing it here would 404 that candidate's page.
    expect(isPossibleProfileSlug("yassine123456")).toBe(true);
  });
});

describe("every address that could be a real profile still renders", () => {
  it("accepts the admin vanity slug", () => {
    expect(isPossibleProfileSlug(ADMIN_PROFILE_SLUG)).toBe(true);
    // Hand-typed capitals resolve the same way /api/p resolves them.
    expect(isPossibleProfileSlug(ADMIN_PROFILE_SLUG.toUpperCase())).toBe(true);
  });

  it("accepts every slug buildProfileSlug can produce", () => {
    // Names drawn from the shapes the candidate base actually contains:
    // accents, an eszett, a hyphen, a space, a trailing digit.
    const names = [
      "Yassine", "Fatima-Zahra", "Salma", "Abdelilah", "Zoé", "Straßer",
      "Anne Marie", "O'Brien", "Mohamed 2", "İlayda", "Nour",
    ];
    const ids = [
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "9c858901-8a57-4791-81fe-4c455b099bc9",
    ];
    for (const n of names) {
      for (const id of ids) {
        const slug = buildProfileSlug(n, "ignored", id);
        expect(isPossibleProfileSlug(slug), `${n} -> ${slug}`).toBe(true);
        // And it round-trips through the same parser /api/p uses.
        expect(parseProfileSlug(slug), slug).not.toBeNull();
      }
    }
  });

  it("agrees with /api/p: anything that route could answer 200 for is let through", () => {
    // THE SAFETY PROPERTY. The page can only ever display a profile when
    // GET /api/p/<slug> answers 200, and that route 404s on shape whenever
    // `!parsed && !isAdminSlug`. So every slug that clears the route's shape
    // check must clear this guard too, or the guard hides a live profile.
    const corpus = [
      ...SCANNER_PROBES,
      ...RESERVED_SLUGS,
      ADMIN_PROFILE_SLUG,
      "yassine78492", "a00000", "salma00001", "nour99999", "zz12345",
      "Yassine78492", "yassine", "12312345", "", "..", "%2e%2e",
    ];
    for (const slug of corpus) {
      const apiWouldTryToServe =
        parseProfileSlug(slug) !== null || slug.toLowerCase() === ADMIN_PROFILE_SLUG;
      if (apiWouldTryToServe) {
        expect(isPossibleProfileSlug(slug), slug).toBe(true);
      }
    }
  });

  it("no reserved path can also be a valid profile slug", () => {
    // If one ever could, the reserved list would be silently deleting a real
    // candidate's page rather than protecting a route.
    for (const reserved of RESERVED_SLUGS) {
      const couldBeAProfile =
        parseProfileSlug(reserved) !== null || reserved.toLowerCase() === ADMIN_PROFILE_SLUG;
      expect(couldBeAProfile, reserved).toBe(false);
    }
  });
});

describe("the decision is made where it can set the status code", () => {
  it("the route's page is a server component", () => {
    // A client component cannot answer 404 — by the time it renders, the 200 is
    // already on the wire. This single line is the whole fix.
    expect(PAGE.includes('"use client"')).toBe(false);
    expect(PAGE.includes("'use client'")).toBe(false);
  });

  it("the page refuses before rendering, not from an effect", () => {
    expect(/notFound\(\)/.test(PAGE)).toBe(true);
    // useEffect is the exact pattern that made the old guard cosmetic.
    expect(PAGE.includes("useEffect")).toBe(false);
  });

  it("the page guards with the shared predicate rather than its own copy", () => {
    // Called on the slug, not merely imported — an unused import would leave
    // every unknown address answering 200 again while the file still reads
    // as if it were guarded.
    expect(/isPossibleProfileSlug\s*\(\s*slug\s*\)/.test(PAGE)).toBe(true);
  });

  it("the client half no longer pretends it can 404", () => {
    // It runs in the browser; a notFound() there changes what is painted but
    // never the status the scanner and the crawler actually read.
    expect(CLIENT.includes("notFound")).toBe(false);
  });

  it("/api/p still 404s on shape before any database work", () => {
    // The guard above is only lossless while this line holds. If the route is
    // ever loosened to resolve a different slug shape, this fails and the page
    // guard has to be revisited in the same change.
    expect(
      /if\s*\(\s*!parsed\s*&&\s*!isAdminSlug\s*\)\s*return\s+NextResponse\.json\(\s*\{\s*error:\s*"not_found"\s*\}\s*,\s*\{\s*status:\s*404/.test(API),
    ).toBe(true);
  });
});

describe("the 404 page itself still renders on the server", () => {
  it("app/not-found.tsx is a server component", () => {
    // MEASURED on the dev server, 2026-09-20. The not-found element is handed
    // to the router as a PROP, rendered ahead of the error that selects it. A
    // server component serialises into that prop as finished markup, so the
    // HTML for /key.json carries the whole 404 page. Turn the same file into a
    // client component and the prop carries only a reference: the response is
    // still 404, but the body arrives empty and stays empty until JavaScript
    // hydrates it. On a Moroccan phone that is a blank screen.
    //
    // This was tried — the reason was making the page trilingual per LAW #19 —
    // and reverted on that evidence. Any future attempt has to keep the text
    // server-rendered (for instance markup for all three languages, shown by
    // CSS keyed on <html lang>), not move the file to the client.
    expect(NOTFND.includes('"use client"')).toBe(false);
    expect(NOTFND.includes("'use client'")).toBe(false);
  });
});

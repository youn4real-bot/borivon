/**
 * The example workspace (/einrichtung/beispiel): the real screens with made-up data, nothing saved,
 * nothing sent. A fetch look-alike answers the workspace's few API calls from memory.
 */
import type { Facility, Nurse } from "@/lib/facility/db";

/** Postcodes the example may look up without a login (places/route.ts allows only these). */
export const DEMO_PLZ = ["83022"];

const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const ago = (n: number) => new Date(Date.now() - n * 86400e3).toISOString();

export function demoApi(): typeof fetch {
  const facility: Facility = { id: "demo", lead_id: "", name: "Seniorenzentrum am Inn (Beispiel)", kind: "care_home", street: "", plz: "83022", city: "Rosenheim", status: "active", created_at: ago(30) };
  const mk = (id: string, first: string, last: string, arrival: string, start: string, done: string[]): Nurse => ({
    id, facility_id: "demo", first_name: first, last_name: last, country: "Marokko", arrival, start, plz: "83022", city: "Rosenheim",
    steps: Object.fromEntries(done.map((s) => [s, ago(2)])), share_token: `demo-${id}`, sample: false, created_at: ago(20), updated_at: ago(1),
  });
  let nurses: Nurse[] = [
    mk("n1", "Amina", "El Idrissi", day(-12), day(2), ["wohnung", "anmeldung", "konto"]),
    mk("n2", "Youssef", "Benali", day(9), day(23), []),
    mk("n3", "Salma", "Ouazzani", day(31), day(45), []),
  ];
  const team = [
    { id: "u1", email: "leitung@beispiel.de", role: "owner", last_login_at: ago(0) },
    { id: "u2", email: "pdl@beispiel.de", role: "member", last_login_at: ago(3) },
  ];
  const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const path = url.split("?")[0];
    if (path === "/api/einrichtung/me") return ok({ facility, me: { id: "u1", email: "leitung@beispiel.de", role: "owner", salutation: "frau", last_name: "Beispiel" }, team, nurses, limits: { nurses: 5, users: 2 } });
    if (path === "/api/einrichtung/nurses" && method === "POST") {
      if (nurses.length >= 5) return ok({ error: "limit", limit: 5 }, 403);
      const n = mk(`n${Date.now()}`, String(body.first_name || ""), String(body.last_name || ""), String(body.arrival || ""), String(body.start || ""), []);
      n.country = String(body.country || ""); n.plz = "83022"; n.city = "Rosenheim";
      nurses = [...nurses, n];
      return ok({ nurse: n });
    }
    const m = path.match(/^\/api\/einrichtung\/nurses\/(.+)$/);
    if (m) {
      const n = nurses.find((x) => x.id === m[1]);
      if (!n) return ok({ error: "not_found" }, 404);
      if (method === "DELETE") { nurses = nurses.filter((x) => x.id !== n.id); return ok({ ok: true }); }
      const next = { ...n, steps: { ...n.steps } };
      if (typeof body.step === "string") { if (body.done) next.steps[body.step] = new Date().toISOString(); else delete next.steps[body.step]; }
      for (const k of ["first_name", "last_name", "country", "arrival", "start"] as const) if (k in body) next[k] = String(body[k] ?? "");
      nurses = nurses.map((x) => (x.id === n.id ? next : x));
      return ok({ nurse: next });
    }
    // team, facility, logout: the example changes nothing
    return ok({ error: "demo" }, 403);
  }) as typeof fetch;
}

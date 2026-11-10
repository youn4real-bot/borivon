/**
 * The example nurse every new workspace starts with ("see the things for themselves", founder
 * 2026-11-10). Clearly marked as an example, not counted in the free scope, deletable.
 */
import { newId, randomToken } from "./db";

export function sampleNurse(facilityId: string, plz: string, city: string) {
  const day = (n: number) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
  return {
    id: newId(), facility_id: facilityId, first_name: "Amina", last_name: "(Beispiel)", country: "Marokko",
    arrival: day(28), start: day(42), plz, city, steps: { wohnung: new Date().toISOString() } as Record<string, string>,
    share_token: randomToken(),
  };
}

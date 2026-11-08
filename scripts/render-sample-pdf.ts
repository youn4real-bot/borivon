// Renders the Fahrplan PDF + bonus exactly as a lead gets them, for review.
// Run: npx tsx scripts/render-sample-pdf.ts
// A made-up example lead from the v2 form (lib/roadmap/form.ts).
import { writeFileSync, mkdirSync } from "fs";
import { renderRoadmapPdf } from "../lib/roadmap/pdf";
import { renderAgencyCheckPdf } from "../lib/roadmap/bonusPdf";
import { scoreRoadmap } from "../lib/roadmap/score";
import { normalizeForm, toModel, facilityLine } from "../lib/roadmap/form";
import { addressName } from "../lib/roadmap/consent";

(async () => {
  const form = normalizeForm({
    art: "care_home", rolle: "lead", standorte: "1", land: "BY", plaetze: "100-200", bedarf: "6-10", leasing: "3-5",
    erfahrung: "failed", grund: ["papers", "left"], deutsch: "b1", start: "date", datum: "2027-09-01",
    haben: ["flat", "mentor"], wer: "me_board",
  });
  const result = scoreRoadmap(toModel(form));
  mkdirSync("preview", { recursive: true });
  writeFileSync("preview/Fahrplan-Beispiel.pdf", await renderRoadmapPdf({
    result, lang: "de", form, name: addressName("de", "frau", "Müller", "Anna"), facility: facilityLine(form, "de"), date: new Date(),
  }));
  writeFileSync("preview/Agentur-Check-Beispiel.pdf", await renderAgencyCheckPdf("de"));
  console.log("ok", result.level, result.totalYear);
})();

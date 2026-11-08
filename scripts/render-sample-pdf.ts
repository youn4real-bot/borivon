// Renders the Fahrplan PDF + bonus exactly as a lead gets them, for review.
// Run: npx tsx scripts/render-sample-pdf.ts
import { writeFileSync, mkdirSync } from "fs";
import { renderRoadmapPdf } from "../lib/roadmap/pdf";
import { renderAgencyCheckPdf } from "../lib/roadmap/bonusPdf";
import { scoreRoadmap } from "../lib/roadmap/score";

(async () => {
  const result = scoreRoadmap({ facilityType: "care_home", staff: 42, openPosts: 4, leftLastYear: 6, agency: "mid", foreign: "tried_left", onboarding: ["plan"], pain: "leaving" });
  mkdirSync("preview", { recursive: true });
  writeFileSync("preview/Fahrplan-Beispiel.pdf", await renderRoadmapPdf({ result, lang: "de", name: "Frau Müller", facility: "Seniorenzentrum Am Park", date: new Date() }));
  writeFileSync("preview/Agentur-Check-Beispiel.pdf", await renderAgencyCheckPdf("de"));
  console.log("ok", result.level);
})();

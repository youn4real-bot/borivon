-- Per-org override of WHICH documents count toward a candidate's completion %.
-- NULL  → use the built-in default required set (lib/candidateChecklist.ts).
-- text[] → exactly these catalog keys are required for this org's candidates, so
--          an agency (e.g. Calmaroi) that doesn't need Abitur / Praktikum gets a
--          % measured only against the papers it actually asks for.
-- Schema-tolerant everywhere: a missing column just falls back to the default set.
alter table organizations
  add column if not exists required_doc_keys text[] default null;

comment on column organizations.required_doc_keys is
  'Override of candidateChecklist doc keys that count toward the completion %. NULL = built-in default required set.';

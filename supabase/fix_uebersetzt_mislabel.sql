-- Repair: translations that were filed in the ORIGINAL box, and the originals
-- they archived.
--
-- Cause (fixed in app/portal/admin/page.tsx + lib/fileKeys.ts): the admin
-- panel's paired Qualification row passed the pair's ORIGINAL label to BOTH
-- sub-boxes, so an upload into "Übersetzt" was sent as
-- fileKey=<x>_de + fileType="<original label>". documents.file_type is what
-- every reader resolves back into a key, so the translation showed up in the
-- Original box — and the retire pass, which also matches on the label,
-- superseded the real original.
--
-- Measured on this database before the fix: 30 rows whose file_name ends
-- _uebersetzt carry an original's label. All 30 are admin uploads, across 3
-- candidates.
--
-- ONE ROW IS NOT WHAT ITS NAME SAYS. The filename is normally ground truth (the
-- server builds it from the fileKey), but in one slot the sha256 of the R2
-- objects says otherwise: ce84e9e4 (candidate 6a9d…, work experience, live)
-- is byte-identical to that slot's ORIGINAL (1f47f2de…, 155,507 B) — someone
-- uploaded the original document into the Übersetzt cell on 2026-09-11 — while
-- the genuine translation (7699b8ad…, 340,805 B) sits in thirteen archived
-- rows. So that row STAYS where it is (its box, Original, already shows the
-- right document), its slot's archived original is NOT revived (that would put
-- two live rows in one box), and the newest genuine translation is revived in
-- its place. An earlier draft of this file moved ce84e9e4 into the Übersetzt
-- box, which would have shown that candidate the original twice and left the
-- real translation archived.
--
-- Bytes are never touched (LAW #33): only the label, and the archive marker.

-- 1. Put every mislabelled translation in its own box. The WHERE is the bug's
--    exact fingerprint — a file NAMED _uebersetzt carrying an original's label
--    — so it corrects the archived history too, and any row written by a client
--    that has not picked up the fix yet.
update documents
set file_type = case file_type
  when 'Berufserfahrung'     then 'Berufserfahrung (DE)'
  when 'Diplom'              then 'Diplom (DE)'
  when 'Abitur'              then 'Abitur (DE)'
  when 'Notenübersicht'      then 'Notenübersicht (DE)'
  when 'Ausbildungsprogramm' then 'Ausbildungsprogramm (DE)'
  when 'Nursing Transcript'  then 'Nursing Transcript (German)'
  else file_type end
where file_name ~* '_uebersetzt\.[a-z0-9]+$'
  and file_type in ('Berufserfahrung', 'Diplom', 'Abitur', 'Notenübersicht',
                    'Ausbildungsprogramm', 'Nursing Transcript')
  and id <> 'ce84e9e4-a726-4199-b134-fa8b73538ea5';   -- holds the ORIGINAL's bytes

-- 2. Bring back the five originals those uploads archived. Listed by id, not by
--    rule: an original may also have been archived legitimately by a later
--    re-upload, and reviving one of those would put two live files in one box.
--    Each of these five is the only archived original in a slot that now has
--    none live. (5790184e is deliberately NOT here: its box is already filled
--    by ce84e9e4 above.)
update documents
set superseded_at = null
where superseded_at is not null
  and id in (
    '3d3d0a31-e7db-4e29-a9d1-266840ba122c',
    '847e59b9-ae5c-4393-981f-75ef4012a9b6',
    '47bfbf9d-fb11-4974-a114-914fec8669ae',
    '85770f20-6517-41e2-aa41-4722f2848057',
    '4f5c6479-a992-4df5-bfe3-7af9a845144b'
  );

-- 3. Bring back the genuine translation whose box the mis-upload left empty,
--    under its own label (step 1 skipped it: it is archived, not mislabelled in
--    the same way — its label is the original's because of the same bug).
update documents
set superseded_at = null, file_type = 'Berufserfahrung (DE)'
where id = 'c79b9a11-277f-4c06-a7a1-2c0a5387008c';

-- 4. Proof. All three numbers must come back 0.
select
  (select count(*) from documents
    where file_name ~* '_uebersetzt\.[a-z0-9]+$'
      and file_type !~ '\((DE|German|Allemand)\)$'
      and id <> 'ce84e9e4-a726-4199-b134-fa8b73538ea5')                as translations_still_mislabelled,
  (select count(*) from documents
    where id in ('3d3d0a31-e7db-4e29-a9d1-266840ba122c','847e59b9-ae5c-4393-981f-75ef4012a9b6',
                 '47bfbf9d-fb11-4974-a114-914fec8669ae','85770f20-6517-41e2-aa41-4722f2848057',
                 '4f5c6479-a992-4df5-bfe3-7af9a845144b','c79b9a11-277f-4c06-a7a1-2c0a5387008c')
      and superseded_at is not null)                                   as rows_still_archived,
  (select count(*) from documents d
    where d.superseded_at is null
      and d.user_id in (select user_id from documents
                        where file_name ~* '_uebersetzt\.[a-z0-9]+$')
    group by d.user_id, d.file_type having count(*) > 1 limit 1)       as any_box_with_two_live_rows;

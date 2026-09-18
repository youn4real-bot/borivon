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
-- candidates. 24 are already archived (each new wrong upload retired the
-- previous wrong one); 6 are live, and each of those 6 slots has NO live
-- original left. Every one of the 6 has exactly one archived original to
-- restore, and the matching _de box is empty — so this repair can neither
-- leave two live rows in a box nor overwrite anything.
--
-- Bytes are never touched (LAW #33): only the label, and the archive marker.

-- 1. Put every mislabelled translation in its own box. The WHERE is the bug's
--    exact fingerprint — a file NAMED _uebersetzt carrying an original's label
--    — so it corrects the archived history too, and a row written by an
--    un-deployed client between now and this run.
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
                    'Ausbildungsprogramm', 'Nursing Transcript');

-- 2. Bring back the six originals those uploads archived. Listed by id, not by
--    rule: an original may also have been archived legitimately by a later
--    re-upload, and reviving one of those would put two live files in one box.
--    These six were each verified to be the only archived original in a slot
--    that now has none live.
update documents
set superseded_at = null
where superseded_at is not null
  and id in (
    '5790184e-537e-4bff-9fb0-7d3dcda6b7c4',
    '3d3d0a31-e7db-4e29-a9d1-266840ba122c',
    '847e59b9-ae5c-4393-981f-75ef4012a9b6',
    '47bfbf9d-fb11-4974-a114-914fec8669ae',
    '85770f20-6517-41e2-aa41-4722f2848057',
    '4f5c6479-a992-4df5-bfe3-7af9a845144b'
  );

-- 3. Proof. Both numbers must come back 0.
select
  (select count(*) from documents
    where file_name ~* '_uebersetzt\.[a-z0-9]+$'
      and file_type !~ '\((DE|German|Allemand)\)$')                    as translations_still_mislabelled,
  (select count(*) from documents
    where id in ('5790184e-537e-4bff-9fb0-7d3dcda6b7c4','3d3d0a31-e7db-4e29-a9d1-266840ba122c',
                 '847e59b9-ae5c-4393-981f-75ef4012a9b6','47bfbf9d-fb11-4974-a114-914fec8669ae',
                 '85770f20-6517-41e2-aa41-4722f2848057','4f5c6479-a992-4df5-bfe3-7af9a845144b')
      and superseded_at is not null)                                    as originals_still_archived;

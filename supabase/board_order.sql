-- Drag-and-drop ordering for the Batch Tracker.
--
-- The tracker listed candidates in whatever order the query returned, so the
-- person you actually need to act on today could sit anywhere in the list. This
-- column stores the order YOU drag them into, per candidate, so the board keeps
-- your priority between visits and across devices.
--
-- NULL = never dragged. The UI sorts `board_order` first (nulls last) and falls
-- back to the previous name ordering, so an un-dragged board looks exactly as it
-- does today and only changes once you actually move someone.
--
-- Additive + idempotent; the tracker is schema-tolerant, so until this is run
-- drag-and-drop simply doesn't persist and nothing else changes.
--
-- ▶ Run once in the Supabase SQL editor.

alter table public.candidate_pipeline
  add column if not exists board_order int;

-- Hot path: "the candidates of this batch, in board order".
create index if not exists candidate_pipeline_board_order_idx
  on public.candidate_pipeline (batch_id, board_order);

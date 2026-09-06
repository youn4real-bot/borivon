-- Per-slot required/optional flag for Bearbeitung + Visum document slots.
-- true  = PERMANENT / required — candidate must fill+sign+upload it; counts toward
--         the phase's completeness.
-- false = OPTIONAL — extra doc the candidate may skip; never blocks completeness.
-- Default true so every EXISTING slot keeps its current (required) behavior.
alter table public.phase_slots
  add column if not exists is_required boolean not null default true;

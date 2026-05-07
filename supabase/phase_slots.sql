-- Dynamic document slot templates for Bearbeitung and Visum phases.
-- org_id = null  → global (configured by supreme admin)
-- org_id = <uuid> → org-specific (configured by org admin, overrides global)

create table if not exists phase_slots (
  id uuid default gen_random_uuid() primary key,
  org_id uuid,
  phase text not null check (phase in ('bearbeitung', 'visum')),
  position int not null default 0,
  type text not null default 'simple' check (type in ('simple', 'dual')),
  label text not null,
  label_trans text,
  created_at timestamptz default now()
);

create index if not exists phase_slots_org_phase_pos
  on phase_slots (org_id, phase, position);

-- Default global slots (org_id = null → visible to all orgs as fallback)
-- Edit labels via the admin panel after running this migration.
insert into phase_slots (org_id, phase, position, type, label) values
  (null, 'bearbeitung', 0, 'simple', 'Dokument 1'),
  (null, 'bearbeitung', 1, 'simple', 'Dokument 2'),
  (null, 'bearbeitung', 2, 'dual',   'Dokument 3'),
  (null, 'bearbeitung', 3, 'simple', 'Dokument 4'),
  (null, 'bearbeitung', 4, 'simple', 'Dokument 5'),
  (null, 'visum',       0, 'simple', 'Dokument 1'),
  (null, 'visum',       1, 'simple', 'Dokument 2'),
  (null, 'visum',       2, 'simple', 'Dokument 3'),
  (null, 'visum',       3, 'dual',   'Dokument 4'),
  (null, 'visum',       4, 'simple', 'Dokument 5')
on conflict do nothing;

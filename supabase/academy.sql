-- ─────────────────────────────────────────────────────────────────────────────
-- ACADEMY — Phase-0 of the candidate journey (the German school).
--
-- North star: pass B2. Two business outcomes ride on this data model:
--   1. RETENTION (low churn) — gamification reads this (points / streak / level
--      / leaderboard / badges).
--   2. BEHAVIOR DOSSIER — the SAME data, read the other way, becomes a
--      per-candidate reliability index sold to employers at year-end.
--
-- ARCHITECTURAL SPINE: ONE append-only ledger `academy_point_events`. Every
-- meaningful action (attended a class, submitted a quiz on time, levelled up)
-- writes one immutable row. The candidate score, the weekly leaderboard, and
-- the employer reliability index are all just AGGREGATES of this ledger — never
-- a stored counter that can drift. Manual admin adjustments are also ledger
-- rows (type='manual_adjust', source_id NULL), so the history is complete and
-- auditable.
--
-- Decisions locked with founder (2026-05-28):
--   • blended teaching  → in-app lessons (academy_lessons) + live classes
--                         (academy_class_sessions).
--   • built-in quizzes  → academy_quizzes (questions jsonb) + academy_submissions.
--   • automated         → academy_attendance.source distinguishes 'auto'
--     attendance          (video-call / activity signal) vs 'admin' / 'self'.
--   • CEFR ladder       → cohort_members.current_level walks A1→A2→B1→B2.
--   • per-cohort weekly  → leaderboard = SUM(points) per candidate where
--     leaderboard          cohort_id = X and created_at >= start-of-week.
--
-- SECURITY: every table is RLS-ON with NO policy. Only the service-role key
-- (server API routes, after requireUser / requireAdminRole + LAW #25 scope)
-- ever touches these. A candidate's anon client can never read another
-- candidate's points, attendance, or submissions.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR BEFORE THE FEATURE GOES LIVE. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Cohorts ──────────────────────────────────────────────────────────────────
-- A group of students who start together. Scoped per-org or global (NULL),
-- exactly like phase_slots (LAW #34). target_level is the graduation goal (B2).
CREATE TABLE IF NOT EXISTS public.academy_cohorts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        REFERENCES public.organizations(id) ON DELETE SET NULL, -- NULL = Borivon/global
  name          TEXT        NOT NULL,
  target_level  TEXT        NOT NULL DEFAULT 'B2',
  starts_on     DATE,
  ends_on       DATE,                                   -- year-end → reliability ranking
  status        TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'archived')),
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_academy_cohorts_scope
  ON public.academy_cohorts (org_id, status);

-- ── Cohort membership ────────────────────────────────────────────────────────
-- candidate ↔ cohort. current_level is the candidate's CEFR rank (climbs the
-- ladder). One row per (cohort, candidate).
CREATE TABLE IF NOT EXISTS public.academy_cohort_members (
  cohort_id          UUID        NOT NULL REFERENCES public.academy_cohorts(id) ON DELETE CASCADE,
  candidate_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_level      TEXT        NOT NULL DEFAULT 'A1',
  status             TEXT        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'paused', 'dropped', 'graduated')),
  joined_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cohort_id, candidate_user_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_members_candidate
  ON public.academy_cohort_members (candidate_user_id);

-- ── Lessons (in-app curriculum content) ──────────────────────────────────────
-- The "blended" self-study half. Keyed by CEFR level + position so a level is
-- an ordered sequence. org_id NULL = shared Borivon curriculum.
CREATE TABLE IF NOT EXISTS public.academy_lessons (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
  level       TEXT        NOT NULL DEFAULT 'A1',         -- A1 | A2 | B1 | B2
  title       TEXT        NOT NULL DEFAULT '',
  body        JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- rich content blocks
  media_url   TEXT,                                      -- optional video / audio
  position    INT         NOT NULL DEFAULT 0,
  published   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_academy_lessons_level
  ON public.academy_lessons (level, position);

-- ── Live class sessions ──────────────────────────────────────────────────────
-- The "blended" live half. Belongs to a cohort. meeting_provider lets the
-- future automated-attendance job know which API to pull join/leave from.
CREATE TABLE IF NOT EXISTS public.academy_class_sessions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id         UUID        NOT NULL REFERENCES public.academy_cohorts(id) ON DELETE CASCADE,
  lesson_id         UUID        REFERENCES public.academy_lessons(id) ON DELETE SET NULL,
  title             TEXT        NOT NULL DEFAULT '',
  level             TEXT        NOT NULL DEFAULT 'A1',
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ,
  meeting_url       TEXT,
  meeting_provider  TEXT,                                -- 'zoom' | 'meet' | 'daily' | 'whereby' | ...
  external_ref      TEXT,                                -- provider meeting id (for auto-attendance match)
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_academy_sessions_cohort
  ON public.academy_class_sessions (cohort_id, starts_at);

-- ── Attendance (one row per candidate per session) ───────────────────────────
-- source = how it was recorded: 'auto' (video-call / activity signal),
-- 'admin' (teacher marked), 'self' (candidate check-in). minutes_present comes
-- from the automation when available.
CREATE TABLE IF NOT EXISTS public.academy_attendance (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID        NOT NULL REFERENCES public.academy_class_sessions(id) ON DELETE CASCADE,
  candidate_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status             TEXT        NOT NULL DEFAULT 'absent'
                                 CHECK (status IN ('present', 'late', 'absent', 'excused')),
  joined_at          TIMESTAMPTZ,
  left_at            TIMESTAMPTZ,
  minutes_present    INT,
  source             TEXT        NOT NULL DEFAULT 'auto'
                                 CHECK (source IN ('auto', 'admin', 'self')),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, candidate_user_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_attendance_candidate
  ON public.academy_attendance (candidate_user_id);

-- ── Quizzes / homework / mock exams (built-in engine) ────────────────────────
-- questions jsonb = [{ id, type:'single'|'multi'|'text', prompt, options:[],
-- correct:[], points }]. due_at drives the on-time bonus. cohort_id NULL =
-- curriculum-wide (any cohort at that level).
CREATE TABLE IF NOT EXISTS public.academy_quizzes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id     UUID        REFERENCES public.academy_cohorts(id) ON DELETE CASCADE,
  lesson_id     UUID        REFERENCES public.academy_lessons(id) ON DELETE SET NULL,
  level         TEXT        NOT NULL DEFAULT 'A1',
  title         TEXT        NOT NULL DEFAULT '',
  kind          TEXT        NOT NULL DEFAULT 'quiz'
                            CHECK (kind IN ('quiz', 'homework', 'mock_exam')),
  questions     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  pass_score    INT         NOT NULL DEFAULT 60,         -- percent needed to pass
  points_award  INT         NOT NULL DEFAULT 0,          -- base points for completing
  due_at        TIMESTAMPTZ,                             -- deadline → on-time bonus
  published     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_academy_quizzes_scope
  ON public.academy_quizzes (cohort_id, level, due_at);

-- ── Submissions (one per candidate per quiz) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_submissions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id            UUID        NOT NULL REFERENCES public.academy_quizzes(id) ON DELETE CASCADE,
  candidate_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answers            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  score              NUMERIC,                            -- percent 0–100
  passed             BOOLEAN,
  on_time            BOOLEAN,                            -- submitted_at <= quiz.due_at
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  graded_at          TIMESTAMPTZ,
  UNIQUE (quiz_id, candidate_user_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_submissions_candidate
  ON public.academy_submissions (candidate_user_id);

-- ── THE LEDGER — append-only point events ────────────────────────────────────
-- Every gamification + behavior signal is one immutable row here. points may be
-- negative (manual_adjust). cohort_id is snapshotted on the row so a candidate's
-- per-cohort weekly leaderboard stays correct even if cohort membership later
-- changes. meta jsonb carries the detail (minutes_present, score, level, ...).
--
-- IDEMPOTENCY: the unique index below means awarding the SAME real event twice
-- (same candidate + type + source row) is a no-op — re-running an attendance or
-- grading job never double-pays. Manual adjustments use source_id NULL; NULLs
-- are distinct in a unique index, so multiple manual rows always stack.
CREATE TABLE IF NOT EXISTS public.academy_point_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cohort_id          UUID        REFERENCES public.academy_cohorts(id) ON DELETE SET NULL,
  type               TEXT        NOT NULL,               -- 'attend_present' | 'quiz_ontime' | 'level_up' | 'manual_adjust' | ...
  points             INT         NOT NULL,
  source_kind        TEXT,                               -- 'session' | 'quiz' | 'lesson' | 'badge' | 'manual' | 'system'
  source_id          UUID,                               -- the session/quiz/lesson/badge id (NULL for manual/system)
  meta               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  note               TEXT,                               -- admin reason for manual_adjust
  created_by         TEXT        NOT NULL DEFAULT 'system',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_point_event
  ON public.academy_point_events (candidate_user_id, type, source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_academy_points_candidate
  ON public.academy_point_events (candidate_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_academy_points_cohort_week
  ON public.academy_point_events (cohort_id, created_at);

-- ── Badge catalog + earned badges ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_badges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT        NOT NULL UNIQUE,               -- stable code referenced in app
  name        TEXT        NOT NULL,
  description TEXT,
  icon        TEXT,                                      -- emoji or icon key
  points      INT         NOT NULL DEFAULT 0,            -- points granted on earning
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.academy_student_badges (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id           UUID        NOT NULL REFERENCES public.academy_badges(id) ON DELETE CASCADE,
  awarded_by         TEXT        NOT NULL DEFAULT 'system',
  awarded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (candidate_user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_student_badges_candidate
  ON public.academy_student_badges (candidate_user_id);

-- ── Starter badge catalog (idempotent) ───────────────────────────────────────
INSERT INTO public.academy_badges (key, name, description, icon, points) VALUES
  ('first_class',      'First Class',        'Attended your first live class.',                  '🎓', 10),
  ('perfect_week',     'Perfect Week',       'Present on time at every class for a full week.',  '🔥', 25),
  ('homework_hero',    'Homework Hero',      'Submitted 10 quizzes before the deadline.',        '⚡', 30),
  ('b1_cleared',       'B1 Cleared',         'Reached CEFR level B1.',                            '🥈', 50),
  ('b2_cleared',       'B2 Cleared',         'Reached CEFR level B2 — the goal.',                 '🏆', 100)
ON CONFLICT (key) DO NOTHING;

-- ── RLS: ON, no policies (service-role only) ─────────────────────────────────
ALTER TABLE public.academy_cohorts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_cohort_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lessons          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_class_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_attendance       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_quizzes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_submissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_point_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_badges           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_student_badges   ENABLE ROW LEVEL SECURITY;
-- (No policies on purpose — only the server / service-role touches these.)

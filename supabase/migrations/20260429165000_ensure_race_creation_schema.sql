ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS difficulty_level integer NOT NULL DEFAULT 1;

ALTER TABLE public.races
  DROP CONSTRAINT IF EXISTS races_difficulty_level_range;

ALTER TABLE public.races
  ADD CONSTRAINT races_difficulty_level_range
  CHECK (difficulty_level BETWEEN 1 AND 5);

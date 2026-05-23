-- Checkpoint photos table
CREATE TABLE IF NOT EXISTS public.checkpoint_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL,
  checkpoint_id uuid,
  uploaded_by uuid NOT NULL,
  storage_path text NOT NULL,
  caption text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_photos_race ON public.checkpoint_photos(race_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_photos_checkpoint ON public.checkpoint_photos(checkpoint_id);

ALTER TABLE public.checkpoint_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Photos viewable by everyone" ON public.checkpoint_photos;
CREATE POLICY "Photos viewable by everyone"
  ON public.checkpoint_photos FOR SELECT USING (true);

DROP POLICY IF EXISTS "Organizers manage their race photos" ON public.checkpoint_photos;
CREATE POLICY "Organizers manage their race photos"
  ON public.checkpoint_photos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.races r WHERE r.id = checkpoint_photos.race_id AND r.organizer_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.races r WHERE r.id = checkpoint_photos.race_id AND r.organizer_id = auth.uid()));

DROP POLICY IF EXISTS "Admins manage all photos" ON public.checkpoint_photos;
CREATE POLICY "Admins manage all photos"
  ON public.checkpoint_photos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO storage.buckets (id, name, public)
VALUES ('checkpoint-photos', 'checkpoint-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Checkpoint photos are public" ON storage.objects;
CREATE POLICY "Checkpoint photos are public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'checkpoint-photos');

DROP POLICY IF EXISTS "Organizers upload checkpoint photos" ON storage.objects;
CREATE POLICY "Organizers upload checkpoint photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'checkpoint-photos'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.races r
        WHERE r.organizer_id = auth.uid()
          AND r.id::text = split_part(name, '/', 1)
      )
    )
  );

DROP POLICY IF EXISTS "Organizers delete checkpoint photos" ON storage.objects;
CREATE POLICY "Organizers delete checkpoint photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'checkpoint-photos'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.races r
        WHERE r.organizer_id = auth.uid()
          AND r.id::text = split_part(name, '/', 1)
      )
    )
  );


-- The previous SELECT policy allowed listing all files in the bucket.
-- We keep public read access via direct URL (bucket is public),
-- but remove the broad listing policy.
DROP POLICY IF EXISTS "GPX files are publicly readable" ON storage.objects;

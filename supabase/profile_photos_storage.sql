-- One-time setup: Supabase Storage bucket for profile photos.
-- The bucket itself is created automatically by the API on first upload.
-- Run this in Supabase → SQL Editor to set up storage policies.

-- Allow authenticated users to upload/update/delete only their own file.
-- File name convention: {user_id}.{ext}  (jpg | png | webp)

-- Read: public (bucket is public — URLs are accessible without auth)
-- Write: only the file owner (name starts with their user_id)

-- 1. Anyone can read objects in the profile-photos bucket (public CDN access)
CREATE POLICY "profile_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-photos');

-- 2. Authenticated users can insert/update/delete their own photo file
CREATE POLICY "profile_photos_owner_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND auth.uid()::text = split_part(name, '.', 1)
  );

CREATE POLICY "profile_photos_owner_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'profile-photos'
    AND auth.uid()::text = split_part(name, '.', 1)
  );

CREATE POLICY "profile_photos_owner_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'profile-photos'
    AND auth.uid()::text = split_part(name, '.', 1)
  );

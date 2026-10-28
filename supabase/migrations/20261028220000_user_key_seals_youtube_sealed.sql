-- Seal v2 for the YouTube refresh token (was PLAINTEXT).
--
-- Each user sets a key passphrase in Settings. The browser derives a key from
-- it (PBKDF2-SHA256 600k + HKDF) and stores here only the seal: wrapped data
-- key, recovery wrap, key check and an ECDH public key. The OAuth callback seals
-- the refresh token to that public key ("v2:" values); only the user's unlock
-- (held in server memory with a TTL, max 7 days) opens it for auto go-live.
-- Service role only: RLS on, no policies.
CREATE TABLE IF NOT EXISTS public.user_key_seals (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  seal JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.user_key_seals ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.youtube_credentials.refresh_token IS
  'Sealed (v2:) to the user''s key; legacy plaintext rows are sealed when the user sets a key passphrase.';

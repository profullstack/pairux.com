-- Copilot own keys (BYOK) sealed to the owner (seal v2), no longer under the
-- server env key COPILOT_KEYS_SECRET.
--
-- copilot_settings.{anthropic,openai,elevenlabs}_key now hold "v2:" values
-- sealed to the owner's public key in user_key_seals (the same key passphrase
-- as the YouTube token). They open only while the owner has unlocked a
-- meeting's copilot (private key in server memory, TTL, dropped when the
-- copilot stops). Legacy "v1." values are re-sealed once in the owner's own
-- request and overwritten in place; LEGACY_KEY_MIGRATION=off ends that.
--
-- Unmigrated rows:
--   SELECT count(*) FROM copilot_settings
--   WHERE anthropic_key LIKE 'v1.%' OR openai_key LIKE 'v1.%' OR elevenlabs_key LIKE 'v1.%';
ALTER TABLE public.copilot_settings ADD COLUMN IF NOT EXISTS seal_version SMALLINT;

UPDATE public.copilot_settings SET seal_version = 1
WHERE seal_version IS NULL
  AND (anthropic_key LIKE 'v1.%' OR openai_key LIKE 'v1.%' OR elevenlabs_key LIKE 'v1.%');

COMMENT ON COLUMN public.copilot_settings.seal_version IS
  '2 = keys sealed to the owner (user_key_seals); 1 = legacy server-key ciphertext awaiting the owner''s passphrase.';
COMMENT ON COLUMN public.copilot_settings.anthropic_key IS 'Sealed (v2:) to the owner''s key; legacy v1. = old server key.';
COMMENT ON COLUMN public.copilot_settings.openai_key IS 'Sealed (v2:) to the owner''s key; legacy v1. = old server key.';
COMMENT ON COLUMN public.copilot_settings.elevenlabs_key IS 'Sealed (v2:) to the owner''s key; legacy v1. = old server key.';

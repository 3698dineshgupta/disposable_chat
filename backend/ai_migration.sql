-- ============================================================
-- ZapChat AI Auto-Reply Migration
-- Run in Supabase SQL Editor or via the migration script
-- ============================================================

-- Per-user, per-conversation AI settings
CREATE TABLE IF NOT EXISTS ai_conversation_settings (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  auto_reply_enabled boolean NOT NULL DEFAULT false,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (user_id, conversation_id)
);

-- Per-user writing style analysis profile
CREATE TABLE IF NOT EXISTS ai_writing_profiles (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  profile_data         jsonb NOT NULL DEFAULT '{}',
  sample_message_count integer DEFAULT 0,
  last_updated         timestamptz DEFAULT now()
);

-- Push notification subscriptions (for Web Push / PWA)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription jsonb NOT NULL,
  user_agent   text,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, (subscription->>'endpoint'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_settings_user_conv ON ai_conversation_settings(user_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_profiles_user      ON ai_writing_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_user        ON push_subscriptions(user_id);

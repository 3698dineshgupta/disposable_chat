-- ============================================================
-- WhatsApp-like Messaging Platform — Supabase PostgreSQL Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  username        TEXT UNIQUE NOT NULL,
  display_name    TEXT NOT NULL,
  password_hash   TEXT,
  avatar_url      TEXT,
  about           TEXT DEFAULT 'Hey there! I am using Zap Chat.',
  phone           TEXT,
  last_seen       TIMESTAMPTZ DEFAULT NOW(),
  is_online       BOOLEAN DEFAULT FALSE,
  public_key      TEXT,
  signing_public_key TEXT,
  google_id       TEXT UNIQUE,
  push_subscription JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- REFRESH TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
  name        TEXT,
  avatar_url  TEXT,
  description TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  invite_link TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONVERSATION PARTICIPANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  last_read_at    TIMESTAMPTZ DEFAULT NOW(),
  is_pinned       BOOLEAN DEFAULT FALSE,
  is_archived     BOOLEAN DEFAULT FALSE,
  is_muted        BOOLEAN DEFAULT FALSE,
  muted_until     TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

-- ============================================================
-- PENDING MESSAGES (temporary relay — deleted after delivery)
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  encrypted_payload JSONB NOT NULL,
  message_type      TEXT DEFAULT 'text' CHECK (message_type IN ('text','image','video','audio','voice','file','location','reply','sticker')),
  local_id          TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  expires_at        TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- ============================================================
-- CALLS
-- ============================================================
CREATE TABLE IF NOT EXISTS calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  caller_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('audio', 'video')),
  status          TEXT NOT NULL DEFAULT 'calling' CHECK (status IN ('calling','ringing','answered','rejected','missed','ended','failed')),
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  answered_at     TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  duration        INTEGER DEFAULT 0
);

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name  TEXT,
  is_blocked    BOOLEAN DEFAULT FALSE,
  is_favorite   BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, contact_id),
  CHECK (user_id <> contact_id)
);

-- ============================================================
-- STATUSES / STORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS statuses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('text', 'image', 'video')),
  content          TEXT,
  media_url        TEXT,
  background_color TEXT DEFAULT '#128C7E',
  font_style       TEXT DEFAULT 'normal',
  expires_at       TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_views (
  status_id   UUID NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  viewer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (status_id, viewer_id)
);

-- ============================================================
-- STARRED MESSAGES (local IDs for IndexedDB reference)
-- ============================================================
CREATE TABLE IF NOT EXISTS starred_messages (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_message_id TEXT NOT NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  starred_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, local_message_id)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_email          ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username       ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_google_id      ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_cp_user              ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_cp_conversation      ON conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_pm_recipient         ON pending_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_pm_conversation      ON pending_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_pm_expires           ON pending_messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_calls_caller         ON calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_calls_callee         ON calls(callee_id);
CREATE INDEX IF NOT EXISTS idx_statuses_user        ON statuses(user_id);
CREATE INDEX IF NOT EXISTS idx_statuses_expires     ON statuses(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user  ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_exp   ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_contacts_user        ON contacts(user_id);

-- ============================================================
-- AUTO-UPDATE TIMESTAMP TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_users_updated_at') THEN
    CREATE TRIGGER set_users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_conversations_updated_at') THEN
    CREATE TRIGGER set_conversations_updated_at BEFORE UPDATE ON conversations
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

-- ============================================================
-- CLEANUP FUNCTION (call via cron or pg_cron)
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_expired_data() RETURNS void AS $$
BEGIN
  DELETE FROM pending_messages WHERE expires_at < NOW();
  DELETE FROM statuses         WHERE expires_at < NOW();
  DELETE FROM refresh_tokens   WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

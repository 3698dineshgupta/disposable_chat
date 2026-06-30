const { Pool } = require('pg');
const { supabase } = require('../config/database');

async function runAIMigration() {
  if (!process.env.DATABASE_URL) return;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  // ── Storage bucket: set public=true via direct SQL ──────────────────────────
  // The Supabase JS client's updateBucket() silently fails when the bucket was
  // originally created as private. The postgres superuser can write storage.buckets
  // directly — this is authoritative and takes effect immediately.
  // (Symptom of broken state: uploads succeed but public URLs return 404.)
  try {
    await pool.query(`
      INSERT INTO storage.buckets (id, name, public, file_size_limit, created_at, updated_at)
      VALUES ('media', 'media', true, 52428800, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        public          = true,
        file_size_limit = 52428800,
        updated_at      = NOW()
    `);
    console.log('[Storage] media bucket: confirmed public via SQL.');
  } catch (err) {
    console.warn('[Storage] SQL bucket init skipped:', err.message);
    // Fall back to JS client (best-effort)
    try {
      const opts = { public: true, fileSizeLimit: 52428800 };
      const { error: cErr } = await supabase.storage.createBucket('media', opts);
      if (cErr) await supabase.storage.updateBucket('media', opts);
      console.log('[Storage] media bucket set via JS client (SQL fallback path).');
    } catch (e) {
      console.warn('[Storage] media bucket init failed entirely:', e.message);
    }
  }
  try {
    // pending_messages must exist before the server starts handling socket events.
    // Rows are inserted before every real-time emit (guaranteed delivery) and deleted
    // by message:seen / messages:acknowledge from the client.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_messages (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id  uuid NOT NULL,
        sender_id        uuid NOT NULL,
        recipient_id     uuid NOT NULL,
        encrypted_payload jsonb NOT NULL,
        message_type     text NOT NULL DEFAULT 'text',
        local_id         text,
        created_at       timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_pending_messages_recipient
        ON pending_messages (recipient_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_pending_messages_local_id
        ON pending_messages (local_id) WHERE local_id IS NOT NULL;
    `);
    console.log('[DB] pending_messages table verified/created.');
  } catch (err) {
    console.warn('[DB] pending_messages migration skipped:', err.message);
  }

  try {
    // Calls table — stores call history and is required by the call:initiate handler.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        caller_id        uuid NOT NULL,
        callee_id        uuid NOT NULL,
        type             text NOT NULL DEFAULT 'audio',
        status           text NOT NULL DEFAULT 'calling',
        conversation_id  uuid,
        answered_at      timestamptz,
        ended_at         timestamptz,
        duration         integer,
        created_at       timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls (caller_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls (callee_id, created_at);
    `);
    console.log('[DB] calls table verified/created.');
  } catch (err) {
    console.warn('[DB] calls table migration skipped:', err.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_conversation_settings (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        auto_reply_enabled boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, conversation_id)
      );

      CREATE TABLE IF NOT EXISTS ai_writing_profiles (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        profile_data jsonb NOT NULL DEFAULT '{}',
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subscription jsonb NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, (subscription->>'endpoint'))
      );
    `);
    console.log('[AI] AI tables verified/created.');
  } catch (err) {
    console.warn('[AI] Migration skipped:', err.message);
  } finally {
    await pool.end();
  }
}

module.exports = runAIMigration;

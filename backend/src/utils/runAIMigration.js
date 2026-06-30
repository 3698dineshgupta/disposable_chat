const { Pool } = require('pg');

async function runAIMigration() {
  if (!process.env.DATABASE_URL) return;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
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

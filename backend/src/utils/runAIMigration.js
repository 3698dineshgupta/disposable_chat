const { Pool } = require('pg');

/**
 * Creates the three tables required for the AI auto-reply feature.
 * Called once on server startup — fully idempotent (IF NOT EXISTS).
 */
async function runAIMigration() {
  if (!process.env.DATABASE_URL) return;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
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
    console.log('[AI] Tables verified/created.');
  } catch (err) {
    // Non-fatal: if the migration fails (e.g. tables already exist with constraints),
    // the server still starts but AI features will degrade gracefully.
    console.warn('[AI] Migration skipped:', err.message);
  } finally {
    await pool.end();
  }
}

module.exports = runAIMigration;

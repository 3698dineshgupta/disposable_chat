require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_REF = 'zusezuqgusoknahqprgq';

function httpPost(hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname, path: urlPath, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function migrate() {
  const schemaPath = path.join(__dirname, '../../schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error('❌ schema.sql not found at', schemaPath);
    process.exit(1);
  }

  const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
  if (!token) {
    console.error('❌ SUPABASE_MANAGEMENT_TOKEN not set in backend/.env');
    console.error('');
    console.error('  1. Go to https://supabase.com/dashboard/account/tokens');
    console.error('  2. Create a new access token');
    console.error('  3. Add to backend/.env:  SUPABASE_MANAGEMENT_TOKEN=sbp_xxxxxx');
    console.error('  4. Re-run:  npm run db:migrate');
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');
  console.log('🔄 Running migration via Supabase Management API…');

  const res = await httpPost(
    'api.supabase.com',
    `/v1/projects/${PROJECT_REF}/database/query`,
    { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    { query: sql }
  );

  if (res.status === 200 || res.status === 201) {
    console.log('✅ Database migration completed successfully!');
  } else {
    console.error(`❌ Migration failed (HTTP ${res.status}):`, res.body.slice(0, 600));
    process.exit(1);
  }
}

migrate().catch((err) => {
  console.error('❌ Unexpected error:', err.message);
  process.exit(1);
});

/**
 * E2E: login → create campaign → add leads → follow-up → run outreach → wait for sent → force follow-ups
 * Usage: node scripts/e2e-run-campaign-send-followup.js [lead_data_id ...]
 * Env: E2E_EMAIL, E2E_PASSWORD, BASE_URL (default http://localhost:3000)
 */
require('dotenv').config();

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const EMAIL = process.env.E2E_EMAIL || 'hamzaansari6060@gmail.com';
const PASS = process.env.E2E_PASSWORD || 'SecureP@ss1';

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json.message || res.statusText || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('1) Login...');
  const login = await api('POST', '/api/auth/login', null, { email: EMAIL, password: PASS });
  const token = login.data?.accessToken;
  if (!token) throw new Error('No accessToken in login response');

  let leadIds = process.argv.slice(2).filter(Boolean);
  if (leadIds.length === 0) {
    console.log('2) Fetching leads from pool (first 2 with email)...');
    const pool = await api('GET', '/api/leads?limit=10&page=1', token);
    const items = pool.data || [];
    leadIds = items
      .filter((l) => l.email)
      .slice(0, 2)
      .map((l) => String(l.id));
    if (leadIds.length === 0) {
      throw new Error('No leads with email in pool. Pass lead_data_id args.');
    }
    console.log('   Using lead IDs:', leadIds.join(', '));
  }

  console.log('3) Create manual active campaign...');
  const created = await api('POST', '/api/campaigns', token, {
    name: `E2E Test ${new Date().toISOString().slice(0, 16)}`,
    goal: 'Test outreach and immediate follow-up',
    target_zone: 'Test',
    call_to_action: 'Reply to schedule a call',
    run_mode: 'manual',
    status: 'active',
    target_leads: leadIds.length,
    lead_source: 'both',
    target_tone: 'Professional',
  });
  const campaignId = created.data?.campaign?.id || created.data?.id;
  if (!campaignId) throw new Error('No campaign id in create response');
  console.log('   Campaign:', campaignId);

  console.log('4) Create follow-up (waiting_days=0, plain text)...');
  await api('POST', `/api/campaigns/${campaignId}/follow-ups`, token, {
    name: 'Immediate follow-up',
    waiting_days: 0,
    body_template:
      'Subject: Quick follow-up\n\nHi {{firstName}},\n\nJust following up on my earlier note — would love to hear your thoughts.\n\nBest regards',
  });

  console.log('5) Bulk add leads...');
  await api('POST', `/api/campaigns/${campaignId}/leads/bulk`, token, {
    leads: leadIds.map((id) => ({ lead_data_id: id })),
  });

  console.log('6) Start manual run (background)...');
  const run = await api('POST', `/api/campaigns/${campaignId}/leads/run`, token, {});
  console.log('   ', run.message, run.data);

  console.log('7) Waiting for leads to reach sent (up to 3 min)...');
  let allSent = false;
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    const list = await api(
      'GET',
      `/api/campaigns/${campaignId}/leads?limit=20&page=1`,
      token
    );
    const leads = list.data || [];
    const statuses = leads.map((l) => `${l.id?.slice(0, 8)}…=${l.status}`);
    console.log(`   [${i + 1}]`, statuses.join(' | '));
    allSent = leads.length > 0 && leads.every((l) => l.status === 'sent' || l.status === 'skipped');
    const anyFailed = leads.some((l) => l.status === 'failed');
    if (allSent || anyFailed) break;
  }

  if (!allSent) {
    console.warn('   Not all leads sent yet — continuing with force follow-ups for sent leads.');
  }

  console.log('8) Force send follow-ups now...');
  const { execSync } = require('child_process');
  execSync(`node scripts/force-campaign-follow-ups.js ${campaignId}`, {
    stdio: 'inherit',
    cwd: require('path').join(__dirname, '..'),
  });

  console.log('\nDone. Campaign ID:', campaignId);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  throw err;
});

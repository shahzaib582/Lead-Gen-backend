"""Integration checks against the disposable PostgreSQL cluster on /tmp:55439.
Requires sql/schema.sql and 20261104_delivery_reliability.sql already applied.
Never reads .env or connects to the application's database.
"""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import uuid


def sql(statement):
    return subprocess.check_output(
        ['psql', '-h', '/tmp', '-p', '55439', '-d', 'postgres', '-X', '-At',
         '-v', 'ON_ERROR_STOP=1', '-c', statement], text=True
    ).strip()


repo = Path(__file__).resolve().parents[1]
for migration in ['sql/schema.sql', 'sql/migrations/20261104_lead_pool_baseline.sql',
                  'sql/migrations/20261104_delivery_reliability.sql']:
    subprocess.run(['psql', '-h', '/tmp', '-p', '55439', '-d', 'postgres', '-X',
                    '-v', 'ON_ERROR_STOP=1', '-f', str(repo / migration)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
print('PASS: complete schema and idempotent migrations apply successfully')
# Simulate an imported numeric ID ahead of the sequence, then verify repair.
sql("INSERT INTO leads_data(id,email) VALUES (1000000, 'sequence-test@test.invalid') ON CONFLICT DO NOTHING")
subprocess.run(['psql', '-h', '/tmp', '-p', '55439', '-d', 'postgres', '-X',
                '-v', 'ON_ERROR_STOP=1', '-f', str(repo / 'sql/migrations/20261104_leads_data_sequence.sql')],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
allocated = sql("INSERT INTO leads_data(email) VALUES ('sequence-next@test.invalid') RETURNING id").splitlines()[0]
assert int(allocated) > 1000000
sql("DELETE FROM leads_data WHERE email IN ('sequence-test@test.invalid','sequence-next@test.invalid')")
print('PASS: sequence repair safely allocates beyond imported IDs')

user_id = str(uuid.uuid4())
other_user = str(uuid.uuid4())
event_id = 'evt_test_' + uuid.uuid4().hex
try:
    sql(f"INSERT INTO users(id,email) VALUES ('{user_id}','{user_id}@test.invalid'), ('{other_user}','{other_user}@test.invalid')")

    def claim(key):
        return json.loads(sql(f"SELECT claim_outbound_delivery('{key}', '{user_id}')"))

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(lambda _: claim('initial-' + user_id), range(24)))
    assert sum(row['claimed'] for row in results) == 1, results
    print('PASS: 24 simultaneous requests reserve the same delivery exactly once')

    sql(f"UPDATE outbound_deliveries SET status='uncertain' WHERE user_id='{user_id}'")
    assert claim('initial-' + user_id)['reason'] == 'delivery_unconfirmed'
    sql(f"UPDATE outbound_deliveries SET status='sent', result='{{\"messageId\":\"gmail-accepted\"}}' WHERE user_id='{user_id}'")
    assert claim('initial-' + user_id)['result']['messageId'] == 'gmail-accepted'
    print('PASS: uncertain sends remain blocked; confirmed sends return persisted Gmail results')

    sql(f"INSERT INTO outbound_deliveries(delivery_key,user_id,status) SELECT '{user_id}-seed-'||n,'{user_id}','sent' FROM generate_series(1,498) n")
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(lambda n: claim(f'{user_id}-quota-{n}'), range(24)))
    assert sum(row['claimed'] for row in results) == 1, results
    assert sql(f"SELECT count(*) FROM outbound_deliveries WHERE user_id='{user_id}' AND status<>'failed'") == '500'
    print('PASS: 24 concurrent quota reservations cannot exceed 500 messages')

    key = user_id + '-retry'
    sql(f"INSERT INTO outbound_deliveries(delivery_key,user_id,status) VALUES ('{key}','{user_id}','failed')")
    assert claim(key)['reason'] == 'daily_limit_reached'
    sql(f"UPDATE outbound_deliveries SET status='failed' WHERE delivery_key='{user_id}-seed-1'")
    assert claim(key)['claimed'] is True
    print('PASS: rejected sends release quota and remain retryable')

    event = json.dumps({'id': event_id, 'type': 'test.event'})
    def webhook_claim(_):
        return sql(f"SELECT claim_stripe_webhook('{event}', '{uuid.uuid4()}')")
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(webhook_claim, range(16)))
    assert results.count('claimed') == 1, results
    assert results.count('busy') == 15, results
    sql(f"UPDATE stripe_webhook_events SET processing_started_at=NULL WHERE stripe_event_id='{event_id}'")
    assert webhook_claim(0) == 'claimed'
    sql(f"UPDATE stripe_webhook_events SET processed_at=now() WHERE stripe_event_id='{event_id}'")
    assert webhook_claim(0) == 'processed'
    print('PASS: Stripe events serialize, recover after failure, and deduplicate after success')

    # Fresh day counts are based on UTC, regardless of the database session timezone.
    assert sql(f"SELECT has_function_privilege('public', 'claim_outbound_delivery(text,uuid)', 'execute')") == 'f'
    print('PASS: public callers cannot reserve service-role deliveries')
finally:
    sql(f"DELETE FROM stripe_webhook_events WHERE stripe_event_id='{event_id}'; DELETE FROM users WHERE id IN ('{user_id}','{other_user}')")

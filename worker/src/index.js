import webpush from 'web-push';

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_PENDING_PER_DEVICE = 20;
const MAX_DUE_MS_IN_FUTURE = 90 * 24 * 60 * 60 * 1000; // 90 days
const MAX_DUE_MS_IN_PAST = 5 * 60 * 1000; // small clock-skew allowance
const MAX_COMMITMENT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // prune sent entries after a week
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_SECONDS = 300; // 5 minutes

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, env, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json' },
  });
}

// Best-effort fixed-window limiter (KV is eventually consistent, so this
// bounds abuse cheaply without accounts -- it isn't meant to be airtight).
async function checkRateLimit(env, deviceId) {
  const key = 'ratelimit:' + deviceId;
  const raw = await env.SHELLDON_KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= RATE_LIMIT_MAX_REQUESTS) return false;
  await env.SHELLDON_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: 'invalid JSON' }, env, 400);
      }
      if (!body || !DEVICE_ID_RE.test(body.deviceId)) {
        return json({ error: 'invalid deviceId' }, env, 400);
      }
      if (!(await checkRateLimit(env, body.deviceId))) {
        return json({ error: 'slow down' }, env, 429);
      }
      if (!body.subscription || !body.subscription.endpoint) {
        return json({ error: 'invalid subscription' }, env, 400);
      }
      await env.DB.prepare(
        `INSERT INTO devices (device_id, subscription) VALUES (?1, ?2)
         ON CONFLICT(device_id) DO UPDATE SET subscription = excluded.subscription`
      ).bind(body.deviceId, JSON.stringify(body.subscription)).run();
      return json({ ok: true }, env);
    }

    if (url.pathname === '/commitments' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: 'invalid JSON' }, env, 400);
      }
      if (!body || !DEVICE_ID_RE.test(body.deviceId)) {
        return json({ error: 'invalid deviceId' }, env, 400);
      }
      if (!(await checkRateLimit(env, body.deviceId))) {
        return json({ error: 'slow down' }, env, 429);
      }
      if (!body.id || !body.dueAt || !body.message) {
        return json({ error: 'id, dueAt, message required' }, env, 400);
      }
      const dueAt = Number(body.dueAt);
      const now = Date.now();
      if (!Number.isFinite(dueAt) || dueAt < now - MAX_DUE_MS_IN_PAST || dueAt > now + MAX_DUE_MS_IN_FUTURE) {
        return json({ error: 'dueAt out of range' }, env, 400);
      }

      const countRow = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM commitments WHERE device_id = ?1 AND sent = 0 AND id != ?2'
      ).bind(body.deviceId, body.id).first();
      if (countRow && countRow.n >= MAX_PENDING_PER_DEVICE) {
        return json({ error: 'too many pending commitments' }, env, 429);
      }

      await env.DB.prepare(
        `INSERT INTO commitments (device_id, id, message, due_at, sent, created_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)
         ON CONFLICT(device_id, id) DO UPDATE SET message = excluded.message, due_at = excluded.due_at, sent = 0`
      ).bind(body.deviceId, body.id, String(body.message).slice(0, 200), dueAt, now).run();
      return json({ ok: true }, env);
    }

    if (url.pathname.startsWith('/commitments/') && request.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const deviceId = url.searchParams.get('deviceId');
      if (!DEVICE_ID_RE.test(deviceId)) {
        return json({ error: 'invalid deviceId' }, env, 400);
      }
      if (!(await checkRateLimit(env, deviceId))) {
        return json({ error: 'slow down' }, env, 429);
      }
      await env.DB.prepare('DELETE FROM commitments WHERE device_id = ?1 AND id = ?2').bind(deviceId, id).run();
      return json({ ok: true }, env);
    }

    return json({ error: 'not found' }, env, 404);
  },

  async scheduled(event, env, ctx) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    const now = Date.now();

    // Indexed lookup: only rows actually due, not a scan of every device.
    const due = await env.DB.prepare(
      'SELECT device_id, id, message FROM commitments WHERE sent = 0 AND due_at <= ?1'
    ).bind(now).all();

    for (const row of due.results) {
      const deviceRow = await env.DB.prepare(
        'SELECT subscription FROM devices WHERE device_id = ?1'
      ).bind(row.device_id).first();

      if (deviceRow && deviceRow.subscription) {
        try {
          await webpush.sendNotification(
            JSON.parse(deviceRow.subscription),
            JSON.stringify({ title: 'Shelldon', body: row.message })
          );
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            // Subscription expired/revoked -- drop it so we stop retrying a dead endpoint.
            await env.DB.prepare('DELETE FROM devices WHERE device_id = ?1').bind(row.device_id).run();
          }
        }
      }

      await env.DB.prepare(
        'UPDATE commitments SET sent = 1 WHERE device_id = ?1 AND id = ?2'
      ).bind(row.device_id, row.id).run();
    }

    await env.DB.prepare('DELETE FROM commitments WHERE sent = 1 AND due_at < ?1')
      .bind(now - MAX_COMMITMENT_AGE_MS)
      .run();
  },
};

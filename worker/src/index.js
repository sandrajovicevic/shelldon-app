import webpush from 'web-push';

const MAX_COMMITMENT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // prune sent/stale entries after a week
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

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

function deviceKey(deviceId) {
  return 'device:' + deviceId;
}

async function loadDeviceState(env, deviceId) {
  const raw = await env.SHELLDON_KV.get(deviceKey(deviceId));
  return raw ? JSON.parse(raw) : { subscription: null, commitments: [] };
}

async function saveDeviceState(env, deviceId, state) {
  await env.SHELLDON_KV.put(deviceKey(deviceId), JSON.stringify(state));
}

async function forEachDeviceKey(env, fn) {
  let cursor;
  do {
    const page = await env.SHELLDON_KV.list({ prefix: 'device:', cursor });
    for (const key of page.keys) {
      await fn(key.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
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
      if (!body.subscription || !body.subscription.endpoint) {
        return json({ error: 'invalid subscription' }, env, 400);
      }
      const state = await loadDeviceState(env, body.deviceId);
      state.subscription = body.subscription;
      await saveDeviceState(env, body.deviceId, state);
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
      if (!body.id || !body.dueAt || !body.message) {
        return json({ error: 'id, dueAt, message required' }, env, 400);
      }
      const state = await loadDeviceState(env, body.deviceId);
      state.commitments = state.commitments.filter((c) => c.id !== body.id);
      state.commitments.push({
        id: body.id,
        message: String(body.message).slice(0, 200),
        dueAt: Number(body.dueAt),
        sent: false,
      });
      await saveDeviceState(env, body.deviceId, state);
      return json({ ok: true }, env);
    }

    if (url.pathname.startsWith('/commitments/') && request.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const deviceId = url.searchParams.get('deviceId');
      if (!DEVICE_ID_RE.test(deviceId)) {
        return json({ error: 'invalid deviceId' }, env, 400);
      }
      const state = await loadDeviceState(env, deviceId);
      state.commitments = state.commitments.filter((c) => c.id !== id);
      await saveDeviceState(env, deviceId, state);
      return json({ ok: true }, env);
    }

    return json({ error: 'not found' }, env, 404);
  },

  async scheduled(event, env, ctx) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    const now = Date.now();

    await forEachDeviceKey(env, async (key) => {
      const raw = await env.SHELLDON_KV.get(key);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (!state.subscription || !state.commitments || state.commitments.length === 0) return;

      let changed = false;
      for (const c of state.commitments) {
        if (c.sent || c.dueAt > now) continue;
        try {
          await webpush.sendNotification(
            state.subscription,
            JSON.stringify({ title: 'Shelldon', body: c.message })
          );
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            state.subscription = null;
          }
        }
        c.sent = true;
        changed = true;
      }

      state.commitments = state.commitments.filter(
        (c) => !c.sent || now - c.dueAt < MAX_COMMITMENT_AGE_MS
      );

      if (changed) await env.SHELLDON_KV.put(key, JSON.stringify(state));
    });
  },
};

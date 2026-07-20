import webpush from 'web-push';

const STATE_KEY = 'state';
const MAX_COMMITMENT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // prune sent/stale entries after a week

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

async function loadState(env) {
  const raw = await env.SHELLDON_KV.get(STATE_KEY);
  return raw ? JSON.parse(raw) : { subscription: null, commitments: [] };
}

async function saveState(env, state) {
  await env.SHELLDON_KV.put(STATE_KEY, JSON.stringify(state));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      let sub;
      try {
        sub = await request.json();
      } catch (e) {
        return json({ error: 'invalid JSON' }, env, 400);
      }
      if (!sub || !sub.endpoint) return json({ error: 'invalid subscription' }, env, 400);
      const state = await loadState(env);
      state.subscription = sub;
      await saveState(env, state);
      return json({ ok: true }, env);
    }

    if (url.pathname === '/commitments' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: 'invalid JSON' }, env, 400);
      }
      if (!body || !body.id || !body.dueAt || !body.message) {
        return json({ error: 'id, dueAt, message required' }, env, 400);
      }
      const state = await loadState(env);
      state.commitments = state.commitments.filter((c) => c.id !== body.id);
      state.commitments.push({
        id: body.id,
        message: String(body.message).slice(0, 200),
        dueAt: Number(body.dueAt),
        sent: false,
      });
      await saveState(env, state);
      return json({ ok: true }, env);
    }

    if (url.pathname.startsWith('/commitments/') && request.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const state = await loadState(env);
      state.commitments = state.commitments.filter((c) => c.id !== id);
      await saveState(env, state);
      return json({ ok: true }, env);
    }

    return json({ error: 'not found' }, env, 404);
  },

  async scheduled(event, env, ctx) {
    const state = await loadState(env);
    if (!state.subscription || state.commitments.length === 0) return;

    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

    const now = Date.now();
    let changed = false;

    for (const c of state.commitments) {
      if (c.sent || c.dueAt > now) continue;
      try {
        await webpush.sendNotification(
          state.subscription,
          JSON.stringify({ title: 'Shelldon', body: c.message })
        );
      } catch (err) {
        // Subscription likely expired/revoked; drop it so we stop retrying against a dead endpoint.
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

    if (changed) await saveState(env, state);
  },
};

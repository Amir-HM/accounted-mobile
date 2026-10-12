// Push relay for Accounted Mobile: "snap the receipt" right after a card payment.
//
// Accounted has no public "new bank transaction" webhook yet, so this Worker
// polls the server every few minutes with a read-only key (transactions:read)
// and sends an Expo push for each new outgoing payment, and for each new
// operation waiting for approval (read with pending_operations:read). Phones register their
// Expo push token by proving they hold a key that can read this company's
// transactions; the relay never stores the phone's key. Registrations expire
// after 30 days without a re-register (the app re-registers on launch).
//
// Bindings: KV `STATE`; vars SERVER, COMPANY_ID; secret ACCOUNTED_KEY.

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
const LOOKBACK_DAYS = 3;
const DEVICE_TTL_DAYS = 30; // the app re-registers on every launch; a phone gone quiet drops off
const MAX_DEVICES = 10;
const EXPO_BATCH = 100; // Expo rejects a whole request above 100 messages

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * All relay state in one KV value, written only when it changes:
 * { devices: [{ token, at, private, lang }], seen: [txId], seenOps: [opId], bootstrapped }.
 * Reads the older one-key-per-field layout once, on the first run after an upgrade.
 */
async function load(env) {
  const raw = await env.STATE.get('state');
  if (raw) return JSON.parse(raw);
  const legacy = JSON.parse((await env.STATE.get('tokens')) || '[]');
  return {
    devices: legacy.map((token) => ({ token, at: new Date().toISOString() })),
    seen: JSON.parse((await env.STATE.get('seen')) || '[]'),
    seenOps: JSON.parse((await env.STATE.get('seenOps')) || '[]'),
    bootstrapped: (await env.STATE.get('bootstrapped')) || null,
  };
}

async function save(env, before, state) {
  const next = JSON.stringify(state);
  if (next !== before) await env.STATE.put('state', next);
}

const fresh = (d) => Date.now() - new Date(d.at).getTime() < DEVICE_TTL_DAYS * 86400_000;

/**
 * The caller must hold a working key for this company that can read its
 * transactions: the same data the pushes carry.
 */
async function authorized(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer gnubok_sk_')) return false;
  const r = await fetch(`${env.SERVER}/api/v1/companies/${env.COMPANY_ID}/transactions?limit=1`, { headers: { authorization: auth } });
  return r.ok;
}

const money = (amount, currency) =>
  new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currency || 'SEK' }).format(amount);

/**
 * What the lock screen says, in the phone's language. The app sends `lang`
 * when it registers; a phone registered by an older build (no `lang`) had an
 * English app, so it keeps English.
 */
const TEXT = {
  en: {
    cardPayment: 'Card payment',
    snapTitle: 'Snap the receipt',
    snapPrivate: 'A card payment needs its receipt',
    approvalTitle: 'Waiting for your approval',
    approvalPrivate: 'Something is waiting for your approval',
  },
  sv: {
    cardPayment: 'Kortbetalning',
    snapTitle: 'Fota kvittot',
    snapPrivate: 'En kortbetalning behöver sitt kvitto',
    approvalTitle: 'Väntar på ditt godkännande',
    approvalPrivate: 'Något väntar på ditt godkännande',
  },
};
const textFor = (d) => (d.lang === 'sv' ? TEXT.sv : TEXT.en);

function tidy(s, fallback) {
  s = (s || '').trim();
  if (!s) return fallback;
  if (s === s.toUpperCase() && /[A-ZÅÄÖ]{3}/.test(s)) s = s.toLowerCase().replace(/(^|[\s*./-])([a-zåäö])/g, (_, p, c) => p + c.toUpperCase());
  return s;
}

/** Operations staged by Claude, agents or the receipt hunt that wait for a human. */
async function pendingOps(env) {
  const r = await fetch(`${env.SERVER}/api/extensions/ext/mcp-server/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.ACCOUNTED_KEY}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'gnubok_list_pending_operations', arguments: { status: 'pending', limit: 50 } } }),
  });
  if (!r.ok) return [];
  const body = await r.json().catch(() => null);
  const res = body?.result;
  const data = res?.structuredContent ?? (res?.content?.[0]?.text ? JSON.parse(res.content[0].text) : null);
  return data?.operations ?? [];
}

/** Every transaction in the lookback window, following the cursor (capped). */
async function recentTransactions(env) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10);
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ limit: '100', date_from: since, ...(cursor ? { cursor } : {}) });
    const r = await fetch(`${env.SERVER}/api/v1/companies/${env.COMPANY_ID}/transactions?${q}`, {
      headers: { authorization: `Bearer ${env.ACCOUNTED_KEY}` },
    });
    if (!r.ok) throw new Error(`transactions ${r.status}`);
    const body = await r.json();
    rows.push(...(body.data || []));
    cursor = body.meta?.next_cursor;
    if (!cursor) break;
  }
  return rows;
}

async function send(messages) {
  const dead = new Set();
  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const batch = messages.slice(i, i + EXPO_BATCH);
    const res = await fetch(EXPO_PUSH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch) });
    const out = await res.json().catch(() => ({}));
    (out.data || []).forEach((tk, j) => tk?.details?.error === 'DeviceNotRegistered' && dead.add(batch[j].to));
  }
  return dead;
}

async function poll(env) {
  const raw = await env.STATE.get('state');
  const state = await load(env);
  state.devices = state.devices.filter(fresh);

  const rows = await recentTransactions(env);
  const seen = new Set(state.seen);
  const newPayments = rows.filter((t) => t.amount < 0 && !seen.has(t.id));
  // Keep the seen-set bounded to what the lookback can return.
  state.seen = rows.map((t) => t.id);

  const ops = await pendingOps(env).catch(() => null);
  const seenOps = new Set(state.seenOps);
  const newOps = ops ? ops.filter((o) => !seenOps.has(o.id)) : [];
  if (ops) state.seenOps = ops.map((o) => o.id);

  if (!state.bootstrapped) {
    state.bootstrapped = new Date().toISOString();
    await save(env, raw, state);
    return { notified: 0, bootstrap: newPayments.length };
  }

  const devices = state.devices;
  if (devices.length && (newPayments.length || newOps.length)) {
    const messages = [
      ...newPayments.flatMap((t) =>
        devices.map((d) => ({
          to: d.token,
          title: textFor(d).snapTitle,
          // A phone that asked for privacy gets no merchant or amount on the lock screen.
          body: d.private
            ? textFor(d).snapPrivate
            : `${tidy(t.merchant_name || t.description, textFor(d).cardPayment)} · ${money(t.amount, t.currency)}`,
          data: { url: `/payment/${t.id}`, transactionId: t.id },
          categoryId: 'payment', // Scan receipt / Later buttons, registered by the app
          sound: 'default',
        })),
      ),
      ...newOps.flatMap((o) =>
        devices.map((d) => ({
          to: d.token,
          title: textFor(d).approvalTitle,
          body: d.private ? textFor(d).approvalPrivate : `${o.actor_label ? `${o.actor_label}: ` : ''}${o.title}`,
          data: { url: '/approvals', operationId: o.id },
          sound: 'default',
        })),
      ),
    ];
    const dead = await send(messages);
    if (dead.size) state.devices = state.devices.filter((d) => !dead.has(d.token));
  }
  await save(env, raw, state);
  return { notified: newPayments.length, approvals: newOps.length, devices: state.devices.length };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || !['/register', '/unregister'].includes(url.pathname)) return json({ error: 'not_found' }, 404);
    if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || '');
    if (!/^ExponentPushToken\[[^\]]+\]$/.test(token)) return json({ error: 'invalid_token' }, 400);
    const raw = await env.STATE.get('state');
    const state = await load(env);
    const others = state.devices.filter((d) => d.token !== token && fresh(d));
    state.devices =
      url.pathname === '/register'
        ? [...others, { token, at: new Date().toISOString(), private: body.private === true, lang: body.lang === 'sv' ? 'sv' : 'en' }].slice(-MAX_DEVICES) // newest kept
        : others;
    await save(env, raw, state);
    return json({ ok: true, devices: state.devices.length });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(poll(env).then((r) => console.log(JSON.stringify(r))));
  },
};

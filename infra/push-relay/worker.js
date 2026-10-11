// Push relay for Accounted Mobile: "snap the receipt" right after a card payment.
//
// Accounted has no public "new bank transaction" webhook yet, so this Worker
// polls the server every few minutes with a read-only key (transactions:read)
// and sends an Expo push for each new outgoing payment, and for each new
// operation waiting for approval (read with pending_operations:read). Phones register their
// Expo push token by proving they hold a key for the same company; the
// relay never stores the phone's key.
//
// Bindings: KV `STATE`; vars SERVER, COMPANY_ID; secret ACCOUNTED_KEY.

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
const LOOKBACK_DAYS = 3;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function tokens(env) {
  return JSON.parse((await env.STATE.get('tokens')) || '[]');
}

/** The caller must hold a working key for this company. */
async function authorized(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer gnubok_sk_')) return false;
  const r = await fetch(`${env.SERVER}/api/v1/companies`, { headers: { authorization: auth } });
  if (!r.ok) return false;
  const body = await r.json().catch(() => null);
  return !!body?.data?.some((c) => c.id === env.COMPANY_ID);
}

const money = (amount, currency) =>
  new Intl.NumberFormat('sv-SE', { style: 'currency', currency: currency || 'SEK' }).format(amount);

function tidy(s) {
  s = (s || '').trim();
  if (!s) return 'Card payment';
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

async function poll(env) {
  const list = await tokens(env);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10);
  const r = await fetch(`${env.SERVER}/api/v1/companies/${env.COMPANY_ID}/transactions?limit=100&date_from=${since}`, {
    headers: { authorization: `Bearer ${env.ACCOUNTED_KEY}` },
  });
  if (!r.ok) throw new Error(`transactions ${r.status}`);
  const rows = (await r.json()).data || [];
  const seen = new Set(JSON.parse((await env.STATE.get('seen')) || '[]'));
  const firstRun = !(await env.STATE.get('bootstrapped'));

  const fresh = rows.filter((t) => t.amount < 0 && !seen.has(t.id));
  fresh.forEach((t) => seen.add(t.id));
  // Keep the seen-set bounded to what the lookback can return.
  const keep = new Set(rows.map((t) => t.id));
  await env.STATE.put('seen', JSON.stringify([...seen].filter((id) => keep.has(id))));

  const ops = await pendingOps(env).catch(() => []);
  const seenOps = new Set(JSON.parse((await env.STATE.get('seenOps')) || '[]'));
  const freshOps = ops.filter((o) => !seenOps.has(o.id));
  await env.STATE.put('seenOps', JSON.stringify(ops.map((o) => o.id)));

  if (firstRun) {
    await env.STATE.put('bootstrapped', new Date().toISOString());
    return { notified: 0, bootstrap: fresh.length };
  }
  if ((!fresh.length && !freshOps.length) || !list.length) return { notified: 0 };

  const messages = [
    ...fresh.flatMap((t) =>
      list.map((to) => ({
        to,
        title: 'Snap the receipt',
        body: `${tidy(t.merchant_name || t.description)} · ${money(t.amount, t.currency)}`,
        data: { url: `/payment/${t.id}`, transactionId: t.id },
        categoryId: 'payment', // Scan receipt / Later buttons, registered by the app
        sound: 'default',
      })),
    ),
    ...freshOps.flatMap((o) =>
      list.map((to) => ({
        to,
        title: 'Waiting for your approval',
        body: `${o.actor_label ? `${o.actor_label}: ` : ''}${o.title}`,
        data: { url: '/approvals', operationId: o.id },
        sound: 'default',
      })),
    ),
  ];
  const res = await fetch(EXPO_PUSH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(messages) });
  const out = await res.json().catch(() => ({}));
  // Drop tokens Expo reports as gone.
  const dead = new Set();
  (out.data || []).forEach((tk, i) => tk?.details?.error === 'DeviceNotRegistered' && dead.add(messages[i].to));
  if (dead.size) await env.STATE.put('tokens', JSON.stringify(list.filter((t) => !dead.has(t))));
  return { notified: fresh.length, approvals: freshOps.length };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || !['/register', '/unregister'].includes(url.pathname)) return json({ error: 'not_found' }, 404);
    if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || '');
    if (!/^ExponentPushToken\[[^\]]+\]$/.test(token)) return json({ error: 'invalid_token' }, 400);
    const list = await tokens(env);
    const next = url.pathname === '/register' ? [...new Set([...list, token])] : list.filter((t) => t !== token);
    await env.STATE.put('tokens', JSON.stringify(next));
    return json({ ok: true, devices: next.length });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(poll(env).then((r) => console.log(JSON.stringify(r))));
  },
};

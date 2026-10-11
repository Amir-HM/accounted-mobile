// OAuth return hop for Accounted Mobile.
//
// Accounted's authorization server only accepts https redirect URIs that a
// user registers (Settings), not an app scheme. This Worker is that https
// URI: it forwards the authorization response to the app's own return URL,
// carried inside `state` by the app. Only app schemes are accepted as a
// target, and the code is useless without the PKCE verifier held by the app.
const ALLOWED_TARGETS = [/^accountedmobile:\/\//, /^exps?:\/\//];
const FORWARD = ['code', 'state', 'error', 'error_description'];

function decodeState(state) {
  const b64 = state.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/oauth/callback') return new Response('Not found', { status: 404 });

    let target = null;
    try {
      target = decodeState(url.searchParams.get('state') || '').r;
    } catch {}
    if (typeof target !== 'string' || !ALLOWED_TARGETS.some((re) => re.test(target))) {
      return new Response('Invalid return address', { status: 400 });
    }

    const out = new URL(target);
    for (const k of FORWARD) {
      const v = url.searchParams.get(k);
      if (v != null) out.searchParams.set(k, v);
    }
    return new Response(null, {
      status: 302,
      headers: { Location: out.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  },
};

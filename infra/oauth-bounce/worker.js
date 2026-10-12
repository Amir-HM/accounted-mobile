// OAuth return hop for Accounted Mobile.
//
// Accounted's authorization server only accepts https redirect URIs that a
// user registers (Settings), not an app scheme. This Worker is that https
// URI: it forwards the authorization response to the app's own return URL,
// carried inside `state` by the app.
//
// The target must be exactly the app's sign-in return address. PKCE does not
// protect a code sent somewhere else (whoever starts the flow holds the
// verifier), so this Worker must never forward to an address an attacker can
// choose: in particular not to Expo Go (exp://), which loads any project from
// any host. For development with Expo Go, list the exact dev server hosts in
// the EXPO_GO_HOSTS variable (comma-separated host:port); leave it unset in
// production.
//
// Bindings: optional plain-text EXPO_GO_HOSTS.

const APP_RETURN = /^accountedmobile:\/\/oauth\/?(\?|$)/;
const FORWARD = ['code', 'state', 'error', 'error_description'];

function decodeState(state) {
  const b64 = state.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
}

function allowed(target, env) {
  if (APP_RETURN.test(target)) return true;
  const hosts = String(env.EXPO_GO_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const m = target.match(/^exps?:\/\/([^/?#]+)\/--\/oauth\/?(\?|$)/);
  return !!m && hosts.includes(m[1]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/oauth/callback') return new Response('Not found', { status: 404 });

    let target = null;
    try {
      target = decodeState(url.searchParams.get('state') || '').r;
    } catch {}
    if (typeof target !== 'string' || !allowed(target, env)) {
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

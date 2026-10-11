import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

/**
 * "Sign in with Accounted": OAuth 2.1 authorization code + PKCE against the
 * server's own authorization server (the one its Claude connector uses).
 *
 * Accounted only redirects to https URIs a user has registered, so the
 * redirect_uri is a tiny https hop (infra/oauth-bounce) that forwards to this
 * app's return URL, which travels inside `state`. The access token is an
 * ordinary scoped API key that does not expire server-side.
 */
/** The https return hop this build uses (app.json → extra.oauthReturnHop); see infra/oauth-bounce. */
export const OAUTH_BOUNCE_URI = (Constants.expoConfig?.extra?.oauthReturnHop as string | undefined) ?? '';
export const APP_SCOPES = [
  'companies:read',
  'documents:read',
  'documents:write',
  'transactions:read',
  'transactions:write',
  'reports:read',
  'bookkeeping:write',
  'pending_operations:read',
  'pending_operations:approve',
];

type Metadata = { authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string };

const b64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bytesB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export class OAuthError extends Error {}

async function json<T>(res: Response, what: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    throw new OAuthError(body?.error_description ?? body?.error ?? `${what} failed (${res.status}).`);
  }
  return body as T;
}

/** Returns an API key for this server, or null if the user cancelled. */
export async function signInWithAccounted(serverUrl: string): Promise<string | null> {
  if (!OAUTH_BOUNCE_URI) throw new OAuthError('This build has no sign-in return address configured. Connect with an API key.');
  const meta = await fetch(`${serverUrl}/.well-known/oauth-authorization-server`)
    .then((r) => json<Metadata>(r, 'Discovery'))
    .catch(() => {
      throw new OAuthError('That address did not answer like an Accounted server.');
    });

  const reg = await fetch(meta.registration_endpoint ?? `${serverUrl}/api/mcp-oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Accounted Mobile',
      redirect_uris: [OAUTH_BOUNCE_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  });
  if (reg.status === 400) {
    throw new OAuthError(
      `This server has not enabled sign-in for the app yet. In Accounted on the web, register ${OAUTH_BOUNCE_URI} as an OAuth client, or connect with an API key.`,
    );
  }
  const { client_id } = await json<{ client_id: string }>(reg, 'Client registration');

  const verifier = b64url(bytesB64(Crypto.getRandomBytes(32)));
  const challenge = b64url(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }),
  );
  const nonce = b64url(bytesB64(Crypto.getRandomBytes(16)));
  const returnUrl = Linking.createURL('oauth');
  const state = b64url(btoa(JSON.stringify({ n: nonce, r: returnUrl })));

  const auth = new URL(meta.authorization_endpoint);
  auth.search = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: OAUTH_BOUNCE_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: APP_SCOPES.join(' '),
  }).toString();

  const result = await WebBrowser.openAuthSessionAsync(auth.toString(), returnUrl);
  if (result.type !== 'success') return null;

  const back = new URL(result.url);
  const err = back.searchParams.get('error');
  if (err) {
    if (err === 'access_denied') return null;
    throw new OAuthError(back.searchParams.get('error_description') ?? err);
  }
  if (back.searchParams.get('state') !== state) throw new OAuthError('The sign-in response did not match this request.');
  const code = back.searchParams.get('code');
  if (!code) throw new OAuthError('The server did not return a sign-in code.');

  const token = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: OAUTH_BOUNCE_URI,
      client_id,
      code_verifier: verifier,
    }).toString(),
  }).then((r) => json<{ access_token: string }>(r, 'Sign-in'));
  return token.access_token;
}

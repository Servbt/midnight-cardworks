import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createCustomerAuthFromEnv } from './customerAuth.js';
import { createAdminAuthFromEnv } from './adminAuth.js';

const issuer = 'https://shop.clerk.accounts.dev';
const party = 'https://shop.example.com';
const env = { NODE_ENV: 'production', CLERK_ISSUER_URL: issuer, CLERK_AUTHORIZED_PARTIES: party, CLERK_SECRET_KEY: 'sk_test_local', ADMIN_EMAILS: 'owner@example.com' };
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let attacker: Awaited<ReturnType<typeof generateKeyPair>>;
let email = ' Owner@Example.com ';
let verified = true;
let requests: string[];

async function token(overrides: Record<string, unknown> = {}, key?: CryptoKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, sub: 'user_owner', sid: 'sess_local', azp: party, iat: now, nbf: now - 1, exp: now + 60, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-key' }).sign(key ?? keys.privateKey);
}
beforeAll(async () => { keys = await generateKeyPair('RS256'); attacker = await generateKeyPair('RS256'); });
beforeEach(() => {
  email = ' Owner@Example.com ';
  verified = true;
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    requests.push(String(url));
    if (String(url) === issuer + '/.well-known/jwks.json') return new Response(JSON.stringify({ keys: [{ ...await exportJWK(keys.publicKey), kid: 'local-key', alg: 'RS256' }] }));
    if (String(url) === 'https://api.clerk.com/v1/users/user_owner') return new Response(JSON.stringify({ primary_email_address_id: 'primary', email_addresses: [{ id: 'primary', email_address: email, verification: { status: verified ? 'verified' : 'unverified' } }] }));
    throw new Error('Unexpected network destination: ' + url);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('Clerk session trust boundary', () => {
  it('accepts a signed session from the configured issuer and origin for customer and admin', async () => {
    const authorization = 'Bearer ' + await token();
    const customer = createCustomerAuthFromEnv(env);
    expect(await customer.authorize(authorization)).toEqual({ ok: true, email: 'owner@example.com' });
    expect(await createAdminAuthFromEnv(env, customer).authorize(authorization)).toEqual({ ok: true, email: 'owner@example.com' });
    expect(requests.filter((url) => url.endsWith('jwks.json'))).toHaveLength(1);
  });
  it('rejects an attacker-signed token claiming a known admin without fetching the attacker issuer', async () => {
    const authorization = 'Bearer ' + await token({ iss: 'https://attacker.example' }, attacker.privateKey);
    expect(await createAdminAuthFromEnv(env).authorize(authorization)).toMatchObject({ ok: false, status: 401 });
    expect(requests).toEqual([issuer + '/.well-known/jwks.json']);
  });
  it.each([
    ['wrong issuer', { iss: 'https://another.clerk.accounts.dev' }],
    ['wrong origin', { azp: 'https://attacker.example' }],
    ['missing origin', { azp: undefined }],
    ['expired', { exp: 1 }],
    ['not yet valid', { nbf: 9999999999 }],
    ['missing expiry', { exp: undefined }],
    ['missing session', { sid: undefined }],
    ['empty subject', { sub: '' }]
  ])('rejects %s claims even with a trusted signature', async (_name, claims) => {
    expect(await createCustomerAuthFromEnv(env).authorize('Bearer ' + await token(claims))).toMatchObject({ ok: false, status: 401 });
    expect(requests.some((url) => url.startsWith('https://api.clerk.com'))).toBe(false);
  });
  it('rejects a forged signature even when the issuer matches', async () => {
    expect(await createCustomerAuthFromEnv(env).authorize('Bearer ' + await token({}, attacker.privateKey))).toMatchObject({ ok: false, status: 401 });
  });
  it('requires a verified primary email and preserves the admin allowlist', async () => {
    const authorization = 'Bearer ' + await token();
    verified = false;
    expect(await createCustomerAuthFromEnv(env).authorize(authorization)).toMatchObject({ ok: false, status: 403 });
    verified = true;
    email = 'buyer@example.com';
    expect(await createCustomerAuthFromEnv(env).authorize(authorization)).toMatchObject({ ok: true });
    expect(await createAdminAuthFromEnv(env).authorize(authorization)).toMatchObject({ ok: false, status: 403 });
  });
  it.each([
    { CLERK_ISSUER_URL: '' }, { CLERK_SECRET_KEY: '' }, { CLERK_AUTHORIZED_PARTIES: '' },
    { CLERK_ISSUER_URL: 'https://trusted.example/path' }, { CLERK_AUTHORIZED_PARTIES: 'http://shop.example.com' }
  ])('fails closed with invalid configuration %j', async (override) => {
    expect(await createCustomerAuthFromEnv({ ...env, ...override }).authorize('Bearer ' + await token())).toMatchObject({ ok: false, status: 403 });
    expect(requests).toEqual([]);
  });
  it('uses APP_BASE_URL as the default authorized party', async () => {
    expect(await createCustomerAuthFromEnv({ ...env, CLERK_AUTHORIZED_PARTIES: undefined, APP_BASE_URL: party }).authorize('Bearer ' + await token())).toMatchObject({ ok: true });
  });
  it('rejects missing and malformed authorization', async () => {
    const auth = createCustomerAuthFromEnv(env);
    expect(await auth.authorize(undefined)).toMatchObject({ ok: false, status: 401 });
    expect(await auth.authorize('Bearer invalid')).toMatchObject({ ok: false, status: 401 });
  });
});

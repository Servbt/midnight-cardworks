import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { createAdminAuthFromEnv } from './adminAuth.js';
import { createCustomerAuthFromEnv } from './customerAuth.js';

const issuer = 'https://trusted.clerk.accounts.dev';
const attackerIssuer = 'https://attacker.example';
const env = { CLERK_ISSUER_URL: issuer, CLERK_SECRET_KEY: 'sk_test_synthetic', ADMIN_EMAILS: 'owner@example.test' };
let trusted: Awaited<ReturnType<typeof generateKeyPair>>;
let attacker: Awaited<ReturnType<typeof generateKeyPair>>;
const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  trusted = await generateKeyPair('RS256');
  attacker = await generateKeyPair('RS256');
});

beforeEach(async () => {
  const trustedJwk = { ...await exportJWK(trusted.publicKey), kid: 'test-key', alg: 'RS256' };
  const attackerJwk = { ...await exportJWK(attacker.publicKey), kid: 'test-key', alg: 'RS256' };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [trustedJwk] });
    if (url === `${attackerIssuer}/.well-known/jwks.json`) return Response.json({ keys: [attackerJwk] });
    if (url === 'https://api.clerk.com/v1/users/user_owner') return Response.json({
      primary_email_address_id: 'email_owner',
      email_addresses: [{ id: 'email_owner', email_address: 'OWNER@example.test' }]
    });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

async function token(claims: JWTPayload = {}, key = trusted.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, sub: 'user_owner', iat: now, exp: now + 60, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
}

describe.each([
  ['admin', createAdminAuthFromEnv],
  ['customer', createCustomerAuthFromEnv]
] as const)('%s session verification', (_role, createAuth) => {
  it('accepts a valid session using the configured issuer and keys', async () => {
    const auth = createAuth(env);
    expect(await auth.authorize(`Bearer ${await token()}`)).toEqual({ ok: true, email: 'owner@example.test' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an attacker-signed token without contacting its issuer or looking up its subject', async () => {
    const auth = createAuth(env);
    expect(await auth.authorize(`Bearer ${await token({ iss: attackerIssuer }, attacker.privateKey)}`))
      .toMatchObject({ ok: false, status: 401 });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([`${issuer}/.well-known/jwks.json`]);
  });

  it('rejects an incorrect issuer even if the signature is trusted', async () => {
    expect(await createAuth(env).authorize(`Bearer ${await token({ iss: attackerIssuer })}`))
      .toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an attacker key claiming the trusted issuer', async () => {
    expect(await createAuth(env).authorize(`Bearer ${await token({}, attacker.privateKey)}`))
      .toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { exp: 1 },
    { exp: undefined },
    { sub: undefined },
    { sub: '' },
    { iat: undefined },
    { nbf: Math.floor(Date.now() / 1000) + 3600 }
  ])('rejects invalid session claims %j', async (claims) => {
    expect(await createAuth(env).authorize(`Bearer ${await token(claims)}`)).toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '', 'not-a-url', 'http://clerk.example', 'https://user:password@clerk.example', 'https://clerk.example/path', 'https://clerk.example?query=1', 'https://clerk.example#fragment'])
    ('fails closed for missing or invalid configured issuer %s', async (configuredIssuer) => {
      expect(await createAuth({ ...env, CLERK_ISSUER_URL: configuredIssuer }).authorize(`Bearer ${await token()}`))
        .toMatchObject({ ok: false, status: 403 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

  it('rejects missing and malformed bearer tokens', async () => {
    const auth = createAuth(env);
    expect(await auth.authorize(undefined)).toMatchObject({ ok: false, status: 401 });
    expect(await auth.authorize('Bearer malformed')).toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it('continues to enforce the admin email allowlist after session verification', async () => {
  const auth = createAdminAuthFromEnv({ ...env, ADMIN_EMAILS: 'someone-else@example.test' });
  expect(await auth.authorize(`Bearer ${await token()}`)).toMatchObject({ ok: false, status: 403 });
});

import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

export type CustomerAuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string };

export type CustomerAuth = {
  authorize(authorization: string | undefined): Promise<CustomerAuthResult>;
};

function getBearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

async function fetchClerkUserEmail(userId: string, secretKey: string) {
  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${secretKey}` }
  });
  if (!response.ok) return undefined;
  const user = await response.json() as {
    primary_email_address_id?: string;
    email_addresses?: Array<{ id: string; email_address: string }>;
  };
  const primary = user.email_addresses?.find((email) => email.id === user.primary_email_address_id);
  return (primary?.email_address ?? user.email_addresses?.[0]?.email_address)?.toLowerCase();
}

function getJwksUrl(token: string) {
  const claims = decodeJwt(token);
  const issuer = typeof claims.iss === 'string' ? claims.iss : undefined;
  if (!issuer || !issuer.startsWith('https://')) return undefined;
  return new URL('/.well-known/jwks.json', issuer);
}

export function createCustomerAuthFromEnv(env: NodeJS.ProcessEnv = process.env): CustomerAuth {
  const secretKey = env.CLERK_SECRET_KEY;
  const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  return {
    async authorize(authorization) {
      const token = getBearerToken(authorization);
      if (!token) return { ok: false, status: 401, error: 'Customer sign-in required' };
      if (!secretKey) return { ok: false, status: 403, error: 'Customer accounts are not configured' };

      try {
        const jwksUrl = getJwksUrl(token);
        if (!jwksUrl) return { ok: false, status: 401, error: 'Invalid customer session' };
        const jwksKey = jwksUrl.toString();
        const jwks = jwksByIssuer.get(jwksKey) ?? createRemoteJWKSet(jwksUrl);
        jwksByIssuer.set(jwksKey, jwks);
        const { payload } = await jwtVerify(token, jwks);
        const userId = String(payload.sub ?? '');
        if (!userId) return { ok: false, status: 401, error: 'Invalid customer session' };

        const email = await fetchClerkUserEmail(userId, secretKey);
        if (!email) return { ok: false, status: 403, error: 'Customer account needs an email address' };
        return { ok: true, email };
      } catch {
        return { ok: false, status: 401, error: 'Invalid customer session' };
      }
    }
  };
}

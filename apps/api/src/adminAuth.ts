import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

export type AdminAuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string };

export type AdminAuth = {
  authorize(authorization: string | undefined): Promise<AdminAuthResult>;
};

function parseAdminEmails(value: string | undefined) {
  return new Set((value ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
}

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

export function createAdminAuthFromEnv(env: NodeJS.ProcessEnv = process.env): AdminAuth {
  const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);
  const secretKey = env.CLERK_SECRET_KEY;
  const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  return {
    async authorize(authorization) {
      const token = getBearerToken(authorization);
      if (!token) return { ok: false, status: 401, error: 'Admin sign-in required' };
      if (!secretKey || adminEmails.size === 0) return { ok: false, status: 403, error: 'Admin access is not configured' };

      try {
        const jwksUrl = getJwksUrl(token);
        if (!jwksUrl) return { ok: false, status: 401, error: 'Invalid admin session' };
        const jwksKey = jwksUrl.toString();
        const jwks = jwksByIssuer.get(jwksKey) ?? createRemoteJWKSet(jwksUrl);
        jwksByIssuer.set(jwksKey, jwks);
        const { payload } = await jwtVerify(token, jwks);
        const userId = String(payload.sub ?? '');
        if (!userId) return { ok: false, status: 401, error: 'Invalid admin session' };

        const email = await fetchClerkUserEmail(userId, secretKey);
        if (!email) return { ok: false, status: 403, error: 'Admin account needs an email address' };
        if (!adminEmails.has(email)) return { ok: false, status: 403, error: 'Admin access required' };
        return { ok: true, email };
      } catch {
        return { ok: false, status: 401, error: 'Invalid admin session' };
      }
    }
  };
}

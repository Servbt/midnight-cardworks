import { createRemoteJWKSet, jwtVerify } from 'jose';

export type SessionAuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string };
export type SessionAuth = { authorize(authorization: string | undefined): Promise<SessionAuthResult> };

function origin(value: string, allowHttp = false) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:'))) throw new Error('Invalid auth origin');
  return url.origin;
}

/** Trust configuration, never the issuer or key location supplied by an incoming token. */
export function createClerkSessionAuthFromEnv(env: NodeJS.ProcessEnv = process.env): SessionAuth {
  const secretKey = env.CLERK_SECRET_KEY;
  let configuration: { issuer: string; parties: Set<string>; jwks: ReturnType<typeof createRemoteJWKSet> } | undefined;
  try {
    const issuer = origin(env.CLERK_ISSUER_URL ?? '');
    const parties = new Set((env.CLERK_AUTHORIZED_PARTIES ?? env.APP_BASE_URL ?? '').split(',')
      .map((value) => origin(value.trim(), env.NODE_ENV !== 'production')));
    if (secretKey && parties.size) configuration = { issuer, parties, jwks: createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer)) };
  } catch { /* Missing or malformed configuration fails closed. */ }

  return {
    async authorize(authorization) {
      const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!token) return { ok: false, status: 401, error: 'Sign-in required' };
      if (!configuration) return { ok: false, status: 403, error: 'Accounts are not configured' };
      try {
        const { payload } = await jwtVerify(token, configuration.jwks, {
          issuer: configuration.issuer,
          algorithms: ['RS256'],
          requiredClaims: ['iss', 'sub', 'exp', 'iat', 'nbf', 'sid', 'azp']
        });
        if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.sid !== 'string' || !payload.sid ||
            typeof payload.azp !== 'string' || !configuration.parties.has(payload.azp)) {
          return { ok: false, status: 401, error: 'Invalid session' };
        }
        const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(payload.sub)}`, {
          headers: { authorization: `Bearer ${secretKey}` },
          signal: AbortSignal.timeout(5000),
          redirect: 'error'
        });
        if (!response.ok) return { ok: false, status: 401, error: 'Invalid session' };
        const user = await response.json() as {
          primary_email_address_id?: string;
          email_addresses?: Array<{ id: string; email_address: string; verification?: { status?: string } }>;
        };
        const primary = user.email_addresses?.find((email) => email.id === user.primary_email_address_id);
        if (primary?.verification?.status !== 'verified' || !primary.email_address?.trim()) {
          return { ok: false, status: 403, error: 'A verified primary email address is required' };
        }
        return { ok: true, email: primary.email_address.trim().toLowerCase() };
      } catch {
        return { ok: false, status: 401, error: 'Invalid session' };
      }
    }
  };
}

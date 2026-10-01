import { createRemoteJWKSet, jwtVerify } from 'jose';

// Trust deployment configuration only; token claims must never select a key server.
export function createClerkSessionVerifier(env: NodeJS.ProcessEnv) {
  const issuer = env.CLERK_ISSUER_URL?.trim();
  if (!issuer) return undefined;
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return undefined;

  const jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', url));
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat']
    });
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new Error('Invalid session subject');
    return payload.sub;
  };
}

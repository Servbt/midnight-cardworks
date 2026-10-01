import { createClerkSessionVerifier } from './clerkSession.js';

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

export function createCustomerAuthFromEnv(env: NodeJS.ProcessEnv = process.env): CustomerAuth {
  const secretKey = env.CLERK_SECRET_KEY;
  const verifySession = createClerkSessionVerifier(env);

  return {
    async authorize(authorization) {
      const token = getBearerToken(authorization);
      if (!token) return { ok: false, status: 401, error: 'Customer sign-in required' };
      if (!secretKey || !verifySession) return { ok: false, status: 403, error: 'Customer accounts are not configured' };

      try {
        const userId = await verifySession(token);

        const email = await fetchClerkUserEmail(userId, secretKey);
        if (!email) return { ok: false, status: 403, error: 'Customer account needs an email address' };
        return { ok: true, email };
      } catch {
        return { ok: false, status: 401, error: 'Invalid customer session' };
      }
    }
  };
}

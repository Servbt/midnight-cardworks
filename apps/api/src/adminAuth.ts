import { createClerkSessionAuthFromEnv, type SessionAuth, type SessionAuthResult } from './clerkAuth.js';

export type AdminAuthResult = SessionAuthResult;
export type AdminAuth = SessionAuth;
export function createAdminAuthFromEnv(env: NodeJS.ProcessEnv = process.env, sessionAuth = createClerkSessionAuthFromEnv(env)): AdminAuth {
  const adminEmails = new Set((env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
  return {
    async authorize(authorization) {
      const result = await sessionAuth.authorize(authorization);
      if (!result.ok) return result;
      if (!adminEmails.has(result.email)) return { ok: false, status: 403, error: 'Admin access required' };
      return result;
    }
  };
}

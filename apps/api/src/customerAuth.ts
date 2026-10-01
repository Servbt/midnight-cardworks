import { createClerkSessionAuthFromEnv, type SessionAuth, type SessionAuthResult } from './clerkAuth.js';

export type CustomerAuthResult = SessionAuthResult;
export type CustomerAuth = SessionAuth;
export function createCustomerAuthFromEnv(env: NodeJS.ProcessEnv = process.env): CustomerAuth {
  return createClerkSessionAuthFromEnv(env);
}

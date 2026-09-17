/** Validate only essential runtime services; optional email, marketing and uploads remain optional. */
export function isConfigured(value: string | undefined) {
  return Boolean(value?.trim() && !/replace_me|placeholder|your-domain\.com|your-instance/i.test(value));
}
export function stripeSecret(env: NodeJS.ProcessEnv = process.env) {
  const value = env.STRIPE_SECRET_KEY?.trim();
  if (env.NODE_ENV === 'production' && (!isConfigured(value) || !/^sk_(test|live)_.+/.test(value!))) {
    throw new Error('STRIPE_SECRET_KEY is required in production');
  }
  return isConfigured(value) ? value : undefined;
}
export function assertProductionDatabase(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'production') return;
  try {
    if (!isConfigured(env.DATABASE_URL)) throw new Error();
    const url = new URL(env.DATABASE_URL!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length <= 1) throw new Error();
  } catch { throw new Error('DATABASE_URL must be a PostgreSQL connection URL in production'); }
}
function httpsOrigin(value: string | undefined) {
  if (!isConfigured(value)) return false;
  try {
    const url = new URL(value!);
    return url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const invalid: string[] = [];
  try { assertProductionDatabase(env); } catch { invalid.push('DATABASE_URL'); }
  try { stripeSecret(env); } catch { invalid.push('STRIPE_SECRET_KEY'); }
  if (!isConfigured(env.STRIPE_WEBHOOK_SECRET) || !/^whsec_.+/.test(env.STRIPE_WEBHOOK_SECRET!)) invalid.push('STRIPE_WEBHOOK_SECRET');
  if (!httpsOrigin(env.APP_BASE_URL)) invalid.push('APP_BASE_URL');
  if (!httpsOrigin(env.CLERK_ISSUER_URL)) invalid.push('CLERK_ISSUER_URL');
  if (!isConfigured(env.CLERK_SECRET_KEY) || !/^sk_(test|live)_.+/.test(env.CLERK_SECRET_KEY!)) invalid.push('CLERK_SECRET_KEY');
  const parties = (env.CLERK_AUTHORIZED_PARTIES ?? env.APP_BASE_URL ?? '').split(',');
  if (!parties.every((entry) => httpsOrigin(entry.trim()))) invalid.push('CLERK_AUTHORIZED_PARTIES');
  const admins = (env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim());
  if (!admins.length || !admins.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) invalid.push('ADMIN_EMAILS');
  if (invalid.length) throw new Error('Production configuration missing or invalid: ' + invalid.join(', '));
}

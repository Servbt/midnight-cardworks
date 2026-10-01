const strict = process.argv.includes('--strict');

const required = [
  'NODE_ENV',
  'SERVE_STATIC_ROOT',
  'DATABASE_URL',
  'APP_BASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'VITE_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_ISSUER_URL',
  'ADMIN_EMAILS',
  'VITE_ADMIN_EMAILS',
  'CLOUDINARY_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'ORDER_NOTIFICATION_EMAIL',
  'NEWSLETTER_COUPON_CODE',
  'MARKETING_POSTAL_ADDRESS'
];

const optional = ['CLERK_AUTHORIZED_PARTIES', 'VITE_PLAUSIBLE_DOMAIN', 'VITE_PLAUSIBLE_SRC'];
const placeholderPatterns = [
  /replace_me/i,
  /your-domain\.com/i,
  /owner@example\.com/i,
  /user:\*{3}@localhost/i,
  /^your business mailing address$/i
];

const present = (name) => typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
const value = (name) => process.env[name]?.trim() ?? '';
const emailList = (name) => value(name).split(',').map((email) => email.trim().toLowerCase()).filter(Boolean).sort();

const missing = required.filter((name) => !present(name));
const invalid = required.filter((name) => present(name) && placeholderPatterns.some((pattern) => pattern.test(value(name))));
const warnings = [];

if (present('NODE_ENV') && value('NODE_ENV') !== 'production') {
  invalid.push('NODE_ENV (must be production)');
}

if (present('SERVE_STATIC_ROOT') && value('SERVE_STATIC_ROOT') !== 'apps/web/dist') {
  invalid.push('SERVE_STATIC_ROOT (must be apps/web/dist)');
}

if (present('APP_BASE_URL')) {
  try {
    const appUrl = new URL(value('APP_BASE_URL'));
    if (appUrl.protocol !== 'https:') invalid.push('APP_BASE_URL (must use HTTPS)');
    if (appUrl.hostname.endsWith('.onrender.com')) warnings.push('APP_BASE_URL still uses the temporary Render hostname');
  } catch {
    invalid.push('APP_BASE_URL (must be a valid URL)');
  }
}

for (const name of ['CLERK_ISSUER_URL', 'CLERK_AUTHORIZED_PARTIES']) {
  if (!present(name)) continue;
  try {
    for (const entry of value(name).split(',')) {
      const url = new URL(entry.trim());
      if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
        throw new Error('Invalid origin');
      }
    }
  } catch {
    invalid.push(name + ' (must contain HTTPS origins without paths or credentials)');
  }
}

if (present('DATABASE_URL')) {
  try {
    const databaseUrl = new URL(value('DATABASE_URL'));
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) invalid.push('DATABASE_URL (must be PostgreSQL)');
  } catch {
    invalid.push('DATABASE_URL (must be a valid URL)');
  }
}

if (present('STRIPE_WEBHOOK_SECRET') && !value('STRIPE_WEBHOOK_SECRET').startsWith('whsec_')) {
  invalid.push('STRIPE_WEBHOOK_SECRET (unrecognized secret prefix)');
}

if (present('CLOUDINARY_URL') && !value('CLOUDINARY_URL').startsWith('cloudinary://')) {
  invalid.push('CLOUDINARY_URL (must use cloudinary://)');
}

if (present('RESEND_API_KEY') && !value('RESEND_API_KEY').startsWith('re_')) {
  invalid.push('RESEND_API_KEY (unrecognized key prefix)');
}

if (value('STRIPE_SECRET_KEY').startsWith('sk_test_')) {
  warnings.push('STRIPE_SECRET_KEY is in Stripe test mode');
} else if (present('STRIPE_SECRET_KEY') && !value('STRIPE_SECRET_KEY').startsWith('sk_live_')) {
  invalid.push('STRIPE_SECRET_KEY (unrecognized key prefix)');
}

if (value('CLERK_SECRET_KEY').startsWith('sk_test_')) {
  warnings.push('CLERK_SECRET_KEY is a Clerk test key');
} else if (present('CLERK_SECRET_KEY') && !value('CLERK_SECRET_KEY').startsWith('sk_live_')) {
  invalid.push('CLERK_SECRET_KEY (unrecognized key prefix)');
}

if (value('VITE_CLERK_PUBLISHABLE_KEY').startsWith('pk_test_')) {
  warnings.push('VITE_CLERK_PUBLISHABLE_KEY is a Clerk test key');
} else if (present('VITE_CLERK_PUBLISHABLE_KEY') && !value('VITE_CLERK_PUBLISHABLE_KEY').startsWith('pk_live_')) {
  invalid.push('VITE_CLERK_PUBLISHABLE_KEY (unrecognized key prefix)');
}

if (present('ADMIN_EMAILS') && present('VITE_ADMIN_EMAILS')) {
  const backendAdmins = emailList('ADMIN_EMAILS');
  const frontendAdmins = emailList('VITE_ADMIN_EMAILS');
  if (JSON.stringify(backendAdmins) !== JSON.stringify(frontendAdmins)) {
    invalid.push('ADMIN_EMAILS (does not match VITE_ADMIN_EMAILS)');
    invalid.push('VITE_ADMIN_EMAILS (does not match ADMIN_EMAILS)');
  }
}

if (present('VITE_API_BASE_URL')) {
  warnings.push('VITE_API_BASE_URL is not blank; production normally uses same-origin API requests');
}

if (present('VITE_PLAUSIBLE_DOMAIN') && present('APP_BASE_URL')) {
  try {
    if (value('VITE_PLAUSIBLE_DOMAIN') !== new URL(value('APP_BASE_URL')).hostname) {
      warnings.push('VITE_PLAUSIBLE_DOMAIN does not match the APP_BASE_URL hostname');
    }
  } catch {
    // APP_BASE_URL is reported separately.
  }
}

console.log('Midnight Cardworks production environment audit');
console.log('Secret values are intentionally hidden.\n');

for (const name of required) {
  const status = missing.includes(name) ? 'MISSING' : invalid.some((entry) => entry === name || entry.startsWith(`${name} (`)) ? 'INVALID' : 'OK';
  console.log(`[${status}] ${name}`);
}

const apiStatus = present('VITE_API_BASE_URL') ? 'WARN' : 'OK';
console.log(`[${apiStatus}] VITE_API_BASE_URL (blank means same-origin)`);

for (const name of optional) {
  console.log(`[${present(name) ? 'OK' : 'OPTIONAL'}] ${name}`);
}

for (const warning of warnings) console.log(`[WARN] ${warning}`);

const uniqueInvalid = [...new Set(invalid)];
console.log(`\nSummary: ${missing.length} missing, ${uniqueInvalid.length} invalid, ${warnings.length} warning(s).`);

if (missing.length || uniqueInvalid.length || (strict && warnings.length)) process.exitCode = 1;

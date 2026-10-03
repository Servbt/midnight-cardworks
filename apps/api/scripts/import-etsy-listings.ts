/**
 * Import an Etsy listings export into the Midnight Cardworks product catalogue.
 *
 *   npx tsx scripts/import-etsy-listings.ts --csv "/path/to/EtsyListingsDownload.csv"
 *   npx tsx scripts/import-etsy-listings.ts --csv "..." --apply [--retire-placeholders]
 *
 * Add --dump <file.csv> to write every mapped product out for review without writing to the DB.
 *
 * Dry run by default: every row is mapped and validated and the result is printed,
 * but nothing is written. Pass --apply to upsert for real.
 *
 * --apply needs DATABASE_URL. If CLOUDINARY_URL is also set, each listing's first Etsy
 * photo is uploaded to Cloudinary and that URL is stored; otherwise the Etsy CDN URL is
 * stored directly (it works, but it is someone else's CDN).
 *
 * The mapping helpers below are exported and side-effect free so they can be unit tested;
 * everything that touches the filesystem, argv or a database lives inside main().
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export type Row = Record<string, string>;

// The Product model has a single `image` column and no variant support, so one Etsy
// listing becomes exactly one product. These two facts drive most of what follows.
export type Product = {
  id: string;
  slug: string;
  title: string;
  description: string;
  price: number;          // cents
  saleActive: boolean;
  salePrice: number | null;
  category: string;
  tags: string[];
  image: string;
  inventory: number;
  active: boolean;
  featured: boolean;
};

// --- minimal RFC4180 CSV reader (Etsy descriptions contain commas and newlines) --------
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// --- mapping helpers -------------------------------------------------------------------
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(title: string): string {
  const head = title.split('|')[0].split(' - ')[0];
  const s = head.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  return (s || 'listing').slice(0, 60).replace(/-+$/, '');
}

export function inspiration(title: string): string {
  const m = title.match(/([A-Za-z0-9'’.\s]+?)\s+In(?:spi|pis)red/i);
  if (m) return m[1].trim();
  if (/tloz|zelda|majora/i.test(title)) return 'The Legend of Zelda';
  return '';
}

export function categorize(title: string): string {
  const t = title.toLowerCase();
  if (/token/.test(t)) return 'Tokens';
  if (/commission|custom mtg/.test(t)) return 'Custom';
  if (/dual land|land|island|forest|swamp|plains|mountain|bayou|tundra|taiga|plateau|scrubland|badlands|savannah/.test(t))
    return 'Lands';
  if (/set\b/.test(t)) return 'Sets';
  return 'Proxies';
}

// Naive de-pluralising turned "Proxies" into "proxie", so the singular forms are explicit.
export const CATEGORY_TAG: Record<string, string> = {
  Proxies: 'proxy card',
  Lands: 'land card',
  Tokens: 'token',
  Sets: 'card set',
  Custom: 'commission',
};

/**
 * Etsy ships one shared description on every listing, so copying it verbatim would give
 * the site 100+ near-identical pages. The facts in it are real, so they are kept and
 * phrased per product instead of repeated wholesale.
 */
export function shortName(title: string): string {
  return title.split('|')[0].split(' - ')[0].trim();
}

export function describe(title: string, source: string, tags: string[]): string {
  const parts = [
    `${shortName(title)} is a custom proxy piece printed on smooth S33 black-core cardstock, made to order in small batches.`,
    source ? `Artwork theme: ${source}.` : '',
    'Designed and drawn in-house with AI and Photoshop assistance, then printed and checked by hand before it ships.',
    'Unofficial and not intended for sanctioned play — built for casual tables, display binders and gifts. Not affiliated with or endorsed by Wizards of the Coast.',
    'Orders of $15 and over include a free random card.',
  ].filter(Boolean);
  const tagline = tags.slice(0, 4).join(', ');
  return tagline ? `${parts.join(' ')} Filed under ${tagline}.` : parts.join(' ');
}

export function toProduct(row: Row, taken: Set<string>): Product {
  const title = row.TITLE;
  let slug = slugify(title);
  let n = 2;
  while (taken.has(slug)) { slug = `${slugify(title)}-${n}`; n += 1; }
  taken.add(slug);

  const category = categorize(title);
  let tags = (row.TAGS ?? '')
    .split(',')
    .map((t) => t.trim().replace(/_/g, ' '))
    .filter(Boolean);
  // Six listings in the export carry no tags at all. Left empty they would be invisible to
  // storefront search, so they borrow the vocabulary the rest of the catalogue already uses.
  if (tags.length === 0) {
    tags = ['custom proxy card', CATEGORY_TAG[category] ?? 'proxy card', 'unofficial proxy'];
  }

  const price = Math.round(Number.parseFloat(row.PRICE || '0') * 100);
  const source = inspiration(title);

  return {
    id: `prod_${slug}`,
    slug,
    title,
    description: describe(title, source, tags),
    price,
    saleActive: false,
    salePrice: null,
    category,
    tags,
    image: (row.IMAGE1 ?? '').trim(),
    inventory: Number.parseInt(row.QUANTITY || '0', 10),
    active: true,
    featured: false,
  };
}

/** Mirrors the API's own productSchema so an import can never write something it would reject. */
export function validate(p: Product): string[] {
  const errs: string[] = [];
  if (!SLUG_RE.test(p.slug)) errs.push(`slug "${p.slug}" fails ^[a-z0-9]+(?:-[a-z0-9]+)*$`);
  if (!p.title) errs.push('title empty');
  if (!p.description) errs.push('description empty');
  if (!Number.isInteger(p.price) || p.price < 0) errs.push(`price ${p.price} not a non-negative int`);
  if (!p.category) errs.push('category empty');
  if (!p.image) errs.push('image empty');
  if (!Number.isInteger(p.inventory) || p.inventory < 0) errs.push(`inventory ${p.inventory} invalid`);
  if (p.saleActive && (!p.salePrice || p.salePrice >= p.price)) errs.push('sale price must be below price');
  return errs;
}

// The four products that ship in the seed data are placeholders with Unsplash stand-ins,
// plus one live test listing ("Test Cardd") left over from earlier work. They are retired
// when --retire-placeholders is passed alongside --apply.
//
// Soft-retire (active=false) rather than delete, deliberately: OrderItem has a foreign key
// to Product, so deleting a product that appears on any past order would either fail or
// destroy order history. Deactivating takes it off the storefront, the nav and the sidebar
// while leaving history intact.
export const PLACEHOLDER_SLUGS = [
  'golden-hour-commander-proxy',
  'midnight-token-pack',
  'velvet-archive-display-card',
  'social-link-land-set',
];
export const TEST_LISTING_SLUGS = ['great'];

const USAGE = 'usage: npx tsx scripts/import-etsy-listings.ts --csv <path> [--apply] [--retire-placeholders] [--dump <out.csv>]';

// --- main ------------------------------------------------------------------------------
/** Returns the process exit code. Nothing here runs on import, so tests can exercise the mappers. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const csvPath = argv[argv.indexOf('--csv') + 1];
  const apply = argv.includes('--apply');
  if (!csvPath || csvPath.startsWith('--')) {
    console.error(USAGE);
    return 2;
  }

  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const taken = new Set<string>();
  const products = rows.map((r) => toProduct(r, taken));

  const bad = products.map((p, i) => ({ i, errs: validate(p) })).filter((x) => x.errs.length);
  console.log(`parsed ${rows.length} rows -> ${products.length} products`);
  console.log(`slug/validation failures: ${bad.length}`);
  for (const b of bad.slice(0, 10)) console.log(`  row ${b.i + 1}: ${b.errs.join('; ')}`);

  const byCat = products.reduce<Record<string, number>>((a, p) => ({ ...a, [p.category]: (a[p.category] ?? 0) + 1 }), {});
  console.log(`categories: ${JSON.stringify(byCat)}`);
  console.log(`price points: ${JSON.stringify(products.reduce<Record<string, number>>((a, p) => ({ ...a, [p.price]: (a[p.price] ?? 0) + 1 }), {}))}`);
  console.log(`total units: ${products.reduce((s, p) => s + p.inventory, 0)}`);
  console.log(`missing image: ${products.filter((p) => !p.image).length}`);

  console.log('\n--- first 3 mapped ---');
  for (const p of products.slice(0, 3)) {
    console.log(JSON.stringify({ ...p, description: p.description.slice(0, 96) + '…', image: p.image.slice(0, 52) + '…' }, null, 1));
  }

  if (argv.includes('--retire-placeholders')) {
    console.log(`\nwould retire (active=false): ${[...PLACEHOLDER_SLUGS, ...TEST_LISTING_SLUGS].join(', ')}`);
  }

  // Review the mapping in a spreadsheet before letting it near the database.
  const dumpIdx = argv.indexOf('--dump');
  if (dumpIdx !== -1 && argv[dumpIdx + 1] && !argv[dumpIdx + 1].startsWith('--')) {
    const out = argv[dumpIdx + 1];
    const cols = ['slug', 'title', 'category', 'price', 'inventory', 'active', 'tags', 'image', 'description'];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [cols.join(',')];
    for (const p of products) {
      const rec: Record<string, string> = {
        slug: p.slug, title: p.title, category: p.category, price: (p.price / 100).toFixed(2),
        inventory: String(p.inventory), active: String(p.active), tags: p.tags.join('; '),
        image: p.image, description: p.description,
      };
      lines.push(cols.map((c) => esc(rec[c] ?? '')).join(','));
    }
    writeFileSync(out, lines.join('\n'));
    console.log(`wrote ${products.length} mapped products to ${out}`);
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply (and DATABASE_URL set) to upsert.');
    return bad.length ? 1 : 0;
  }

  if (!process.env.DATABASE_URL) {
    console.error('\n--apply needs DATABASE_URL');
    return 2;
  }
  if (bad.length) {
    console.error('\nrefusing to apply while rows fail validation');
    return 1;
  }

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  async function hostImage(url: string): Promise<string> {
    if (!process.env.CLOUDINARY_URL) return url;
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const { v2: cloudinary } = await import('cloudinary');
    const out = await new Promise<{ secure_url: string }>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: 'midnight-cardworks/products', resource_type: 'image' },
        (err, result) => (err || !result ? reject(err) : resolve(result as { secure_url: string })),
      ).end(buf);
    });
    return out.secure_url;
  }

  let written = 0;
  for (const p of products) {
    const image = await hostImage(p.image);
    await prisma.product.upsert({
      where: { slug: p.slug },
      create: { ...p, image, inventoryVersion: 0, reservedInventory: 0 },
      update: { title: p.title, description: p.description, price: p.price, category: p.category,
                tags: p.tags, image, inventory: p.inventory, active: p.active },
    });
    written += 1;
    if (written % 20 === 0) console.log(`  ${written}/${products.length}`);
  }

  console.log(`\nupserted ${written} products`);

  if (argv.includes('--retire-placeholders')) {
    const targets = [...PLACEHOLDER_SLUGS, ...TEST_LISTING_SLUGS];
    const found = await prisma.product.findMany({
      where: { slug: { in: targets } },
      select: { slug: true, title: true, active: true },
    });
    let retired = 0;
    for (const t of found) {
      if (!t.active) continue;
      await prisma.product.update({ where: { slug: t.slug }, data: { active: false } });
      console.log(`  retired ${t.slug}  (${t.title})`);
      retired += 1;
    }
    const missing = targets.filter((t) => !found.some((f) => f.slug === t));
    console.log(`retired ${retired} of ${targets.length}`);
    if (missing.length) console.log(`not present, skipped: ${missing.join(', ')}`);
  }

  await prisma.$disconnect();
  return 0;
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) process.exit(await main());

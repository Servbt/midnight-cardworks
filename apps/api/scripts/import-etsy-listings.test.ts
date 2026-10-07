import { describe as suite, expect, it } from 'vitest';
import {
  CATEGORY_TAG,
  categorize,
  describe as buildDescription,
  inspiration,
  parseCsv,
  slugify,
  toProduct,
  validate,
  type Product,
  type Row,
} from './import-etsy-listings.js';

/** A realistic export row: description carries commas, which is what breaks naive CSV parsing. */
const row = (over: Partial<Row> = {}): Row => ({
  TITLE: 'Sol Ring Proxy',
  DESCRIPTION: 'Made in superior smooth S33 black core cardstock, hope you enjoy it, cheers!',
  PRICE: '4.00',
  QUANTITY: '7',
  TAGS: 'custom_proxy_card,sol_ring',
  IMAGE1: 'https://i.etsystatic.com/1/r/il/abc/1/il_fullxfull.1_x.jpg',
  ...over,
});

function product(over: Partial<Row> = {}, taken = new Set<string>()): Product {
  return toProduct(row(over), taken);
}

suite('parseCsv', () => {
  it('keeps commas that sit inside a quoted field', () => {
    const rows = parseCsv('TITLE,PRICE\n"Sol Ring, Foil",4.00\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].TITLE).toBe('Sol Ring, Foil');
    expect(rows[0].PRICE).toBe('4.00');
  });

  it('unescapes doubled quotes', () => {
    const rows = parseCsv('TITLE\n"A ""proxy"" card"\n');
    expect(rows[0].TITLE).toBe('A "proxy" card');
  });

  it('handles a newline inside a quoted field', () => {
    const rows = parseCsv('TITLE,DESCRIPTION\n"One","line one\nline two"\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].DESCRIPTION).toBe('line one\nline two');
  });

  it('drops rows that are entirely blank', () => {
    expect(parseCsv('TITLE\n\nSol Ring\n\n')).toHaveLength(1);
  });

  it('trims the header so Etsy\'s BOM does not corrupt the first column', () => {
    const rows = parseCsv('\uFEFFTITLE,PRICE\nSol Ring,4.00\n');
    expect(rows[0].TITLE).toBe('Sol Ring');
  });
});

suite('slugify', () => {
  it('cuts the pipe-delimited Etsy tail off the title', () => {
    expect(slugify('Force of Will Proxy Card | Berserk Inspired TCG Fan Art | EDH Commander'))
      .toBe('force-of-will-proxy-card');
  });

  it('cuts a " - Source Inspired" suffix', () => {
    expect(slugify('Temporal Manipulation - FFX Inspired')).toBe('temporal-manipulation');
  });

  // Regression: apostrophes were being turned into hyphens, giving "serra-s-sanctum".
  it('removes apostrophes rather than turning them into hyphens', () => {
    expect(slugify("Serra's Sanctum - FF7 Inspired")).toBe('serras-sanctum');
    expect(slugify('Yawgmoth\u2019s Will - BG3 Inspired')).toBe('yawgmoths-will');
  });

  it('never returns an empty slug', () => {
    expect(slugify('|||')).toBe('listing');
  });

  it('always satisfies the API slug pattern', () => {
    for (const title of ['Sol Ring Proxy', "Lion's Eye Diamond Proxy V2", '---', 'A']) {
      expect(slugify(title)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

suite('categorize', () => {
  it('recognises tokens', () => {
    expect(categorize('Midna Treasure Token - Foil - Majora\'s Mask inspired')).toBe('Tokens');
  });

  it('recognises lands, including the dual lands', () => {
    expect(categorize('Tundra Dual Land Proxy Card | Tloz Inspired')).toBe('Lands');
    expect(categorize('Bayou Tloz TP Inspired Fan Art')).toBe('Lands');
  });

  it('classifies a land set as Lands, not Sets', () => {
    expect(categorize('Tloz Dual Lands Set - Fan Inspired')).toBe('Lands');
  });

  it('recognises a non-land set', () => {
    expect(categorize('Medallion Proxy Set - Tloz Inspired')).toBe('Sets');
  });

  // Commission is a category of product rather than a kind of card, so it gets its own bucket
  // instead of being folded into Custom - which is what the storefront files it under now.
  it('recognises commission work', () => {
    expect(categorize('Custom MTG Proxy Card Commission \u2013 Anime Style EDH Commander Card Art')).toBe('Commission');
    expect(categorize('Cabbage Merchant Proxy - ATLA Inspired (Commission Series)')).toBe('Commission');
  });

  it('falls back to Proxies', () => {
    expect(categorize('Sol Ring Proxy')).toBe('Proxies');
  });
});

suite('toProduct', () => {
  it('converts the price to integer cents', () => {
    expect(product({ PRICE: '4.00' }).price).toBe(400);
    expect(product({ PRICE: '14.99' }).price).toBe(1499);
    expect(product({ PRICE: '75.00' }).price).toBe(7500);
  });

  it('reads stock and the first image', () => {
    const p = product({ QUANTITY: '23' });
    expect(p.inventory).toBe(23);
    expect(p.image).toBe(row().IMAGE1);
  });

  it('defaults to active, unsold and unfeatured', () => {
    const p = product();
    expect(p.active).toBe(true);
    expect(p.featured).toBe(false);
    expect(p.saleActive).toBe(false);
    expect(p.salePrice).toBeNull();
  });

  it('splits tags and turns underscores into spaces', () => {
    expect(product({ TAGS: 'custom_proxy_card,edh_proxy_card' }).tags)
      .toEqual(['custom proxy card', 'edh proxy card']);
  });

  it('suffixes a colliding slug rather than overwriting the earlier listing', () => {
    const taken = new Set<string>();
    const first = toProduct(row({ TITLE: 'Ancient Tomb Proxy - DS1 Inspired' }), taken);
    const second = toProduct(row({ TITLE: 'Ancient Tomb Proxy' }), taken);
    const third = toProduct(row({ TITLE: 'Ancient Tomb Proxy' }), taken);
    expect(first.slug).toBe('ancient-tomb-proxy');
    expect(second.slug).toBe('ancient-tomb-proxy-2');
    expect(third.slug).toBe('ancient-tomb-proxy-3');
  });

  // Regression: the first fallback produced the non-word "proxie" from naive de-pluralising.
  it('gives untagged listings a usable fallback, never "proxie"', () => {
    const p = product({ TAGS: '' });
    expect(p.tags).toEqual(['custom proxy card', 'proxy card', 'unofficial proxy']);
    expect(p.tags.join(' ')).not.toMatch(/proxie(?!s)/);
  });

  it('uses the category to pick the fallback noun', () => {
    expect(product({ TITLE: 'Midna Treasure Token', TAGS: '' }).tags)
      .toContain(CATEGORY_TAG.Tokens);
    expect(product({ TITLE: 'Tundra Dual Land Proxy', TAGS: '' }).tags)
      .toContain(CATEGORY_TAG.Lands);
  });

  it('opens the description with the short card name, not the whole Etsy title', () => {
    const p = product({ TITLE: 'Force of Will Proxy Card | Berserk Inspired TCG Fan Art | EDH Commander' });
    expect(p.description.startsWith('Force of Will Proxy Card is a custom proxy piece')).toBe(true);
    expect(p.description).not.toContain('|');
  });

  it('every generated product passes the API-shaped validator', () => {
    for (const title of ['Sol Ring Proxy', 'Tundra Dual Land Proxy', 'Midna Treasure Token']) {
      expect(validate(product({ TITLE: title }))).toEqual([]);
    }
  });
});

suite('inspiration', () => {
  it('reads the source out of the title', () => {
    expect(inspiration('Necropotence Proxy - Berserk Inspired')).toBe('Berserk');
    expect(inspiration('Serra\u2019s Sanctum - FF7 Inspired')).toBe('FF7');
  });

  it('falls back to Zelda when the title says Tloz', () => {
    expect(inspiration('Chrome Mox Proxy - Tloz Inspired')).toBe('Tloz');
    expect(inspiration('Underground Sea Tloz Botw Proxy Card')).toBe('The Legend of Zelda');
  });

  it('returns empty when nothing is stated', () => {
    expect(inspiration('Sol Ring Proxy')).toBe('');
  });
});

suite('describe', () => {
  it('carries the real product facts', () => {
    const text = buildDescription('Sol Ring Proxy', 'Berserk', ['custom proxy card']);
    expect(text).toContain('S33 black-core cardstock');
    expect(text).toContain('AI and Photoshop assistance');
    expect(text).toContain('not intended for sanctioned play');
    expect(text).toContain('$15 and over include a free random card');
  });

  it('omits the theme line when no source is known', () => {
    expect(buildDescription('Sol Ring Proxy', '', [])).not.toContain('Artwork theme');
  });

  // Etsy ships one shared blurb on every listing; per-product phrasing is the whole point.
  it('produces different text for different products', () => {
    const a = buildDescription('Sol Ring Proxy', 'Berserk', []);
    const b = buildDescription('Chrome Mox Proxy', 'Tloz', []);
    expect(a).not.toBe(b);
  });
});

suite('validate', () => {
  it('accepts a well-formed product', () => {
    expect(validate(product())).toEqual([]);
  });

  it('rejects a slug with uppercase or doubled hyphens', () => {
    expect(validate({ ...product(), slug: 'Sol-Ring' }).join()).toMatch(/fails/);
    expect(validate({ ...product(), slug: 'sol--ring' }).join()).toMatch(/fails/);
  });

  it('rejects a negative price', () => {
    expect(validate({ ...product(), price: -1 }).join()).toMatch(/price/);
  });

  it('rejects a fractional price', () => {
    expect(validate({ ...product(), price: 4.5 }).join()).toMatch(/price/);
  });

  it('rejects an empty image', () => {
    expect(validate({ ...product(), image: '' }).join()).toMatch(/image/);
  });

  it('rejects a sale price that is not below the regular price', () => {
    const p = product();
    expect(validate({ ...p, saleActive: true, salePrice: p.price }).join()).toMatch(/sale price/);
    expect(validate({ ...p, saleActive: true, salePrice: p.price - 1 })).toEqual([]);
  });
});

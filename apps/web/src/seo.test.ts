import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('crawlable homepage shell', () => {
  it('exposes meaningful SEO metadata and landing copy before React loads', () => {
    const html = readFileSync('index.html', 'utf8');

    expect(html).toContain('<title>ServbotShop | Custom Trading Card Proxies & Collectible Cards</title>');
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('Premium custom trading card proxies, token packs, and display cards.');
    expect(html).toContain('Gallery preview');
    expect(html).toContain('Secure Stripe checkout');
    expect(html).not.toContain('How it works');
    expect(html).not.toContain('Pricing and packages');
  });

  it('declares the studio profiles in the structured data', () => {
    const html = readFileSync('index.html', 'utf8');
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '{}';
    const ld = JSON.parse(block);

    expect(ld['@type']).toBe('Store');
    expect(ld.name).toBe('ServbotShop');
    // sameAs is how a search engine ties these profiles to the shop, so an empty or drifting
    // list is a real loss - it must name exactly the three the site links to.
    expect(ld.sameAs).toEqual([
      'https://x.com/Servbot006',
      'https://www.etsy.com/shop/ServbotShop'
    ]);
  });
});

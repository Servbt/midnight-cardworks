import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('crawlable homepage shell', () => {
  it('exposes meaningful SEO metadata and landing copy before React loads', () => {
    const html = readFileSync('index.html', 'utf8');

    expect(html).toContain('<title>Midnight Cardworks | Custom Trading Card Proxies & Collectible Cards</title>');
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('Premium custom trading card proxies, token packs, and display cards.');
    expect(html).toContain('Gallery preview');
    expect(html).toContain('Secure Stripe checkout');
    expect(html).not.toContain('How it works');
    expect(html).not.toContain('Pricing and packages');
  });
});

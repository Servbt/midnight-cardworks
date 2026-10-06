import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('global CSS isolation', () => {
  it('scopes oversized hero heading styles so Clerk modal headings are not distorted', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toContain('.hero h1 {');
    expect(styles).not.toMatch(/(^|\n)h1\s*\{[^}]*text-shadow/s);
  });

  it('keeps the main navbar sticky at the top of every storefront view', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.top-nav\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/s);
  });

  it('keeps the hydrated app shell wider than the crawlable preload shell', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/--app-w:\s*1400px/);
    expect(styles).toMatch(/main\s*\{[^}]*width:\s*min\(var\(--app-w\),\s*100%\)[^}]*margin:\s*0 auto/s);
  });

  it('makes the cart checkout summary sticky for mobile shoppers', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.sticky-checkout-bar\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*1rem/s);
  });

  it('keeps the desktop cart summary wide enough for totals', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.cart-marketplace-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(380px,\s*420px\)/s);
    expect(styles).toMatch(/\.summary-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*max-content/s);
    expect(styles).toMatch(/\.summary-row strong,\s*\.summary-row span:last-child\s*\{[^}]*white-space:\s*nowrap/s);
  });

  // Retargeted again: first this guarded the centring of the footer's link columns, then the
  // reduction to the disclaimer alone. The studio profiles now share the footer with the
  // disclaimer, so it holds that shape instead - one centred row carrying both - and still fails
  // if any of the removed footer navigation CSS comes back without markup to justify it.
  it('keeps the footer to the disclaimer and the studio profiles', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
    const markup = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

    // the centring moved off the paragraph and onto the row, which is what is centred now
    expect(styles).toMatch(/\.footer-row\s*\{[^}]*width:\s*min\(var\(--max-w\)[^}]*justify-content:\s*space-between/s);
    expect(styles).toMatch(/\.footer-legal\s*\{[^}]*flex:\s*1 1 20rem/s);
    expect(styles).toMatch(/\.social-links a\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/s);
    // circular (square box on the pill radius) and a step up from the 32px they were as text
    expect(styles).toMatch(/\.social-links a\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/s);
    // the mark takes the link's colour, so both go accent together on hover
    expect(styles).toMatch(/\.social-links a svg\s*\{[^}]*fill:\s*currentColor/s);
    // a centreline mark is stroked, so it must not also be filled
    expect(styles).toMatch(/\.social-links a svg\[data-stroked\]\s*\{[^}]*fill:\s*none[^}]*stroke:\s*currentColor/s);
    for (const removed of ['.footer-inner', '.footer-wordmark', '.footer-links', '.footer-tagline', '.footer-brand']) {
      expect(styles).not.toContain(removed);
    }

    // the markup really is the disclaimer plus the shared profile row, and nothing else
    const footer = markup.match(/<footer>[\s\S]*?<\/footer>/)?.[0] ?? '';
    expect(footer).toMatch(/<p className="footer-legal">/);
    expect(footer).toMatch(/socialLinkRow\('footer'\)/);
    expect(footer).not.toMatch(/<nav|<button|footer-wordmark/);

    // and the row points only at the three studio profiles, opened safely
    const list = markup.match(/const socialLinks(?::\s*SocialLink\[\])?\s*=\s*\[[\s\S]*?\];/)?.[0] ?? '';
    expect(list.match(/href: '[^']+'/g)).toEqual([
      "href: 'https://x.com/Servbot006'",
      "href: 'https://www.etsy.com/shop/ServbotShop'",
      "href: 'https://www.whatnot.com/user/servbotshop'"
    ]);
    expect(markup).toMatch(/rel="me noopener noreferrer"/);
  });

  it('stacks cart rows and controls for narrow mobile screens', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/@media \(max-width:\s*860px\)[\s\S]*\.cart-line\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(styles).toMatch(/@media \(max-width:\s*860px\)[\s\S]*\.cart-line-actions\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
    expect(styles).toMatch(/@media \(max-width:\s*860px\)[\s\S]*\.cart-line-total\s*\{[^}]*text-align:\s*left/s);
  });
});

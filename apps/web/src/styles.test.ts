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

  // The filter groups grew past the viewport once Card type and Colour identity were added, and
  // the sidebar could not be scrolled: a bare `overflow: hidden` further down the rule was
  // silently beating `overflow-y: auto`. Both halves of the fix are held here.
  it('keeps the shop filters scrollable inside the sidebar', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
    const sidebar = styles.match(/\.shop-sidebar \{[^}]*\}/s)?.[0] ?? '';

    expect(sidebar).toMatch(/max-height:\s*calc\(100vh/);
    expect(sidebar).toMatch(/overflow-y:\s*auto/);
    // a plain `overflow` here would win over overflow-y and clip the lower groups again
    expect(sidebar).not.toMatch(/\n\s*overflow:\s/);

    // and the header stays put so Clear is reachable however far the options scroll
    const header = styles.match(/\.sidebar-header \{[^}]*\}/s)?.[0] ?? '';
    expect(header).toMatch(/position:\s*sticky/);
    expect(header).toMatch(/top:\s*0/);
    // it scrolls under the options, so it needs to be opaque
    expect(header).toMatch(/background:\s*var\(/);
  });

  // On mobile the sidebar is hidden and this strip is the whole filter UI, so it has to be
  // readable: three selects sharing 390px with `flex: 1` left about 60px each, and a native
  // select's arrow landed on a label truncated to "All pr".
  it('keeps the mobile filter strip readable and scrollable', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
    const mobile = styles.slice(styles.indexOf('@media (max-width: 860px)'));
    expect(mobile, 'the 860px block should exist').not.toBe('');

    const select = mobile.match(/\.mobile-category-select \{[^}]*\}/s)?.[0] ?? '';
    expect(select).toMatch(/flex:\s*0 0 auto/);
    expect(select).not.toMatch(/min-width:\s*0/);
    // padding on the right so the native arrow sits beside the label rather than over it
    expect(select).toMatch(/padding:[^;]*1\.75rem/);

    const nav = mobile.match(/\.nav-secondary \{[^}]*\}/s)?.[0] ?? '';
    expect(nav).toMatch(/overflow-x:\s*auto/);
    // `overflow: visible` here is what let the strip run off the screen with no way to scroll it
    expect(nav).not.toMatch(/overflow:\s*visible/);
  });

  it('centres the studio profile links in both rows on mobile', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
    const mobile = styles.slice(styles.indexOf('@media (max-width: 860px)'));
    const rule = mobile.match(/\.social-links\.is-hero,\s*\.social-links\.is-footer \{[^}]*\}/s)?.[0] ?? '';
    expect(rule).toMatch(/justify-content:\s*center/);
    // the row has to take the width first, or centring inside a shrink-wrapped row does nothing
    expect(rule).toMatch(/width:\s*100%/);
  });
});

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

  it('centers footer navigation columns and link labels', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.footer-links > div\s*\{[^}]*align-items:\s*center[^}]*text-align:\s*center/s);
    expect(styles).toMatch(/\.footer-links \.text-btn\s*\{[^}]*justify-content:\s*center[^}]*text-align:\s*center/s);
  });

  it('stacks cart rows and controls for narrow mobile screens', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/@media \(max-width:\s*860px\)[\s\S]*\.cart-line\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(styles).toMatch(/@media \(max-width:\s*860px\)[\s\S]*\.cart-line-actions\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
    expect(styles).toMatch(/@media \(max-width:\s*860px\)[\s\S]*\.cart-line-total\s*\{[^}]*text-align:\s*left/s);
  });
});

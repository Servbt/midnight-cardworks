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

  it('makes the cart checkout summary sticky for mobile shoppers', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.sticky-checkout-bar\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*1rem/s);
  });

  it('stacks cart rows and controls for narrow mobile screens', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/@media \(max-width:\s*860px\)[\s\S]*\.cart-line\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(styles).toMatch(/@media \(max-width:\s*860px\)[\s\S]*\.cart-line-actions\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
    expect(styles).toMatch(/@media \(max-width:\s*860px\)[\s\S]*\.cart-line-total\s*\{[^}]*text-align:\s*left/s);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('global CSS isolation', () => {
  it('scopes oversized hero heading styles so Clerk modal headings are not distorted', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toContain('.hero h1 {');
    expect(styles).not.toMatch(/(^|\n)h1\s*\{[^}]*text-shadow/s);
  });

  it('makes the cart checkout summary sticky for mobile shoppers', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.sticky-checkout-bar\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*1rem/s);
  });
});

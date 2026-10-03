import { describe, expect, it } from 'vitest';
import { displayProductTitle, productPreviewCopy } from './productPresentation';

describe('storefront product copy', () => {
  it('keeps the card name and art theme while removing Etsy search phrases', () => {
    expect(displayProductTitle('Force of Will Proxy Card | Berserk Inspired TCG Fan Art | EDH Commander'))
      .toBe('Force of Will Proxy Card — Berserk Inspired');
    expect(displayProductTitle('Underground Sea Tloz Botw Proxy Card | Fantasy Land | Custom TCG Fan Art'))
      .toBe('Underground Sea Tloz Botw Proxy Card');
    expect(displayProductTitle('Temporal Manipulation - FFX Inspired')).toBe('Temporal Manipulation - FFX Inspired');
  });

  it('uses a short first sentence without spilling long listing descriptions into the gallery', () => {
    expect(productPreviewCopy({ description: 'Printed on black-core cardstock. Made to order. Filed under trading card proxy.' }))
      .toBe('Printed on black-core cardstock.');
    const preview = productPreviewCopy({ description: 'A custom card with detailed fantasy artwork '.repeat(8) });
    expect(preview.length).toBeLessThanOrEqual(160);
    expect(preview).toMatch(/…$/);
  });
});

import type { Product } from './api';

// Etsy titles include search phrases after pipes. Keep the card name and its art
// theme on the storefront; retain the original title for SEO and accessible labels.
export function displayProductTitle(title: string): string {
  const [name, ...details] = title.split('|').map((part) => part.trim());
  const theme = details.map((part) => part.match(/^(.+?Inspired)\b/i)?.[1]).find(Boolean);
  return theme ? `${name} — ${theme}` : name;
}

export function productPreviewCopy(product: Pick<Product, 'description'>): string {
  const sentence = product.description.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() || product.description;
  if (sentence.length <= 160) return sentence;
  return `${sentence.slice(0, 157).replace(/\s+\S*$/, '').trimEnd()}…`;
}

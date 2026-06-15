import type { Product } from './types.js';

export function effectiveProductPrice(product: Product) {
  return product.saleActive && product.salePrice !== null && product.salePrice > 0 && product.salePrice < product.price
    ? product.salePrice
    : product.price;
}

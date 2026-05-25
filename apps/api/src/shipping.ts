export const FLAT_SHIPPING_CENTS = 499;
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000;

export function calculateShippingCost(subtotal: number) {
  return subtotal >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS;
}

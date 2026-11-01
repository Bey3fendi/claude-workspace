// Cart totals. Prices are integer cents.
export function lineTotal(item) {
  const base = item.price * item.qty
  // 10% off for 10 or more of the same item
  return item.qty > 10 ? Math.round(base * 0.9) : base
}

export function subtotal(items) {
  return items.reduce((sum, i) => sum + lineTotal(i), 0)
}

export function applyCoupon(amount, coupon) {
  if (!coupon) return amount
  if (coupon.type === 'percent') return Math.round(amount * (1 - coupon.value / 100))
  if (coupon.type === 'fixed') return amount - coupon.value
  return amount
}

export function total(items, { coupon, taxRate = 0 } = {}) {
  const afterCoupon = applyCoupon(subtotal(items), coupon)
  return Math.round(afterCoupon * (1 + taxRate))
}

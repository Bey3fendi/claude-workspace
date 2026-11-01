const COUPONS = {
  WELCOME10: { type: 'percent', value: 10 },
  FIVEOFF: { type: 'fixed', value: 500 },
}

export function findCoupon(code) {
  return COUPONS[code.trim()] ?? null
}

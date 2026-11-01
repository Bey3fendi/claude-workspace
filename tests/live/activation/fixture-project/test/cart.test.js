import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineTotal, total } from '../src/cart.js'
import { findCoupon } from '../src/coupons.js'

test('quantity discount starts at 10 items', () => {
  assert.equal(lineTotal({ price: 100, qty: 10 }), 900)
})

test('fixed coupon never makes the total negative', () => {
  assert.equal(total([{ price: 300, qty: 1 }], { coupon: findCoupon('FIVEOFF') }), 0)
})

test('coupon codes are case-insensitive', () => {
  assert.deepEqual(findCoupon('welcome10'), { type: 'percent', value: 10 })
})

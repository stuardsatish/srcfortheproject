// node --test src/utils/__tests__/paymentLabels.test.mjs
// Tests for src/utils/paymentLabels.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  paymentMethodLabel,
  paymentStatusLabel,
  isCodPending,
  isPendingPayment,
} from '../paymentLabels.js'

describe('paymentMethodLabel', () => {
  it('COD uppercase', () => assert.equal(paymentMethodLabel('COD'), 'Cash on Delivery (COD)'))
  it('cod lowercase', () => assert.equal(paymentMethodLabel('cod'), 'Cash on Delivery (COD)'))
  it('Razorpay', () => assert.equal(paymentMethodLabel('Razorpay'), 'Razorpay'))
  it('razorpay lowercase', () => assert.equal(paymentMethodLabel('razorpay'), 'Razorpay'))
  it('WhatsApp', () => assert.equal(paymentMethodLabel('whatsapp'), 'WhatsApp'))
  it('unknown method passes through', () => assert.equal(paymentMethodLabel('UPI'), 'UPI'))
  it('null -> N/A', () => assert.equal(paymentMethodLabel(null), 'N/A'))
  it('empty string -> N/A', () => assert.equal(paymentMethodLabel(''), 'N/A'))
})

describe('paymentStatusLabel', () => {
  it('paid -> Paid', () => assert.equal(paymentStatusLabel('paid'), 'Paid'))
  it('PAID uppercase -> Paid', () => assert.equal(paymentStatusLabel('PAID'), 'Paid'))
  it('pending with no method -> Pending', () =>
    assert.equal(paymentStatusLabel('pending'), 'Pending'))
  it('pending + COD -> Pay on Delivery', () =>
    assert.equal(paymentStatusLabel('pending', 'cod'), 'Pending (Pay on Delivery)'))
  it('pending + WhatsApp', () =>
    assert.equal(paymentStatusLabel('pending', 'whatsapp'), 'Pending (WhatsApp)'))
  it('null status -> N/A', () => assert.equal(paymentStatusLabel(null), 'N/A'))
  it('unknown status passes through', () => assert.equal(paymentStatusLabel('refunded'), 'refunded'))
})

describe('isCodPending', () => {
  it('COD + pending -> true', () =>
    assert.equal(isCodPending({ paymentMethod: 'cod', paymentStatus: 'pending' }), true))
  it('COD + paid -> false', () =>
    assert.equal(isCodPending({ paymentMethod: 'cod', paymentStatus: 'paid' }), false))
  it('Razorpay + pending -> false', () =>
    assert.equal(isCodPending({ paymentMethod: 'razorpay', paymentStatus: 'pending' }), false))
  it('null order -> false', () => assert.equal(isCodPending(null), false))
})

describe('isPendingPayment', () => {
  it('COD + pending -> true', () =>
    assert.equal(isPendingPayment({ paymentMethod: 'cod', paymentStatus: 'pending' }), true))
  it('WhatsApp + pending -> true', () =>
    assert.equal(isPendingPayment({ paymentMethod: 'whatsapp', paymentStatus: 'pending' }), true))
  it('Razorpay + pending -> false', () =>
    assert.equal(isPendingPayment({ paymentMethod: 'razorpay', paymentStatus: 'pending' }), false))
  it('COD + paid -> false', () =>
    assert.equal(isPendingPayment({ paymentMethod: 'cod', paymentStatus: 'paid' }), false))
  it('null -> false', () => assert.equal(isPendingPayment(null), false))
})

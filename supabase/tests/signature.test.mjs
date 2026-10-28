// Unit tests for supabase/functions/_shared/signature.ts - the HMAC primitives behind payment-verify and payment-webhook (the checks that decide whether a
// "payment captured" call is really Razorpay's). The REAL module is imported; WebCrypto is the same API Deno provides. Expected digests were computed with an
// INDEPENDENT implementation (.NET HMACSHA256) and the RFC 4231 vectors, so the module is not graded against itself.
//   cd supabase/tests && node --test signature.test.mjs        (also part of  node run-all.mjs)
//   no Node: .\tools\browser-test\Run-TsLiteTests.ps1 -Test <this file> -Ts <the .ts above>
// What this does NOT prove: that razorpay.ts / the two Edge Functions wire it correctly on Deno (NEEDS-NODE: npm run typecheck; NEEDS-LIVE: a Razorpay TEST payment).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hmacHex, timingSafeEqual, verifyHmacSignature } from '../functions/_shared/signature.ts'

const WEBHOOK_SECRET = 'whsec_test_secret'
// a raw webhook body as Razorpay sends it: compact JSON with a non-ASCII character (the digest is over the exact UTF-8 bytes)
const RAW = '{"entity":"event","event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_XYZ789","order_id":"order_ABC123","amount":150000,"currency":"INR","notes":{"label":"Rs 1,500 - café"}}}}}'
const RAW_SIG = '93755da25a2ee152fb55692f9d8108474371fc462833349a7231125d5a8a866c'
const PAY_SIG = '772123b233fa0d8eeadadb5818c7d6fd2cd1918eec13fa6a0b1d24d416d577bf'
const EMPTY_KEY_SIG = 'b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad'     // HMAC-SHA256 with an EMPTY key over an empty message

describe('hmacHex: known answers', () => {
  it('RFC 4231 test case 1 (20 x 0x0b, "Hi There")', async () => {
    assert.equal(await hmacHex('\x0b'.repeat(20), 'Hi There'), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
  })
  it('RFC 4231 test case 2 ("Jefe")', async () => {
    assert.equal(await hmacHex('Jefe', 'what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })
  it('the checkout signature: HMAC(order_id|payment_id) with the key secret', async () => {
    assert.equal(await hmacHex('key_secret_test', 'order_ABC123|pay_XYZ789'), PAY_SIG)
  })
  it('the webhook signature: HMAC over the raw UTF-8 body', async () => {
    assert.equal(await hmacHex(WEBHOOK_SECRET, RAW), RAW_SIG)
  })
  it('lower-case hex, 64 characters', async () => {
    assert.match(await hmacHex('k', 'm'), /^[0-9a-f]{64}$/)
  })
})

describe('verifyHmacSignature: accepts only the genuine signature', () => {
  it('the checkout signature and the webhook signature are accepted', async () => {
    assert.equal(await verifyHmacSignature('key_secret_test', 'order_ABC123|pay_XYZ789', PAY_SIG), true)
    assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, RAW, RAW_SIG), true)
  })
  it('a changed payload is refused - one character of the body, another order id, another payment id', async () => {
    assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, RAW.replace('150000', '150001'), RAW_SIG), false)
    assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, RAW.replace('pay_XYZ789', 'pay_XYZ780'), RAW_SIG), false)
    assert.equal(await verifyHmacSignature('key_secret_test', 'order_ABC124|pay_XYZ789', PAY_SIG), false)
    assert.equal(await verifyHmacSignature('key_secret_test', 'order_ABC123|pay_XYZ780', PAY_SIG), false)
    assert.equal(await verifyHmacSignature('key_secret_test', 'pay_XYZ789|order_ABC123', PAY_SIG), false)       // the pieces in the wrong order
  })
  it('the digest is over the RAW body: the same JSON re-serialised (different spacing / key order) is refused', async () => {
    assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, JSON.stringify(JSON.parse(RAW), null, 1), RAW_SIG), false)
    assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, RAW + '\n', RAW_SIG), false)
  })
  it('a different secret is refused (the checkout secret never validates a webhook and vice versa)', async () => {
    assert.equal(await verifyHmacSignature('whsec_other', RAW, RAW_SIG), false)
    assert.equal(await verifyHmacSignature('key_secret_test', RAW, RAW_SIG), false)
    assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, 'order_ABC123|pay_XYZ789', PAY_SIG), false)
  })
  it('a tampered signature is refused: one hex digit changed, upper case, padded, truncated, extended', async () => {
    const flip = RAW_SIG.slice(0, -1) + (RAW_SIG.endsWith('c') ? 'd' : 'c')
    for (const bad of [flip, RAW_SIG.toUpperCase(), ' ' + RAW_SIG, RAW_SIG + ' ', RAW_SIG.slice(0, 63), RAW_SIG + '0', '0'.repeat(64), RAW_SIG.slice(0, 32)]) {
      assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, RAW, bad), false, JSON.stringify(bad))
    }
  })
})

describe('verifyHmacSignature FAILS CLOSED', () => {
  it('an empty or missing secret never validates anything - not even a correctly computed HMAC under an empty key', async () => {
    for (const secret of ['', null, undefined, 0, false, {}, []]) {
      assert.equal(await verifyHmacSignature(secret, '', EMPTY_KEY_SIG), false, String(secret))
      assert.equal(await verifyHmacSignature(secret, RAW, RAW_SIG), false, String(secret))
    }
  })
  it('a missing / non-string signature or payload answers false and never throws', async () => {
    for (const sig of ['', null, undefined, 123, {}, [], true]) assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, RAW, sig), false, String(sig))
    for (const data of [null, undefined, 123, {}, []]) assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, data, RAW_SIG), false, String(data))
    assert.equal(await verifyHmacSignature(), false)
  })
  it('an empty payload with a real secret is a legitimate (if odd) message: it validates only its own digest', async () => {
    const d = await hmacHex(WEBHOOK_SECRET, '')
    assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, '', d), true)
    assert.equal(await verifyHmacSignature(WEBHOOK_SECRET, '', RAW_SIG), false)
  })
})

describe('timingSafeEqual', () => {
  it('equal strings are equal; any difference, anywhere, is not', () => {
    assert.equal(timingSafeEqual('abc', 'abc'), true)
    assert.equal(timingSafeEqual('abc', 'abd'), false)
    assert.equal(timingSafeEqual('abc', 'xbc'), false)
    assert.equal(timingSafeEqual(RAW_SIG, RAW_SIG), true)
    assert.equal(timingSafeEqual(RAW_SIG, RAW_SIG.slice(0, -1) + '0'), RAW_SIG.endsWith('0'))
  })
  it('different lengths are refused, including a prefix; empty equals empty', () => {
    assert.equal(timingSafeEqual('abc', 'abcd'), false)
    assert.equal(timingSafeEqual('abcd', 'abc'), false)
    assert.equal(timingSafeEqual('', 'a'), false)
    assert.equal(timingSafeEqual('', ''), true)
  })
  it('compares UTF-8 bytes (a multi-byte character is one position but several bytes) and the text of non-strings', () => {
    assert.equal(timingSafeEqual('café', 'café'), true)
    assert.equal(timingSafeEqual('café', 'cafe'), false)
    assert.equal(timingSafeEqual(12, '12'), true)
    assert.equal(timingSafeEqual(null, 'null'), true)
    assert.equal(timingSafeEqual(undefined, 'x'), false)
  })
})
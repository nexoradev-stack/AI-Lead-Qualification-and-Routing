const test = require('node:test');
const assert = require('node:assert');
const form = require('../webflow/lead-form.js');

const opts = (o = {}) => Object.assign({ BLOCK_FREE_PROVIDERS: false, BLOCK_CATCH_ALL: false }, o);
const res = (code, free = 'false') => ({ debounce: { code: String(code), free_email: free } });

test('Debounce codes 1, 2, 3 and 6 are blocked', () => {
  assert.equal(form.interpretDebounce(res(1), opts()).reason, 'syntax');
  assert.equal(form.interpretDebounce(res(2), opts()).ok, false);
  assert.equal(form.interpretDebounce(res(3), opts()).reason, 'disposable');
  assert.equal(form.interpretDebounce(res(6), opts()).reason, 'invalid');
});

test('deliverable, role and unknown addresses are allowed', () => {
  for (const c of [5, 7, 8]) assert.equal(form.interpretDebounce(res(c), opts()).ok, true);
});

test('catch-all and free providers are blocked only when switched on', () => {
  assert.equal(form.interpretDebounce(res(4), opts()).ok, true);
  assert.equal(form.interpretDebounce(res(4), opts({ BLOCK_CATCH_ALL: true })).reason, 'catchAll');
  assert.equal(form.interpretDebounce(res(5, 'true'), opts()).ok, true);
  assert.equal(form.interpretDebounce(res(5, 'true'), opts({ BLOCK_FREE_PROVIDERS: true })).reason, 'free');
});

test('fails open when Debounce gives no answer', () => {
  assert.deepEqual(form.interpretDebounce(null, opts()), { ok: true, reason: 'unavailable' });
});

test('syntax check', () => {
  assert.ok(form.isValidSyntax('alex.morgan@example.com'));
  assert.ok(!form.isValidSyntax('alex@'));
  assert.ok(!form.isValidSyntax('alex morgan@example.com'));
});

test('UTM values are first-touch', () => {
  const fresh = form.readUtm('?utm_campaign=summer+cloud&utm_source=linkedin&utm_medium=paid', null);
  assert.deepEqual(fresh, { utmCampaignName: 'summer cloud', utmCampaignSource: 'linkedin', utmCampaignMedium: 'paid' });
  assert.deepEqual(form.readUtm('?utm_source=google', fresh), fresh);
  assert.deepEqual(form.readUtm('', null), { utmCampaignName: '', utmCampaignSource: '', utmCampaignMedium: '' });
});

test('placeholders are shipped, not real values', () => {
  assert.equal(form.CONFIG.INTAKE_URL, 'REPLACE_WITH_INTAKE_WEB_APP_URL');
  assert.equal(form.CONFIG.DEBOUNCE_PUBLIC_KEY, 'REPLACE_WITH_DEBOUNCE_PUBLIC_KEY');
  assert.match(form.debounceUrl('a+b@example.com', 'k'), /email=a%2Bb%40example\.com$/);
});

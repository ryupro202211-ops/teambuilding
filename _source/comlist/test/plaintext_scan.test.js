'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripCiphertextForPlaintextScan } = require('../build');

test('removes only the encrypted ENC object before scanning for plaintext', () => {
  const html = '<script>const ENC = {"salt":"c2FsdA==","iv":"aXY=","ct":"fixture-only-secret","it":250000};</script>';
  assert.equal(stripCiphertextForPlaintextScan?.(html), '<script>const ENC = {};</script>');
});

test('keeps a matching literal outside the encrypted ENC object visible to the scan', () => {
  const html = '<p>fixture-only-secret</p><script>const ENC = {"ct":"fixture-only-secret"};</script>';
  const scanned = stripCiphertextForPlaintextScan?.(html);
  assert.equal(typeof scanned, 'string');
  assert.equal(scanned.includes('fixture-only-secret'), true);
});

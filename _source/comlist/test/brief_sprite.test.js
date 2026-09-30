const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('uses the supplied 1254px five-by-five brief icon sprite', () => {
  const png = fs.readFileSync(path.join(__dirname, '..', '_assets', 'brief-icons-v2.png'));
  assert.equal(png.readUInt32BE(16), 1254);
  assert.equal(png.readUInt32BE(20), 1254);
});

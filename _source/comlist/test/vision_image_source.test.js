'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

test('daily vision source keeps the approved image at its intrinsic aspect ratio', () => {
  const html = fs.readFileSync('_assets/list.html', 'utf8');
  const imageTag = html.match(/<img\b[^>]*data-comlist-image="dream-vision-board"[^>]*>/)?.[0];
  assert.ok(imageTag, 'the page must include the vision image');

  const image = fs.readFileSync('_assets/dream-vision-board.png');
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const imageWidth = image.readUInt32BE(16);
  const imageHeight = image.readUInt32BE(20);
  assert.equal(imageWidth, 1672);
  assert.equal(imageHeight, 941);
  assert.match(imageTag, new RegExp(`\\bwidth="${imageWidth}"`));
  assert.match(imageTag, new RegExp(`\\bheight="${imageHeight}"`));
  assert.equal(
    crypto.createHash('sha256').update(image).digest('hex'),
    '5db0d724571619acebe948b44200d52f8755b581dbb44885bd4eb7c8f11f416c'
  );

  const css = fs.readFileSync('_assets/css/comlist.css', 'utf8');
  const imageRule = css.match(/\.dream-vision img\s*\{([^}]*)\}/)?.[1];
  assert.ok(imageRule, 'the vision image must have a layout rule');
  assert.match(imageRule, /aspect-ratio:\s*auto\s*;/);
});

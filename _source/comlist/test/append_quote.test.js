"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { appendQuote } = require("../append_quote.js");

const base = () => ({ _readme: "r", used: [{ date: "2026-09-25", source: "A", quote: "昨日の格言" }] });

test("採用した格言を1件追記する", () => {
  const out = appendQuote(base(), { date: "2026-09-26", quote: { text: "今日の格言", source: "B" } });
  assert.equal(out.used.length, 2);
  assert.deepEqual(out.used[1], { date: "2026-09-26", source: "B", quote: "今日の格言" });
  assert.equal(out._readme, "r");
});

test("同じ日に作り直したときは上書きして二重に積まない", () => {
  const once = appendQuote(base(), { date: "2026-09-26", quote: { text: "案1", source: "B" } });
  const twice = appendQuote(once, { date: "2026-09-26", quote: { text: "案2", source: "C" } });
  assert.equal(twice.used.length, 2);
  assert.equal(twice.used[1].quote, "案2");
});

test("格言が無い日はエラーにする", () => {
  assert.throws(() => appendQuote(base(), { date: "2026-09-26", quote: "" }), /格言/);
});

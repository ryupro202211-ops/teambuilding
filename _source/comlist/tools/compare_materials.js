#!/usr/bin/env node
"use strict";
/**
 * 旧経路（ブラウザ/gviz）と新経路（API）の連絡先を突き合わせる。
 *
 *   node tools/compare_materials.js _work/contacts.json _work/contacts.api.json
 *
 * 完全一致は期待しない。旧経路の get_page_text は連続する空白を1つに畳むため、
 * 履歴のような自由記述で差が出る。空白の畳み込みに起因する差は API 側が正しい。
 * それ以外の差が1件でもあれば不合格とする。
 */

const fs = require("fs");

const [oldFile, newFile] = process.argv.slice(2);
if (!oldFile || !newFile) {
  console.error("usage: node tools/compare_materials.js <old.json> <new.json>");
  process.exit(2);
}
const oldArr = JSON.parse(fs.readFileSync(oldFile, "utf8"));
const newArr = JSON.parse(fs.readFileSync(newFile, "utf8"));

const squash = (s) => String(s).replace(/\s+/g, " ").trim();
const fail = [];

// 1) 件数とカテゴリ内訳
const tally = (arr) => arr.reduce((m, o) => {
  const k = o["カテゴリー"] || "?"; m[k] = (m[k] || 0) + 1; return m;
}, {});
const tOld = tally(oldArr), tNew = tally(newArr);
console.log("件数    旧=" + oldArr.length + " 新=" + newArr.length);
console.log("内訳    旧=" + JSON.stringify(tOld) + " 新=" + JSON.stringify(tNew));
if (oldArr.length !== newArr.length) fail.push("件数が違う");

// カテゴリ内訳の比較：キー順に依存しない形
const tallyAllKeys = new Set([...Object.keys(tOld), ...Object.keys(tNew)]);
let tallyMatch = true;
for (const k of tallyAllKeys) {
  if ((tOld[k] || 0) !== (tNew[k] || 0)) {
    tallyMatch = false;
    break;
  }
}
if (!tallyMatch) fail.push("カテゴリ内訳が違う");

// 2) _row の集合
const rowsOld = oldArr.map((o) => o._row).sort((a, b) => a - b);
const rowsNew = newArr.map((o) => o._row).sort((a, b) => a - b);
if (JSON.stringify(rowsOld) !== JSON.stringify(rowsNew)) fail.push("_row の集合が違う");
else console.log("_row    一致（" + rowsOld.length + "件）");

// 3) フィールド差。空白の畳み込みだけの差は許容する。
const byRowOld = new Map(oldArr.map((o) => [o._row, o]));
let squashOnly = 0;
for (const n of newArr) {
  const o = byRowOld.get(n._row);
  if (!o) { fail.push("_row " + n._row + " が旧に無い"); continue; }
  const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
  for (const k of keys) {
    const a = o[k] === undefined ? "" : String(o[k]);
    const b = n[k] === undefined ? "" : String(n[k]);
    if (a === b) continue;
    if (squash(a) === squash(b)) { squashOnly++; continue; }
    fail.push("_row " + n._row + " の「" + k + "」が違う（空白以外の差）");
  }
}
console.log("空白のみの差: " + squashOnly + "件（許容）");

if (fail.length === 0) {
  console.log("COMPARE_RESULT: OK");
} else {
  console.log("COMPARE_RESULT: FAILED");
  fail.slice(0, 40).forEach((f) => console.log("  - " + f));
  if (fail.length > 40) console.log("  ... 他 " + (fail.length - 40) + "件");
  process.exit(1);
}

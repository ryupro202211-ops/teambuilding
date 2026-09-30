"use strict";

/* 公開に成功した日の格言を _quote_history.json の used に追記する。
   同じ日付の行があれば上書きし、作り直しで二重に積まない。
   使い方: node append_quote.js --tasks _work/daily_tasks.json [--history _quote_history.json] */

const fs = require("node:fs");
const path = require("node:path");

function appendQuote(history, daily) {
  const q = daily && daily.quote;
  const text = q && typeof q === "object" ? q.text : q;
  const source = q && typeof q === "object" ? q.source : daily && daily.quoteSource;
  if (!daily || !/^\d{4}-\d{2}-\d{2}$/.test(String(daily.date || ""))) throw new Error("日次タスクの date が不正です");
  if (!text || !String(text).trim()) throw new Error("今日の格言がありません");
  const used = (Array.isArray(history && history.used) ? history.used : []).filter(u => u && u.date !== daily.date);
  used.push({ date: daily.date, source: String(source || ""), quote: String(text) });
  return Object.assign({}, history, { used });
}

function main(argv) {
  const arg = (name, fallback) => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : fallback; };
  const tasksPath = arg("tasks");
  const historyPath = arg("history", path.join(__dirname, "_quote_history.json"));
  if (!tasksPath) throw new Error("--tasks が必要です");
  const daily = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
  const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  const next = appendQuote(history, daily);
  const tmp = historyPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(tmp, historyPath);
  console.log("QUOTE_RESULT: OK used=" + next.used.length);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error("QUOTE_RESULT: FAILED " + e.message); process.exit(1); }
}

module.exports = { appendQuote };

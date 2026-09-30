"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  legacyEventToRecords,
  normalizeEvent,
} = require("./event_records.js");

function writeAtomic(filePath, contents, fsApi = fs) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(12).toString("hex")}.tmp`
  );
  fsApi.mkdirSync(directory, { recursive: true });
  try {
    fsApi.writeFileSync(temporaryPath, contents, "utf8");
    fsApi.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fsApi.unlinkSync(temporaryPath); } catch (ignore) { /* preserve the original error */ }
    throw error;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function reportComparable(report) {
  const records = [...report.records].sort((a, b) => String(a.migrationKey).localeCompare(String(b.migrationKey)));
  const warnings = [...report.warnings].sort((a, b) => JSON.stringify(canonicalize(a)).localeCompare(JSON.stringify(canonicalize(b))));
  const skipped = [...report.skipped].sort((a, b) => JSON.stringify(canonicalize(a)).localeCompare(JSON.stringify(canonicalize(b))));
  return canonicalize({
    sourceVersion: report.sourceVersion,
    sourceCount: report.sourceCount,
    recordCount: report.recordCount,
    sourceRows: report.sourceRows || [],
    records,
    warnings,
    skipped,
  });
}

function migrationReportId(report) {
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify(reportComparable(report)), "utf8")
    .digest("hex")
    .slice(0, 24);
  return `mig_${digest}`;
}

function buildMigrationReport(events, year, options = {}) {
  if (!Array.isArray(events)) throw new Error("旧イベント一覧が不正です");
  if (!Number.isInteger(year)) throw new Error("旧イベントの移行年が必要です");

  const records = [];
  const warnings = [];
  const skipped = Array.isArray(options.skipped) ? options.skipped.map((item) => ({ ...item })) : [];
  const seenMigrationKeys = new Set();
  events.forEach((event, index) => {
    try {
      legacyEventToRecords(event, year).forEach((record) => {
        const migrationWarning = record.migrationWarning;
        if (migrationWarning) {
          warnings.push({ index, title: record.title, message: migrationWarning });
        }
        const validated = normalizeEvent(record, { allowMissingId: true });
        if (!record.migrationKey || seenMigrationKeys.has(record.migrationKey)) {
          skipped.push({
            index,
            title: String(event && event.title || "").slice(0, 120),
            dateText: String(event && event.d || "").slice(0, 120),
            reason: "移行元キーが重複または未設定です",
          });
          return;
        }
        seenMigrationKeys.add(record.migrationKey);
        validated.migrationKey = record.migrationKey;
        if (migrationWarning) validated.migrationWarning = migrationWarning;
        records.push(validated);
      });
    } catch (error) {
      skipped.push({
        index,
        title: String(event && event.title || "").slice(0, 120),
        dateText: String(event && event.d || "").slice(0, 120),
        reason: error.message,
      });
    }
  });
  const report = {
    reportId: options.reportId || "",
    sourceVersion: Number(options.sourceVersion || 1),
    sourceCount: Number.isInteger(options.sourceCount) ? options.sourceCount : events.length,
    recordCount: records.length,
    sourceRows: Array.isArray(options.sourceRows)
      ? options.sourceRows.map((row) => Array.isArray(row) ? row.slice() : row)
      : [],
    warnings,
    skipped,
    ready: warnings.length === 0 && skipped.length === 0 && records.length > 0,
    records,
  };
  report.reportId = report.reportId || migrationReportId(report);
  return report;
}

function buildMigrationReportFromLegacyRows(rows, year) {
  if (!Array.isArray(rows)) throw new Error("旧イベント行が不正です");
  const parseSkipped = [];
  const rowsForParsing = rows.map((row, index) => {
    const source = String((row && row[1]) || "").trim();
    const malformedRange = /^\d{1,2}\s*[\/／]\s*\d{1,2}\s*[-ー–—〜~]\s*\d{1,2}(?:\s|$)/.test(source);
    if (!malformedRange) return row;
    parseSkipped.push({ line: index + 1, text: source, reason: "開催日の範囲を解釈できません" });
    const copy = Array.isArray(row) ? row.slice() : [];
    copy[1] = "";
    return copy;
  });
  const events = require("./parse_events.js").parseEvents(rowsForParsing, { year, skipped: parseSkipped });
  const skipped = parseSkipped.map((item) => ({
    line: item.line,
    text: item.text,
    reason: item.reason || "旧形式のイベント行を解釈できません",
  }));
  return buildMigrationReport(events, year, {
    sourceVersion: 1,
    sourceCount: rows.length,
    sourceRows: rows,
    skipped,
  });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value == null || value.startsWith("--")) args[key] = true;
    else { args[key] = value; i++; }
  }
  return args;
}

function runCli(argv = process.argv) {
  const args = parseArgs(argv);
  const year = Number(args.year);
  if (!Number.isInteger(year)) throw new Error("--year は整数で指定してください");
  const inputPath = path.resolve(args.input || "_work/app_events.json");
  const events = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const report = buildMigrationReport(events, year);
  if (args.report) {
    const reportPath = path.resolve(args.report);
    writeAtomic(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write(JSON.stringify({
    sourceCount: report.sourceCount,
    recordCount: report.recordCount,
    warningCount: report.warnings.length,
  }) + "\n");
  return report;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error("ERROR:", error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildMigrationReport,
  buildMigrationReportFromLegacyRows,
  migrationReportId,
  parseArgs,
  runCli,
  writeAtomic,
};

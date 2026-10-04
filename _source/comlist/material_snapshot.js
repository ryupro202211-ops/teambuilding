"use strict";

const crypto = require("node:crypto");
const { validateEventList } = require("./event_records.js");

const SNAPSHOT_VERSION = 2;
const DEFAULT_MAX_AGE_MS = 3 * 60 * 60 * 1000;

function digestPayload(snapshot) {
  return {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    contacts: snapshot.contacts,
    events: snapshot.events,
    calendar: snapshot.calendar,
    counts: snapshot.counts
  };
}

function snapshotDigest(snapshot) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(digestPayload(snapshot)))
    .digest("hex");
}

function validateSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("GASスナップショットの形式が不正です");
  }
  if (snapshot.version !== SNAPSHOT_VERSION) {
    throw new Error("GASスナップショットのバージョンが不正です");
  }
  const generatedMs = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedMs)) {
    throw new Error("GASスナップショットの生成日時が不正です");
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const ageMs = now.getTime() - generatedMs;
  const maxAgeMs = Number.isFinite(options.maxAgeMs)
    ? options.maxAgeMs
    : DEFAULT_MAX_AGE_MS;
  if (ageMs < -5 * 60 * 1000) {
    throw new Error("GASスナップショットの生成日時が未来です");
  }
  if (ageMs > maxAgeMs) {
    throw new Error("GASスナップショットが古すぎます");
  }
  if (!Array.isArray(snapshot.contacts) || !snapshot.contacts.length) {
    throw new Error("GASスナップショットの連絡先が空です");
  }
  if (!Array.isArray(snapshot.events) || !Array.isArray(snapshot.calendar)) {
    throw new Error("GASスナップショットの素材形式が不正です");
  }
  const events = validateEventList(snapshot.events);
  require('./calendar_schedule').normalizeCalendar(snapshot.calendar);
  const actualCounts = {
    contacts: snapshot.contacts.length,
    events: events.length,
    calendar: snapshot.calendar.length
  };
  for (const key of Object.keys(actualCounts)) {
    if (!snapshot.counts || snapshot.counts[key] !== actualCounts[key]) {
      throw new Error("GASスナップショットの件数が一致しません: " + key);
    }
  }
  if (snapshot.digest !== snapshotDigest(snapshot)) {
    throw new Error("GASスナップショットのハッシュが一致しません");
  }
  return {
    contacts: snapshot.contacts,
    events,
    calendar: snapshot.calendar,
    counts: actualCounts,
    generatedAt: snapshot.generatedAt,
    ageMs
  };
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  SNAPSHOT_VERSION,
  snapshotDigest,
  validateSnapshot
};

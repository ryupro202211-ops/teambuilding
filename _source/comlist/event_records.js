"use strict";

const crypto = require("node:crypto");

const EVENT_STATUSES = new Set(["公開", "終了"]);
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const EVENT_ID_PREFIX = "evt_";
const MAX_EVENT_ID_LENGTH = 80;
const MAX_EVENT_ID_BODY_LENGTH = MAX_EVENT_ID_LENGTH - EVENT_ID_PREFIX.length;
const DERIVED_ID_HASH_LENGTH = 16;
const EVENT_ID_RE = new RegExp(`^${EVENT_ID_PREFIX}[A-Za-z0-9_-]{16,${MAX_EVENT_ID_BODY_LENGTH}}$`);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TITLE_LENGTH = 120;
const MAX_THEME_LENGTH = 120;
const MAX_PLACE_LENGTH = 200;
const MAX_URL_LENGTH = 500;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function isValidDate(date) {
  const match = date.match(DATE_RE);
  if (!match) return false;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return value.getUTCFullYear() === Number(match[1])
    && value.getUTCMonth() === Number(match[2]) - 1
    && value.getUTCDate() === Number(match[3]);
}

function assertHttpsUrl(value, label) {
  if (!value) return;
  if (!/^https:\/\/\S+$/.test(value)) throw new Error(`${label}が不正です`);
}

function normalizeEvent(input, { allowMissingId = false, allowMissingVersion = false } = {}) {
  if (!input || typeof input !== "object") throw new Error("イベントが不正です");

  const hasVersion = Object.prototype.hasOwnProperty.call(input, "version");
  const event = {
    id: text(input.id),
    status: text(input.status || "公開"),
    date: text(input.date),
    startTime: text(input.startTime),
    endTime: text(input.endTime),
    title: text(input.title),
    theme: text(input.theme),
    place: text(input.place),
    url: text(input.url),
    sheetUrl: text(input.sheetUrl),
    updatedAt: text(input.updatedAt),
    version: hasVersion ? input.version : 0,
  };

  if ((!allowMissingId && !EVENT_ID_RE.test(event.id)) || (allowMissingId && event.id && !EVENT_ID_RE.test(event.id))) {
    throw new Error("イベントIDが不正です");
  }
  if (!EVENT_STATUSES.has(event.status)) throw new Error("状態が不正です");
  if (!isValidDate(event.date)) throw new Error("開催日が不正です");
  if (event.startTime && !TIME_RE.test(event.startTime)) throw new Error("開始時刻が不正です");
  if (event.endTime && event.endTime!=='24:00' && !TIME_RE.test(event.endTime)) throw new Error("終了時刻が不正です");
  if (event.endTime && !event.startTime) throw new Error("開始時刻が必要です");
  if (event.startTime && event.endTime && event.endTime <= event.startTime) {
    throw new Error("終了時刻が開始時刻より前です");
  }
  if (!event.title || event.title.length > MAX_TITLE_LENGTH) throw new Error("タイトルが不正です");
  if (event.theme.length > MAX_THEME_LENGTH) throw new Error("テーマが不正です");
  if (event.place.length > MAX_PLACE_LENGTH) throw new Error("場所が不正です");
  assertHttpsUrl(event.url, "案内URL");
  assertHttpsUrl(event.sheetUrl, "集計シートURL");
  if (event.url.length > MAX_URL_LENGTH) throw new Error("案内URLが不正です");
  if (event.sheetUrl.length > MAX_URL_LENGTH || (event.sheetUrl && !/^https:\/\/docs\.google\.com\/spreadsheets\/.+$/.test(event.sheetUrl))) {
    throw new Error("集計シートURLが不正です");
  }
  if (hasVersion) {
    if (typeof event.version !== "number" || !Number.isInteger(event.version) || event.version <= 0) {
      throw new Error("更新番号が不正です");
    }
  } else if (!allowMissingVersion) {
    throw new Error("更新番号が不正です");
  }

  return event;
}

function dateParts(date) {
  const match = date.match(DATE_RE);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function eventToDisplay(event) {
  const normalized = normalizeEvent(event, { allowMissingId: true });
  const { year, month, day } = dateParts(normalized.date);
  const date = new Date(Date.UTC(year, month - 1, day));
  const display = {
    d: `${month}/${day}`,
    dow: DOW[date.getUTCDay()],
    t: normalized.startTime && normalized.endTime
      ? `${normalized.startTime}-${normalized.endTime}`
      : normalized.startTime,
    place: normalized.place,
    title: normalized.title,
    id: normalized.id,
    status: normalized.status,
    date: normalized.date,
    startTime: normalized.startTime,
    endTime: normalized.endTime,
    updatedAt: normalized.updatedAt,
    version: normalized.version,
  };
  if (normalized.theme) display.theme = normalized.theme;
  if (normalized.url) display.url = normalized.url;
  if (normalized.sheetUrl) display.sheet = normalized.sheetUrl;
  return display;
}

function dateFromParts(year, month, day) {
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isValidDate(date)) throw new Error("旧イベントの開催日が不正です");
  return date;
}

function parseLegacyDates(rawDate, year) {
  const source = text(rawDate);
  const first = source.match(/^(\d{1,2})\s*[\/／]\s*(\d{1,2})(.*)$/);
  if (!first) throw new Error("旧イベントの開催日が不正です");

  let month = Number(first[1]);
  let rest = first[3];
  const dates = [dateFromParts(year, month, Number(first[2]))];
  while (rest) {
    const separator = rest.match(/^[、,・]\s*/);
    if (!separator) throw new Error("旧イベントの開催日が不正です（未解釈の文字があります）");
    rest = rest.slice(separator[0].length);
    const fullDate = rest.match(/^(\d{1,2})\s*[\/／]\s*(\d{1,2})/);
    const next = fullDate
      ? { month: Number(fullDate[1]), day: Number(fullDate[2]), length: fullDate[0].length }
      : (() => {
        const day = rest.match(/^(\d{1,2})/);
        return day ? { month, day: Number(day[1]), length: day[0].length } : null;
      })();
    if (!next) throw new Error("旧イベントの開催日が不正です（未解釈の文字があります）");
    month = next.month;
    dates.push(dateFromParts(year, next.month, next.day));
    rest = rest.slice(next.length);
  }
  return dates;
}

function extractLegacySuffixDates(timeText, firstDate) {
  const match = timeText.match(/\((\d{1,2}(?:[、,・]\d{1,2})+)\)\s*$/);
  if (!match) return { timeText, days: [] };
  const { month } = dateParts(firstDate);
  const days = match[1].split(/[、,・]/).map(Number).map((day) => {
    const { year } = dateParts(firstDate);
    return dateFromParts(year, month, day);
  });
  return { timeText: timeText.slice(0, match.index).trim(), days };
}

function legacyTimeRange(rawTime) {
  const value = text(rawTime);
  const match = value.match(/^(\d{2}:\d{2})\s*[-ー–—〜~]\s*(\d{2}:\d{2})$/);
  if (!match || !TIME_RE.test(match[1]) || !TIME_RE.test(match[2]) || match[2] < match[1]) return null;
  return { startTime: match[1], endTime: match[2] };
}

function legacyRecordId(sourceId, date, index) {
  if (!sourceId || index === 0) return sourceId;
  const suffix = `_${date.replace(/-/g, "")}`;
  const hash = crypto.createHash("sha256").update(sourceId, "utf8").digest("hex").slice(0, DERIVED_ID_HASH_LENGTH);
  const stemLength = MAX_EVENT_ID_BODY_LENGTH - suffix.length - hash.length - 1;
  const stem = sourceId.slice(EVENT_ID_PREFIX.length, EVENT_ID_PREFIX.length + stemLength);
  return `${EVENT_ID_PREFIX}${stem}_${hash}${suffix}`;
}

function legacyEventToRecords(event, year) {
  if (!event || typeof event !== "object") throw new Error("旧イベントが不正です");
  if (!Number.isInteger(year)) throw new Error("旧イベントの移行年が必要です");
  const initialDates = parseLegacyDates(event.d, year);
  const rawTime = text(event.t);
  const suffix = extractLegacySuffixDates(rawTime, initialDates[0]);
  const dates = [...initialDates, ...suffix.days.filter((date) => !initialDates.includes(date))];
  if (new Set(dates).size !== dates.length) throw new Error("旧イベントの開催日が重複しています");
  const range = legacyTimeRange(suffix.timeText);
  const warning = suffix.timeText && !range ? `時刻「${suffix.timeText}」は開始・終了時刻へ変換できません` : "";

  return dates.map((date, index) => {
    const record = normalizeEvent({
      id: legacyRecordId(text(event.id), date, index),
      status: event.status || "公開",
      date,
      startTime: range ? range.startTime : "",
      endTime: range ? range.endTime : "",
      title: event.title,
      theme: event.theme,
      place: event.place,
      url: event.url,
      sheetUrl: event.sheetUrl || event.sheet,
      updatedAt: event.updatedAt,
      version: Number.isInteger(Number(event.version)) && Number(event.version) > 0 ? Number(event.version) : 1,
    }, { allowMissingId: true });
    const source = event.__legacySource;
    const migrationIdentity = source
      ? { text: text(source.text), date, title: text(event.title), theme: text(event.theme), time: text(event.t), place: text(event.place) }
      : event.id
        ? { id: text(event.id), date }
        : {
            date,
            d: text(event.d),
            t: text(event.t),
            title: text(event.title),
            theme: text(event.theme),
            place: text(event.place),
            url: text(event.url),
            sheetUrl: text(event.sheetUrl || event.sheet),
          };
    record.migrationKey = `migsrc_${crypto.createHash("sha256")
      .update(JSON.stringify(migrationIdentity), "utf8")
      .digest("hex")
      .slice(0, 32)}`;
    if (warning) record.migrationWarning = warning;
    return record;
  });
}

function validateEventList(events) {
  if (!Array.isArray(events)) throw new Error("イベント一覧が不正です");
  const ids = new Set();
  return events.map((event) => {
    const normalized = normalizeEvent(event);
    if (ids.has(normalized.id)) throw new Error("イベントIDが重複しています");
    ids.add(normalized.id);
    return normalized;
  });
}

module.exports = {
  normalizeEvent,
  eventToDisplay,
  legacyEventToRecords,
  validateEventList,
};

'use strict';

function decodeBase64Url(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function headerValueFromHeaders(headers, name) {
  if (!Array.isArray(headers)) return '';
  const header = headers.find(item => String(item?.name || '').toLowerCase() === name.toLowerCase());
  return header?.value == null ? '' : String(header.value);
}

function isAttachmentPart(part) {
  if (!part || typeof part !== 'object') return false;
  if (String(part.filename || '').trim()) return true;
  if (/\battachment\b/i.test(headerValueFromHeaders(part.headers, 'Content-Disposition'))) return true;
  return String(part.mimeType || '').toLowerCase() === 'message/rfc822';
}

function textBodyParts(payload) {
  const result = [];

  function visit(part) {
    if (!part || typeof part !== 'object' || isAttachmentPart(part)) return;
    const mimeType = String(part.mimeType || '').toLowerCase();
    if (mimeType === 'text/plain' || mimeType === 'text/html') result.push(part);
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) visit(child);
    }
  }

  visit(payload);
  return result;
}

function htmlToText(value) {
  return String(value || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/?\s*(?:address|article|aside|blockquote|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function extractMessageText(payload) {
  const plainParts = [];
  const htmlParts = [];

  for (const part of textBodyParts(payload)) {
    const body = part.body && typeof part.body === 'object' ? part.body : {};
    const mimeType = String(part.mimeType || '').toLowerCase();
    if (typeof body.data === 'string') {
      if (body.data.length === 0 && Number(body.size) > 0) throw new Error('Gmail body unavailable');
      if (mimeType === 'text/plain') plainParts.push(decodeBase64Url(body.data));
      if (mimeType === 'text/html') htmlParts.push(decodeBase64Url(body.data));
      continue;
    }
    if (body.attachmentId || Number(body.size) > 0) throw new Error('Gmail body unavailable');
    if (mimeType === 'text/plain') plainParts.push('');
    if (mimeType === 'text/html') htmlParts.push('');
  }

  if (plainParts.length > 0) return plainParts[0];
  if (htmlParts.length === 0) return '';
  return htmlToText(htmlParts[0]);
}

function firstActionLines(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const result = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('>')) continue;
    if (
      line.startsWith('---') ||
      line.startsWith('___') ||
      /^20\d{2}年\d{1,2}月\d{1,2}日/.test(line) ||
      /^On 20\d{2}\b/.test(line)
    ) break;

    result.push(line);
    if (result.length === 3) break;
  }

  return result;
}

const MONITORED_MEMBERS = [
  'のんちゃん',
  'のぞみーる',
  'つなこ',
  'ノスタ',
  'シェフ富徳',
  'お笑いマサ',
  'ラブリー',
  'トムキャット',
  'ジャノン',
];

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) throw new Error('invalid today date');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('invalid today date');
  }

  return { year, month, day, date };
}

function calendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseContinuationLine(line, today) {
  const normalizedLine = String(line || '').trim();
  if (!normalizedLine.startsWith('【継続】')) return null;

  const match = /^【継続】\s*(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?\s+(.+?)\s*$/.exec(normalizedLine);
  if (!match) throw new Error('invalid continuation date or line');

  const todayParts = parseIsoDate(today);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const hour = match[3] == null ? null : Number(match[3]);
  const minute = match[4] == null ? null : Number(match[4]);
  const isEndOfDay = hour === 24 && minute === 0;
  if (hour !== null && (!isEndOfDay && (hour > 23 || minute > 59))) {
    throw new Error('invalid continuation date or time');
  }

  const candidates = [todayParts.year - 1, todayParts.year, todayParts.year + 1]
    .map(year => {
      const date = calendarDate(year, month, day);
      if (!date) return null;
      return { year, date, distance: Math.abs(date.getTime() - todayParts.date.getTime()) };
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance);
  if (candidates.length === 0) throw new Error('invalid continuation date');

  const chosen = candidates[0];
  const due = `${chosen.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const todayNumber = todayParts.date.getTime();
  const dueNumber = chosen.date.getTime();
  const dayDifference = Math.round((todayNumber - dueNumber) / 86400000);
  const dueDisplay = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`
    + (hour === null ? '' : ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  const ownerText = match[5];
  const self = ownerText.includes('りゅうちゃん');
  const monitored = ownerText.match(new RegExp(MONITORED_MEMBERS.join('|'), 'g')) || [];
  if (dayDifference > 0 && !self && monitored.length === 0) return null;
  const owner = self ? 'りゅうちゃん' : monitored.length > 0 ? monitored.join('・') : ownerText.trim();

  let section = 'upcoming';
  if (dayDifference > 0) {
    section = self ? 'selfOverdue' : 'memberOverdue';
  } else if (dayDifference === 0) {
    section = 'today';
  }

  return {
    due,
    dueDisplay,
    section,
    overdueDays: Math.max(dayDifference, 0),
    owner,
  };
}

function headerValue(message, name) {
  const headers = message?.payload?.headers;
  if (!Array.isArray(headers)) return '';
  const header = headers.find(item => String(item?.name || '').toLowerCase() === name.toLowerCase());
  return header?.value == null ? '' : String(header.value);
}

function messageActionLines(message) {
  return firstActionLines(extractMessageText(message?.payload));
}

function threadToTasks(thread, today) {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  if (messages.length === 0) return [];

  let latestIndex = -1;
  let latestTimestamp = -Infinity;
  for (let index = 0; index < messages.length; index += 1) {
    const timestamp = Number(messages[index]?.internalDate);
    if (Number.isFinite(timestamp) && timestamp >= latestTimestamp) {
      latestIndex = index;
      latestTimestamp = timestamp;
    }
  }
  if (latestIndex < 0) throw new Error('invalid Gmail internalDate');

  const latest = messages[latestIndex];
  const latestLines = messageActionLines(latest);
  const latestContinuations = latestLines.filter(line => line.startsWith('【継続】'));
  const latestCompletions = latestLines.filter(line => line.startsWith('【完了】'));
  const earlierContinuationLines = [];
  let latestEarlierContinuationMessage = null;
  let latestEarlierContinuationLines = [];
  let latestEarlierContinuationTimestamp = -Infinity;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (index === latestIndex || Number(message?.internalDate) >= latestTimestamp) continue;
    const continuationLines = messageActionLines(message).filter(line => line.startsWith('【継続】'));
    earlierContinuationLines.push(...continuationLines);
    const timestamp = Number(message?.internalDate);
    if (continuationLines.length > 0 && timestamp >= latestEarlierContinuationTimestamp) {
      latestEarlierContinuationMessage = message;
      latestEarlierContinuationLines = continuationLines;
      latestEarlierContinuationTimestamp = timestamp;
    }
  }
  for (const line of earlierContinuationLines) parseContinuationLine(line, today);
  const hasEarlierContinuation = earlierContinuationLines.length > 0;

  let activeContinuations = latestContinuations;
  let titleMessage = latest;
  if (latestCompletions.length > 0) {
    if (hasEarlierContinuation && !headerValue(latest, 'To').toLowerCase().includes('cuc.member')) {
      activeContinuations = latestEarlierContinuationLines;
      titleMessage = latestEarlierContinuationMessage || latest;
    } else {
      return [];
    }
  }
  if (activeContinuations.length === 0) return [];

  const title = headerValue(titleMessage, 'Subject');
  const grouped = new Map();
  for (const line of activeContinuations) {
    const parsed = parseContinuationLine(line, today);
    if (!parsed) continue;
    const key = `${title.replace(/\s+/gu, '').toLowerCase()}|${parsed.due}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.owners.push(parsed.owner);
      existing.overdueDays = Math.max(existing.overdueDays, parsed.overdueDays);
      if (parsed.section === 'selfOverdue') existing.section = parsed.section;
    } else {
      grouped.set(key, { ...parsed, owners: [parsed.owner] });
    }
  }

  return [...grouped.values()].map(parsed => {
    const owners = [...new Set(parsed.owners.flatMap(owner => owner.split('・').map(item => item.trim()).filter(Boolean)))];
    const owner = owners.join('・');
    return {
      id: `gmail:${thread.id}:${parsed.due}`,
      type: 'gmail',
      title,
      detail: `期限 ${parsed.dueDisplay}・担当 ${owner}`,
      due: parsed.due,
      section: parsed.section,
      overdueDays: parsed.overdueDays,
      owner,
      priority: null,
      url: `https://mail.google.com/mail/u/0/#all/${thread.id}`,
    };
  });
}

module.exports = {
  decodeBase64Url,
  extractMessageText,
  isAttachmentPart,
  textBodyParts,
  firstActionLines,
  parseContinuationLine,
  threadToTasks,
  MONITORED_MEMBERS,
};

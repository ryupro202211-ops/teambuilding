"use strict";

const METRICS = ["orientation", "introductions", "individual", "first_individual", "new_friends"];

function validateFieldProgress(input) {
  if (!input || !Array.isArray(input.months) || !input.months.length) throw new Error("現場数の月別データがありません");
  const seen = new Set();
  const months = input.months.map((record) => {
    if (!record || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(record.month) || seen.has(record.month)) {
      throw new Error("現場数の月が不正または重複しています");
    }
    seen.add(record.month);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(record.activityDate) ||
        record.activityDate.slice(0, 7) !== record.month ||
        !/^20\d{2}-\d{2}-\d{2}$/.test(record.reportDate) ||
        !/^https:\/\/app\.notion\.com\/[a-zA-Z0-9/?=&-]+$/.test(record.url || "")) {
      throw new Error("現場数の日付または出典が不正です: " + record.month);
    }
    const values = {};
    const goals = {};
    for (const key of METRICS) {
      const value = record.values?.[key];
      const goal = record.goals?.[key];
      if (value !== null && (!Number.isInteger(value) || value < 0)) throw new Error("現場数が不正です: " + key);
      if (goal !== null && (!Number.isInteger(goal) || goal <= 0)) throw new Error("現場数の目標が不正です: " + key);
      values[key] = value;
      goals[key] = goal;
    }
    return {
      month: record.month, activityDate: record.activityDate, reportDate: record.reportDate,
      url: record.url, partial: Boolean(record.partial), values, goals
    };
  });
  months.sort((a, b) => a.month.localeCompare(b.month));
  const dayMap = new Map();
  if (input.days !== undefined && !Array.isArray(input.days)) throw new Error("現場数の日別データが不正です");
  for (const record of input.days || []) {
    const validDate = s => typeof s === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s;
    if (!validDate(record?.activityDate) || !validDate(record.reportDate) || !/^https:\/\/app\.notion\.com\/[a-zA-Z0-9/?=&-]+$/.test(record.url || '')) throw new Error('現場数の日別の日付または出典が不正です');
    const values = {};
    for (const key of METRICS) {
      const value = record.values?.[key];
      if (value !== null && (!Number.isInteger(value) || value < 0)) throw new Error('現場数の日別の数値が不正です: '+key);
      values[key] = value;
    }
    const previous = dayMap.get(record.activityDate);
    if (!previous || previous.reportDate < record.reportDate) dayMap.set(record.activityDate, {activityDate:record.activityDate, reportDate:record.reportDate, url:record.url, values});
  }
  const result = { months };
  if (input.days !== undefined) result.days = [...dayMap.values()].sort((a,b)=>a.activityDate.localeCompare(b.activityDate));
  return result;
}

module.exports = { METRICS, validateFieldProgress };

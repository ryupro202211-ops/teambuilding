"use strict";
/**
 * イベントシートの生の行を、アプリの EVENTS 配列に変換する。
 *
 * 入力: [[A,B,C], ...]  B列が本文、C列は「集計シート」行のURL
 * 出力: {d,dow,t,place,title,theme?,url?,sheet?}[] を日付昇順で
 *
 * 副作用を持たない純粋関数。規則は _引き継ぎ手順書.md §2 の退避手順に対応する。
 * 以前は毎朝この規則を人（LLM）が読んで解釈していた。ここが正本になる。
 */

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

function isUrl(s) { return /^https?:\/\//.test(s); }

// 「テーマ：xxx」の接頭辞だけ落とす。「交流飲み会」のような説明はそのまま。
function normTheme(raw) {
  return String(raw || "").replace(/^\s*テーマ\s*[:：]\s*/, "").trim();
}

function calcDow(month, day, year) {
  return DOW[new Date(year, month - 1, day).getDay()];
}

// 日付行を RE_DATELINE / RE_SINGLE に通す前の正規化。
// 実データには brief 想定の「M/D(曜)HH:MM-HH:MM@場所」以外に、
// 以下のゆらぎが実在するため、ここで吸収してから本体の正規表現にかける。
//   - 全角コロン「：」を日付と時刻の区切りに使う（例: 8月27日(水)：20:00-22:00）
//   - 月日を漢字で書く（例: 8月27日 → 8/27）
//   - 複数日を「9/22、23」「9/22・23」のように書く（開始日だけを残し、
//     残りの日は extraDays として返す。呼び出し側が t に "(22・23)" として畳み込む。
//     区切り文字は全角読点「、」・半角カンマ「,」・中点「・」に対応する）
// 戻り値: { text: 正規化後の文字列, extraDays: string[] }
function normalizeDateline(b) {
  let s = b;
  s = s.replace(/：/g, " ");
  s = s.replace(/^(\d{1,2})月(\d{1,2})日/, "$1/$2");
  let extraDays = [];
  s = s.replace(/^(\d{1,2}\/\d{1,2})((?:[、,・]\d{1,2})+)(?=\s|$)/, (whole, head, tail) => {
    extraDays = tail.match(/\d{1,2}/g) || [];
    return head;
  });
  return { text: s, extraDays };
}

// 複数日イベントの t に "(22・23)" のように開始日を含めた全日程を畳み込む。
function withExtraDays(t, day, extraDays) {
  if (!extraDays || !extraDays.length) return t;
  return t + "(" + [String(Number(day))].concat(extraDays.map((x) => String(Number(x)))).join("・") + ")";
}

// 「8/15(土) 19:00-21:00 @浜松町」形式。曜日と@場所は省略されうる。
// 時刻部分は @ と ＠ を含まない文字クラスにする（貪欲な \S+ だと "19:00-21:00@浜松町" を
// まるごと飲み込んでしまい、@ の前に空白が無い実データで場所が取れなくなるため）。
// 曜日の丸カッコと時刻の間の空白も、無い実データがあるので任意（\s*）にする。
const RE_DATELINE = /^(\d{1,2})\/(\d{1,2})(?:\s*[（(]\s*(.)\s*[）)])?\s*([^@＠\s]+)(?:\s*[@＠]\s*(.+))?$/;
// 「10/31 11:00-18:00 イタリア街ハロウィン@場所」形式。
const RE_SINGLE = /^(\d{1,2})\/(\d{1,2})\s+([^@＠\s]+)\s+([^@＠]+?)(?:\s*[@＠]\s*(.+))?$/;
// 「■タイトル（テーマ）」形式。
const RE_HEADER = /^■\s*([^（(]+?)\s*(?:[（(]\s*(.+?)\s*[）)])?\s*$/;

function makeEvent(m, title, theme, year) {
  const ev = {
    d: Number(m[1]) + "/" + Number(m[2]),
    dow: m[3] || calcDow(Number(m[1]), Number(m[2]), year),
    t: m[4],
    place: (m[5] || "").trim(),
    title: title
  };
  if (theme) ev.theme = theme;
  return ev;
}

function attachLegacySource(event, line, text) {
  Object.defineProperty(event, "__legacySource", {
    value: { line, text },
    enumerable: false,
    configurable: true,
  });
  return event;
}

/**
 * @param rows 生の行
 * @param opts.year 年（省略時は現在年）
 * @param opts.skipped 配列を渡すと、解釈できなかった行を {line, text} で積む
 */
function parseEvents(rows, opts) {
  const year = (opts && opts.year) || new Date().getFullYear();
  const skipped = opts && Array.isArray(opts.skipped) ? opts.skipped : null;
  const out = [];
  let pending = null;   // 直前に読んだ ■見出し
  let last = null;      // 直近で確定したイベント

  const flushPending = () => {
    if (!pending || !skipped) return;
    skipped.push({
      line: pending.line,
      text: pending.text,
      reason: "見出しに対応する開催行がありません",
    });
    pending = null;
  };

  const list = rows || [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const b = String((row && row[1]) || "").trim();
    const c = String((row && row[2]) || "").trim();
    if (!b) continue;

    if (b === "集計シート") {
      if (last && c) last.sheet = c;
      continue;
    }
    if (isUrl(b)) {
      if (last) last.url = b;
      continue;
    }

    const h = b.match(RE_HEADER);
    if (h) {
      flushPending();
      pending = { title: h[1].trim(), theme: normTheme(h[2]), line: i + 1, text: b };
      continue;
    }

    const norm = normalizeDateline(b);
    const bn = norm.text;

    const d = bn.match(RE_DATELINE);
    if (d && pending) {
      last = attachLegacySource(
        makeEvent(d, pending.title, pending.theme, year),
        pending.line,
        pending.text,
      );
      last.t = withExtraDays(last.t, d[2], norm.extraDays);
      out.push(last);
      pending = null;
      continue;
    }

    const s = bn.match(RE_SINGLE);
    if (s) {
      // 単一行形式は [日, 月, 時刻, タイトル, 場所] の並びなので詰め替える
      flushPending();
      last = attachLegacySource(
        makeEvent([s[0], s[1], s[2], null, s[3], s[5]], s[4].trim(), "", year),
        i + 1,
        b,
      );
      last.t = withExtraDays(last.t, s[2], norm.extraDays);
      out.push(last);
      pending = null;
      continue;
    }
    // 解釈できない行は黙って捨てない。呼び出し側が報告できるよう記録する。
    flushPending();
    if (skipped) skipped.push({ line: i + 1, text: b.slice(0, 40) });
  }

  flushPending();

  const key = (e) => {
    const [m, dd] = e.d.split("/").map(Number);
    return m * 100 + dd;
  };
  return out.sort((a, b2) => key(a) - key(b2));
}

module.exports = { parseEvents };


/* ============================================================
   スプレッドシート更新API（書き込み）
   - API_URL は Apps Script ウェブアプリの /exec。トークンが無いと弾かれるので
     公開HTMLに載っていても実害はない（空なら編集ボタン自体を出さない）。
   - 書き込み用の合言葉（Apps Script の スクリプトプロパティ API_TOKEN）は
     HTMLには絶対に載せず、初回入力してこの端末のlocalStorageにだけ保存する。
     こうしておくと閲覧用パスフレーズが漏れても書き込みは守られる。
   ============================================================ */
const API_URL = "https://script.google.com/macros/s/AKfycbzPbYrccXmQcGZX9LmSwGUpn5nhqslJvhstwjVjvL8RR7LjnI94C_4udh7fxV9LfRFI/exec";  // ← Apps Script ウェブアプリの /exec URL を貼る
const WRITE_TOKEN_KEY = "comunitylisttolevel9";
/* 📅 カレンダータブに埋め込む Google カレンダー。自分のカレンダーを表示する。
   ・別のカレンダーにするなら src= の後ろを対象のカレンダーID（メールアドレス）に変える。
   ・自分の非公開カレンダーは「その Google アカウントでログインしている端末」でだけ予定が見える。
   ・空文字 "" にするとカレンダータブは表示されない。 */
const CALENDAR_EMBED_URL = "https://calendar.google.com/calendar/embed?src=ryuhei.otsuka%40gmail.com&ctz=Asia%2FTokyo&mode=WEEK&wkst=2&hl=ja&showTitle=0";
const ACTION_OPTIONS = ["", "状況確認", "予定確認", "リマインド", "来月のお誘い", "久しぶりLINE", "イベントの確認"];
let PANEL_EDIT = false;
let PANEL_EDIT_KEY = null;

function getWriteToken(){ try { return localStorage.getItem(WRITE_TOKEN_KEY) || ""; } catch(e){ return ""; } }
function setWriteToken(t){ try { if(t) localStorage.setItem(WRITE_TOKEN_KEY, t); else localStorage.removeItem(WRITE_TOKEN_KEY); } catch(e){} }
function askWriteToken(){
  var t = window.prompt("書き込み用の合言葉を入力してください（この端末にだけ保存されます）");
  t = t ? t.trim() : "";
  if(t) setWriteToken(t);
  return t;
}
function canEdit(o){ return !!(API_URL && o && o._row); }

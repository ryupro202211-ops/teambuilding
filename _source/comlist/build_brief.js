/**
 * 朝ブリーフ ビルダー（テンプレート方式）
 *
 *   _assets/brief_template.html … 見た目（CSS・ヘッダー・ロック画面の器）
 *   _assets/brief_hero.jpg      … ヘッダー背景（Pollinations生成・data URIで埋め込む）
 *   _assets/brief_lock.jpg      … ロック画面背景（同上）
 *   --sections で渡すHTML        … その日の中身（カード群）だけをエージェントが書く
 *
 * 使い方:
 *   node build_brief.js \
 *     --today 2026-09-02 --dayjp "2026年9月2日（水）" \
 *     --self 7 --mem 5 \
 *     --quote "過ちて改めざる、是を過ちと謂う" --source "孔子『論語・衛霊公』" \
 *     --sections _work/brief_sections.html \
 *     --pass levelup --out morningblief.html
 *
 * やること:
 *   HP自動計算 → テンプレートへ差し込み → <body>内側をAES-256-GCMで暗号化 →
 *   ロック画面つき単一HTMLを出力 → 自己検証（VERIFY_RESULT: OK まで出す）
 *
 * ★HPは必ずここで計算する。--self / --mem は「行数」であって人数ではない。
 *   1行に複数名が並んでいても1件。
 * ★--self / --mem と、sections内の data-id="self-*" / "mem-*" の数が食い違うと止まる。
 *   （HPの根拠と実際の行がズレたまま公開されるのを防ぐため）
 */
const fs = require("fs");
const path = require("path");
const briefIcons = require('./brief_icons');
const { webcrypto: crypto } = require("node:crypto");

// ---- 引数 ----
const ARGS = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = process.argv[i + 1];
    if (v === undefined || v.startsWith("--")) { ARGS[k] = true; }
    else { ARGS[k] = v; i++; }
  }
}
const need = (k) => {
  if (ARGS[k] === undefined || ARGS[k] === true) throw new Error("必須オプションが無い: --" + k);
  return ARGS[k];
};

const TODAY   = need("today");                       // 2026-09-02
const DAYJP   = need("dayjp");                       // 2026年9月2日（水）
const SELF    = parseInt(need("self"), 10);          // 自分の期限切れ 行数
const MEM     = parseInt(need("mem"), 10);           // メンバー切れ 行数
const QUOTE   = need("quote");
const QSOURCE = need("source");
const SECTS   = need("sections");
const PASS    = ARGS.pass || "levelup";
const OUT     = ARGS.out || "morningblief.html";
const TPL     = ARGS.template || "_assets/brief_template.html";
const HERO    = ARGS.hero || "_assets/brief-hero-morning-v2.jpg";
const LOCK    = ARGS.lock || "_assets/brief_lock.jpg";
const ITER    = 250000;

if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) throw new Error("--today は YYYY-MM-DD: " + TODAY);
if (!Number.isInteger(SELF) || SELF < 0) throw new Error("--self が不正: " + ARGS.self);
if (!Number.isInteger(MEM) || MEM < 0) throw new Error("--mem が不正: " + ARGS.mem);

// 平文で残っていてはいけない実データ値（手順書 §8 の検証リスト）
const LEAK_WORDS = ["つなこ","のぞみーる","ノスタ","ラブリー","シェフ富徳","お笑いマサ","BEATONE","トムキャット","ジャノン"];

// ---- HP（毎朝100にリセット / 0〜100でクランプ）----
const hpRaw = 100 - SELF * 10 - MEM * 5;
const HP = Math.max(0, Math.min(100, hpRaw));
const HPCLASS = HP >= 80 ? "ok" : HP >= 50 ? "warn" : "bad";
const HPNOTE = `自分の期限切れ ${SELF}件 ×-10 ／ メンバー切れ ${MEM}件 ×-5 ／ 毎朝100にリセット`;

// ---- 素材 ----
for (const f of [TPL, HERO, LOCK, SECTS]) {
  if (!fs.existsSync(f)) throw new Error("ファイルが無い: " + f);
}
const dataUri = (p) => "data:image/" + (path.extname(p).toLowerCase() === '.png' ? 'png' : 'jpeg') + ";base64," + fs.readFileSync(p).toString("base64");
const sections = fs.readFileSync(SECTS, "utf8").trim();
if (!sections) throw new Error("--sections が空: " + SECTS);

// sections と HP の根拠が一致しているか（ズレたまま公開させない）
const cntSelf = (sections.match(/data-id="self-/g) || []).length;
const cntMem  = (sections.match(/data-id="mem-/g)  || []).length;
if (cntSelf !== SELF) throw new Error(`--self=${SELF} だが sections の self-* は ${cntSelf} 件。HPの根拠と行が食い違っている`);
if (cntMem !== MEM)   throw new Error(`--mem=${MEM} だが sections の mem-* は ${cntMem} 件。HPの根拠と行が食い違っている`);

// ---- テンプレートへ差し込み ----
let html = fs.readFileSync(TPL, "utf8");
const put = (token, value) => {
  if (html.indexOf(token) === -1) throw new Error("差し込み失敗: " + token + " がテンプレートに無い");
  html = html.split(token).join(value);
};
put("__HERO_DATA__", dataUri(HERO));
put("__DAYJP__", DAYJP);
put("__HP__", String(HP));
put("__HPPCT__", String(HP));
put("__HPCLASS__", HPCLASS);
put("__HPNOTE__", HPNOTE);
put("__QUOTE__", QUOTE);
put("__QSOURCE__", QSOURCE);
put("__SECTIONS__", sections);
html = briefIcons.replaceIcons(html);
html = html.replace('</style>', briefIcons.css() + '</style>');
const left = html.match(/__[A-Z_]+__/g);
if (left) throw new Error("未置換のプレースホルダが残っている: " + [...new Set(left)].join(", "));

const styleM = html.match(/<style>[\s\S]*?<\/style>/);
if (!styleM) throw new Error("テンプレートに <style> が無い");
const style = styleM[0];
const bodyM = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
if (!bodyM) throw new Error("テンプレートに <body> が無い");
const bodyInner = bodyM[1];

// ---- 暗号化 → 出力 → 自己検証 ----
(async () => {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const derive = async (pass, usage) => {
    const bk = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
      bk, { name: "AES-GCM", length: 256 }, false, usage);
  };
  const key = await derive(PASS, ["encrypt", "decrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(bodyInner)));
  const b64 = (u8) => Buffer.from(u8).toString("base64");
  const ENC = { salt: b64(salt), iv: b64(iv), ct: b64(ct), it: ITER };

  const out = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>朝ブリーフ</title>
${style}
<style>
#lockgate{position:fixed;inset:0;color:#fff;display:flex;align-items:center;justify-content:center;
 z-index:999;padding:22px;overflow:hidden}
#lockbg{position:absolute;inset:0;z-index:-2;background-image:url(${dataUri(LOCK)});
 background-size:cover;background-position:center;transform:scale(1.06);filter:saturate(1.05)}
#lockbg::after{content:"";position:absolute;inset:0;
 background:linear-gradient(180deg,rgba(16,12,40,.42) 0%,rgba(20,14,48,.62) 55%,rgba(14,9,34,.80) 100%)}
#lockcard{background:rgba(255,255,255,.11);border:1px solid rgba(255,255,255,.2);
 border-radius:20px;padding:34px 26px 28px;max-width:352px;width:100%;text-align:center;
 backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
 box-shadow:0 20px 60px rgba(8,4,26,.45)}
#lockcard h2{margin:0 0 6px;font-size:23px;font-weight:800;letter-spacing:.04em;
 text-shadow:0 2px 16px rgba(8,4,26,.5)}
#lockdate{font-size:12.5px;opacity:.88;margin-bottom:24px;letter-spacing:.1em}
#pw{width:100%;padding:13px 14px;border-radius:11px;font-size:16px;margin-bottom:11px;
 font-family:inherit;text-align:center;letter-spacing:.12em;
 background:rgba(255,255,255,.94);border:1px solid rgba(255,255,255,.5);color:#161b2e;
 transition:box-shadow .2s}
#pw:focus{outline:none;box-shadow:0 0 0 3px rgba(255,255,255,.32)}
#go{width:100%;padding:13px;border-radius:11px;border:none;cursor:pointer;font-family:inherit;
 background:linear-gradient(135deg,#4b4fd6,#a13fc4 60%,#c2379b);color:#fff;
 font-size:15px;font-weight:800;letter-spacing:.1em;
 box-shadow:0 8px 24px rgba(90,40,160,.45);transition:transform .12s,box-shadow .2s,opacity .2s}
#go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 12px 30px rgba(90,40,160,.55)}
#go:disabled{opacity:.55;cursor:default}
#err{font-size:12.5px;margin-top:13px;min-height:18px;color:#ffd0d4;letter-spacing:.03em}
</style>
</head>
<body>
<div id="content"></div>
<div id="lockgate"><div id="lockbg"></div><div id="lockcard">
  <h2>${briefIcons.icon('🔒')} 朝ブリーフ</h2>
  <div id="lockdate">${DAYJP}</div>
  <input id="pw" type="password" autocomplete="off" placeholder="パスフレーズ">
  <button id="go">開く</button>
  <div id="err"></div>
</div></div>
<script>
/* ★本文は復号後に innerHTML で差し込むため、本文内の <script> は実行されない。
   wire()/refresh()/loadState/saveState は必ずこの外側スクリプトに置くこと。 */
const ENC=${JSON.stringify(ENC)};
const SKEY='brief-${TODAY}';
function b642u8(s){const b=atob(s);const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}
function loadState(){try{return JSON.parse(localStorage.getItem(SKEY)||'{}')}catch(e){return{}}}
function saveState(s){try{localStorage.setItem(SKEY,JSON.stringify(s))}catch(e){}}
function refresh(){
  const boxes=[...document.querySelectorAll('#content input[type=checkbox]')];
  let selfLeft=0,memLeft=0,left=0;
  boxes.forEach(b=>{
    const id=b.dataset.id||'';
    if(!b.checked){left++;if(id.startsWith('self-'))selfLeft++;else if(id.startsWith('mem-'))memLeft++;}
    const lab=b.closest('label'); if(lab) lab.classList.toggle('done',b.checked);
  });
  let hp=100-selfLeft*10-memLeft*5;
  hp=Math.max(0,Math.min(100,hp));
  const v=document.getElementById('hpval'); if(v) v.textContent=hp;
  const f=document.getElementById('hpfill');
  if(f){f.style.width=hp+'%';f.className='hpfill '+(hp>=80?'ok':hp>=50?'warn':'bad');}
  const n=document.getElementById('hpnote');
  if(n) n.textContent='自分の期限切れ '+selfLeft+'件 ×-10 ／ メンバー切れ '+memLeft+'件 ×-5 ／ 毎朝100にリセット';
  const p=document.getElementById('prog');
  if(p) { if(left===0) p.innerHTML = ${JSON.stringify(briefIcons.icon('🎉') + ' 全部やりきった！')}; else p.textContent='残り '+left+' 件'; }
}
function wire(){
  const st=loadState();
  document.querySelectorAll('#content input[type=checkbox]').forEach(b=>{
    const id=b.dataset.id; if(id&&st[id])b.checked=true;
    b.addEventListener('change',()=>{
      const s=loadState();
      if(b.checked)s[b.dataset.id]=1;else delete s[b.dataset.id];
      saveState(s); refresh();
    });
  });
  refresh();
}
async function unlock(){
  const btn=document.getElementById('go'), err=document.getElementById('err');
  const pass=document.getElementById('pw').value;
  btn.disabled=true; err.textContent='復号中…';
  try{
    const enc=new TextEncoder();
    const bk=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b642u8(ENC.salt),iterations:ENC.it,hash:'SHA-256'},
      bk,{name:'AES-GCM',length:256},false,['decrypt']);
    const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b642u8(ENC.iv)},key,b642u8(ENC.ct));
    document.getElementById('content').innerHTML=new TextDecoder().decode(pt);
    document.getElementById('lockgate').style.display='none';
    err.textContent='';
    wire();
  }catch(e){
    err.textContent='パスフレーズが違います';
    btn.disabled=false;
  }
}
document.getElementById('go').addEventListener('click',unlock);
document.getElementById('pw').addEventListener('keydown',e=>{if(e.key==='Enter')unlock();});
document.getElementById('pw').focus();
</script>
</body>
</html>
`;
  fs.writeFileSync(OUT, out, "utf8");

  // ---- 自己検証 ----
  const errs = [];
  const written = fs.readFileSync(OUT, "utf8");

  // 1. 平文リーク
  const leaked = LEAK_WORDS.filter((w) => written.indexOf(w) !== -1);
  if (leaked.length) errs.push("平文リーク: " + leaked.join(", "));

  // 2. 正しいパスで戻り、必須セクションが入っている
  const m = written.match(/const ENC=(\{[\s\S]*?\});/);
  if (!m) errs.push("ENC が出力に無い");
  else {
    const E = JSON.parse(m[1]);
    const dec = async (pass) => {
      const bk = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
      const k = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: Buffer.from(E.salt, "base64"), iterations: E.it, hash: "SHA-256" },
        bk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      return new TextDecoder().decode(await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: Buffer.from(E.iv, "base64") }, k, Buffer.from(E.ct, "base64")));
    };
    try {
      const pt = await dec(PASS);
      if (pt !== bodyInner) errs.push("復号ラウンドトリップ不一致");
      if (pt.indexOf("参謀コメント") === -1) errs.push("復号文に「参謀コメント」が無い");
      if (pt.indexOf("情報ソース") === -1) errs.push("復号文に「情報ソース」が無い");
    } catch (e) { errs.push("正しいパスで復号できない: " + e.message); }
    // 3. 誤パスは拒否
    try { await dec(PASS + "_wrong"); errs.push("誤パスで復号できてしまった"); } catch (e) { /* 期待どおり */ }
  }

  // 4. 構造
  if (written.indexOf('id="lockgate"') === -1) errs.push("lockgate が無い");
  if (written.indexOf('id="lockdate"') === -1) errs.push("lockdate が無い");
  if (written.indexOf("function wire()") === -1) errs.push("wire() が外側スクリプトに無い");
  if (written.indexOf('robots" content="noindex') === -1) errs.push("robots noindex が無い");

  console.log(`  日付      : ${TODAY} (${DAYJP})`);
  console.log(`  HP        : ${HP}/100 [${HPCLASS}] ← 自分 ${SELF}件 ×-10 / メンバー ${MEM}件 ×-5`);
  console.log(`  格言      : ${QUOTE} — ${QSOURCE}`);
  console.log(`  チェック  : self ${cntSelf}件 / mem ${cntMem}件 / 全 ${(sections.match(/type="checkbox"/g) || []).length}件`);
  console.log(`  出力      : ${path.resolve(OUT)} (${written.length} bytes)`);

  if (errs.length) {
    console.error("VERIFY_RESULT: NG");
    errs.forEach((e) => console.error("  - " + e));
    process.exit(1);
  }
  console.log("VERIFY_RESULT: OK");
})().catch((e) => { console.error("BUILD_ERROR: " + e.message); process.exit(1); });

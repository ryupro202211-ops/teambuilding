const fs = require('node:fs');
const path = require('node:path');
const symbols = ['🌅','🔥','⚡','✅','⚠','📅','👀','📭','💡','🔗','🐛','🐝','🦈','👹','💀','🔴','🟡','🟢','🔒','🎉','↗','🚨','⭐','📋','🛡'];
const names = ['朝','期限切れ','メンバー','完了','注意','予定','先回り','期限なし','ヒント','リンク','幼虫','蜂','鮫','鬼','骸骨','高優先度','中優先度','低優先度','ロック','達成','開く','アラート','星','タスク','保護'];
function icon(symbol) {
  const i = symbols.indexOf(symbol.replace(/\uFE0F/g, ''));
  if (i < 0) throw new Error('Unknown brief icon: ' + symbol);
  return `<span class="brief-icon bi-${i}" role="img" aria-label="${names[i]}"></span>`;
}
function replaceIcons(html) {
  // Only text nodes: URLs, attributes, scripts and style contents must stay intact.
  return html.split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]*>)/gi)
    .map((part) => part.startsWith('<') ? part : part.replace(/🌅|🔥|⚡|✅|⚠\uFE0F?|📅|👀|📭|💡|🔗|🐛|🐝|🦈|👹|💀|🔴|🟡|🟢|🔒|🎉|↗\uFE0F?|🚨|⭐|🛡\uFE0F?|📋/gu, icon)).join('');
}
function css() {
  const uri = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '_assets/brief-icons-v2.png')).toString('base64');
  return `.brief-icon{display:inline-block;width:28px;height:28px;flex:none;vertical-align:middle;background-image:url(${uri});background-size:500% 500%;background-repeat:no-repeat}` +
    symbols.map((_, i) => `.bi-${i}{background-position:${i % 5 * 25}% ${Math.floor(i / 5) * 25}%}`).join('');
}
module.exports = { icon, replaceIcons, css, symbols };

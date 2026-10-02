
function analysisTrendChart(log){
  var rows=log.filter(function(r){return /^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isInteger(r.overdue)&&r.overdue>=0;}).slice(-56);
  if(!rows.length)return '<p>推移は次の日次更新から記録します。</p>';
  var max=Math.max(1,...rows.map(function(r){return r.overdue;}));
  var start=Date.parse(rows[0].date),end=Date.parse(rows[rows.length-1].date);
  var points=rows.map(function(r){return {x:40+(end===start?140:280*(Date.parse(r.date)-start)/(end-start)),y:150-120*r.overdue/max,row:r};});
  var ticks=[0,max/2,max].map(function(n){var y=150-120*n/max;return '<line x1="40" x2="320" y1="'+y+'" y2="'+y+'" stroke="#dce6db"/><text x="4" y="'+(y+4)+'" font-size="12">'+Math.round(n*10)/10+'</text>';}).join('');
  return '<figure data-chart="trend" style="margin:12px 0"><figcaption>日別の期限切れ件数</figcaption><svg viewBox="0 0 350 185" role="img" aria-label="期限切れ件数の推移。詳細は下の表" style="width:100%;height:auto">'+ticks+'<polyline fill="none" stroke="#2f8f4e" stroke-width="3" points="'+points.map(function(p){return p.x+','+p.y;}).join(' ')+'"/>'+points.map(function(p){return '<circle cx="'+p.x+'" cy="'+p.y+'" r="4" fill="#2f8f4e"><title>'+esc(p.row.date)+'：'+p.row.overdue+'件</title></circle>';}).join('')+'<text x="40" y="178" font-size="12">'+esc(rows[0].date.slice(5))+'</text><text x="320" y="178" text-anchor="end" font-size="12">'+esc(rows[rows.length-1].date.slice(5))+'</text></svg></figure>';
}

function renderAnalytics(){
  var daily=todayData(), date=daily.date || new Date().toLocaleDateString('sv-SE');
  var base=parseDate(date); base.setHours(0,0,0,0);
  function gap(value){var d=parseDate(value);return d ? Math.round((d-base)/86400000) : null;}
  var contacts=DATA.filter(function(p){return /^[ABCD]$/.test(p['カテゴリー']);});
  var late=contacts.filter(function(p){var n=gap(p['アクション日']);return n!==null&&n<0;});
  var unplanned=contacts.filter(function(p){return /^[AB]$/.test(p['カテゴリー'])&&gap(p['次会う日'])===null;});
  var meet=contacts.filter(function(p){var n=gap(p['次会う日']);return n!==null&&n>=0&&n<=7;});
  var overdue=(daily.tasks||[]).filter(function(t){return t.section==='selfOverdue'||t.section==='memberOverdue';}).sort(function(a,b){return b.overdueDays-a.overdueDays;});
  var owners={};overdue.forEach(function(t){var o=t.owner||'担当者未設定';owners[o]=(owners[o]||0)+1;});
  function personRows(list,field){return list.length?list.map(function(p){var label=field ? field+' '+(p[field]||'未設定') : '次会う日 未設定 ／ アクション日 '+(p['アクション日']||'未設定');return '<li><button type="button" data-analysis-person="'+esc(plantKey(p))+'">'+esc(p['名前(あだ名)'])+'</button><span> '+esc(p['カテゴリー'])+' ／ '+esc(label)+'</span></li>';}).join(''):'<li>対象者はいません</li>';}
  function card(title,body){return '<section class="today-card"><h2>'+title+'</h2>'+body+'</section>';}
  var oldDate=new Date(base);oldDate.setDate(oldDate.getDate()-7);
  var oldIso=oldDate.getFullYear()+'-'+String(oldDate.getMonth()+1).padStart(2,'0')+'-'+String(oldDate.getDate()).padStart(2,'0');
  var log=Array.isArray(daily.analysisLog)?daily.analysisLog:[];
  var prev=log.find(function(r){return r.date===oldIso;});
  var diff=prev?overdue.length-prev.overdue:null;
  var trend=diff===null?'7日前の記録待ち':('7日前から '+Math.abs(diff)+'件'+(diff>0?'増':diff<0?'減':'（変化なし）'));
  var cats=['A','B','C','D'].map(function(c){var n=contacts.filter(function(p){return p['カテゴリー']===c;}).length;return '<div>'+c+'：'+n+'人 <progress max="'+Math.max(1,contacts.length)+'" value="'+n+'" aria-label="カテゴリ'+c+' '+n+'人"></progress></div>';}).join('');
  var metric=function(key,label,n){return '<div class="analysis-metric"><strong data-metric="'+key+'">'+n+'</strong><span>'+label+'</span></div>';};
  document.getElementById('analyticswrap').innerHTML='<h1>分析</h1><p>データ基準日：'+esc(date)+'。完了チェックとは別に、取得元の期限切れを集計しています。</p><div class="analysis-metrics">'+metric('lateContacts','連絡予定を超過',late.length)+metric('unplanned','A・Bで次会う日なし',unplanned.length)+metric('overdue','期限切れタスク',overdue.length)+'</div><div class="analysis-grid">'
    +card('人脈のフォロー状況',cats+'<h3>連絡予定日を過ぎた人</h3><ul data-analysis-list="late">'+personRows(late,'アクション日')+'</ul><h3>A・Bで次会う日なし（'+unplanned.length+'人）</h3><ul data-analysis-list="unplanned">'+personRows(unplanned)+'</ul><p>上の人数と同じ条件です。連絡のアクション日がある人も含みます。</p>')
    +card('タスクの滞留状況','<p>'+trend+'</p>'+analysisTrendChart(log)+'<ul data-chart="owners">'+Object.keys(owners).map(function(o){return '<li>'+esc(o)+'：'+owners[o]+'件 <progress max="'+Math.max(1,overdue.length)+'" value="'+owners[o]+'" aria-label="'+esc(o)+' '+owners[o]+'件"></progress></li>';}).join('')+'</ul><h3>長く残っているタスク</h3><ul>'+overdue.map(function(t){return '<li><button type="button" data-analysis-task="'+esc(t.id)+'">'+esc(t.title)+'</button> '+esc(t.overdueDays)+'日超過</li>';}).join('')+'</ul>'+(overdue.length?'':'<p>期限切れはありません</p>')+'<details><summary>日別の期限切れ件数（最大56日）</summary><table><thead><tr><th>日付</th><th>件数</th></tr></thead><tbody>'+log.map(function(r){return '<tr><td>'+esc(r.date)+'</td><td>'+esc(r.overdue)+'</td></tr>';}).join('')+'</tbody></table></details>')
    +card('今週の行動候補','<h3>今日までの連絡候補</h3><ul>'+personRows(contacts.filter(function(p){var n=gap(p['アクション日']);return n!==null&&n<=0;}),'アクション日')+'</ul><h3>7日以内に会う人の準備</h3><ul>'+personRows(meet,'次会う日')+'</ul>')+'</div>';
  document.querySelectorAll('[data-analysis-person]').forEach(function(b){b.addEventListener('click',function(){SELECTED=b.getAttribute('data-analysis-person');setView('garden');renderGarden();var p=document.getElementById('gdpanel');if(p&&p.scrollIntoView)p.scrollIntoView({block:'nearest'});});});
  document.querySelectorAll('[data-analysis-task]').forEach(function(b){b.addEventListener('click',function(){setView('today');var r=Array.from(document.querySelectorAll('.today-task')).find(function(r){return r.getAttribute('data-task-id')===b.getAttribute('data-analysis-task');});if(r){var c=r.closest('.today-card');if(c)c.classList.remove('collapsed');if(r.scrollIntoView)r.scrollIntoView({block:'center'});r.focus();}});});
}

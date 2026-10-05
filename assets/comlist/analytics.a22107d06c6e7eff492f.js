
function renderAnalytics(){
  var daily=todayData(), date=daily.date || new Date().toLocaleDateString('sv-SE');
  var base=parseDate(date); base.setHours(0,0,0,0);
  function gap(value){var d=parseDate(value);return d ? Math.round((d-base)/86400000) : null;}
  var contacts=DATA.filter(function(p){return /^[ABCD]$/.test(p['カテゴリー']);});
  var late=contacts.filter(function(p){var n=gap(p['アクション日']);return n!==null&&n<0;});
  var unplanned=contacts.filter(function(p){return /^[AB]$/.test(p['カテゴリー'])&&gap(p['次会う日'])===null;});
  var meet=contacts.filter(function(p){var n=gap(p['次会う日']);return n!==null&&n>=0&&n<=7;});
  var overdue=(daily.tasks||[]).filter(function(t){return t.section==='selfOverdue'||t.section==='memberOverdue';}).sort(function(a,b){return b.overdueDays-a.overdueDays;});
  function personRows(list,field){return list.length?list.map(function(p){var label=field ? field+' '+(p[field]||'未設定') : '次会う日 未設定 ／ アクション日 '+(p['アクション日']||'未設定');return '<li><button type="button" data-analysis-person="'+esc(plantKey(p))+'">'+esc(p['名前(あだ名)'])+'</button><span> '+esc(p['カテゴリー'])+' ／ '+esc(label)+'</span></li>';}).join(''):'<li>対象者はいません</li>';}
  function card(title,body){return '<section class="today-card"><h2>'+title+'</h2>'+body+'</section>';}
  var cats=['A','B','C','D'].map(function(c){var n=contacts.filter(function(p){return p['カテゴリー']===c;}).length;return '<div>'+c+'：'+n+'人 <progress max="'+Math.max(1,contacts.length)+'" value="'+n+'" aria-label="カテゴリ'+c+' '+n+'人"></progress></div>';}).join('');
  var metric=function(key,label,n){return '<div class="analysis-metric"><strong data-metric="'+key+'">'+n+'</strong><span>'+label+'</span></div>';};
  document.getElementById('analyticswrap').innerHTML='<h1>分析</h1><p>データ基準日：'+esc(date)+'。完了チェックとは別に、取得元の期限切れを集計しています。</p><div class="analysis-metrics">'+metric('lateContacts','連絡予定を超過',late.length)+metric('unplanned','A・Bで次会う日なし',unplanned.length)+metric('overdue','期限切れタスク',overdue.length)+'</div><div class="analysis-grid">'
    +card('人脈のフォロー状況',cats+'<h3>連絡予定日を過ぎた人</h3><ul data-analysis-list="late">'+personRows(late,'アクション日')+'</ul><h3>A・Bで次会う日なし（'+unplanned.length+'人）</h3><ul data-analysis-list="unplanned">'+personRows(unplanned)+'</ul><p>上の人数と同じ条件です。連絡のアクション日がある人も含みます。</p>')
    +card('今週の行動候補','<h3>今日までの連絡候補</h3><ul>'+personRows(contacts.filter(function(p){var n=gap(p['アクション日']);return n!==null&&n<=0;}),'アクション日')+'</ul><h3>7日以内に会う人の準備</h3><ul>'+personRows(meet,'次会う日')+'</ul>')+'</div>';
  document.querySelectorAll('[data-analysis-person]').forEach(function(b){b.addEventListener('click',function(){SELECTED=b.getAttribute('data-analysis-person');setView('garden');renderGarden();var p=document.getElementById('gdpanel');if(p&&p.scrollIntoView)p.scrollIntoView({block:'nearest'});});});
}

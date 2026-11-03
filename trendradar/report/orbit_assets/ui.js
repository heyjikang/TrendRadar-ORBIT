/* UI/data binding, safe DOM creation, no fabricated analysis or live telemetry. */
(function(){
'use strict';
const p=window.__TREND_RADAR_PAYLOAD__;
if(!p){document.querySelector('.rightpane').textContent='未找到报告数据。';return;}
const $=id=>document.getElementById(id);
const topics=Array.isArray(p.topics)?p.topics.filter(x=>x&&typeof x.name==='string'):[];
const safeUrl=url=>{try{const u=new URL(url,location.href);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch(e){return null;}};
const isDemo=!!p.isDemo;
let selected=-1;
let playing=!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let cruising=playing;
let changed=performance.now(),qualityIndex=window.TrendRadarOrbit?.stats?.quality==='medium'?1:0;
const qualities=[['high','高'],['medium','中'],['low','低']];
let currentView='topic';
function make(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;}
function makeCard(item,index){
  const url=safeUrl(item.url);const card=make(url?'a':'div','news-card');
  if(url){card.href=url;card.target='_blank';card.rel='noopener noreferrer';}
  const tag=make('div','card-source');tag.append(make('span','',item.source||'未知平台'));
  const meta=[];
  if(item.time)meta.push(item.time);
  if(Number.isFinite(item.rank))meta.push('#'+item.rank);
  if(item.isNew)meta.push('NEW');
  tag.append(make('span','rank',meta.join(' · ')||'NEWS '+(index+1)));
  card.append(tag,make('div','card-title',item.title||'未命名资讯'));
  return card;
}
function renderEmptyTopic(){
  $('brief-title').textContent='暂无主题命中';
  $('topic-serial').textContent='00 / 00';
  $('brief-count').textContent='—';
  $('brief-rank').textContent='—';
  $('brief-content-label').textContent='主题速览';
  $('brief-kind').textContent='NO TOPIC';
  $('brief-summary').textContent='本次报告没有可聚合的热榜主题，可切换到 RSS / 独立源 / AI 研判视图。';
  $('brief-footnote').textContent='当前是报告快照。';
  $('news-list').replaceChildren();
}
function renderIdle(){
  selected=-1;
  $('brief-title').textContent='待选主题';
  $('topic-serial').textContent='-- / '+String(topics.length).padStart(2,'0');
  $('brief-count').textContent='—';
  $('brief-rank').textContent='—';
  $('brief-content-label').textContent='主题速览';
  $('brief-kind').textContent='STANDBY';
  $('brief-summary').textContent='球体正在无锁定巡航。点击左侧主题、球体外围标签或底部索引，锁定一个主题查看真实来源。';
  $('brief-footnote').textContent='当前是报告快照；未锁定主题时不展示任何推断性结论。';
  $('news-list').replaceChildren();
  document.documentElement.style.setProperty('--accent','#f36bbe');
  $('signal-orb').style.borderColor='';$('signal-orb').style.boxShadow='';
  for(const el of document.querySelectorAll('[data-topic-index]')){
    el.classList.remove('active');
    if(el.getAttribute('role')==='option')el.setAttribute('aria-selected','false');else el.setAttribute('aria-pressed','false');
  }
  window.TrendRadarOrbit?.setSelection?.(null);
}
function select(index,byUser=false){
  if(!topics.length){renderEmptyTopic();return;}
  if(!Number.isFinite(Number(index))||Number(index)<0){renderIdle();return;}
  selected=(Number(index)+topics.length)%topics.length;
  const topic=topics[selected];
  $('brief-title').textContent=topic.name;
  $('brief-count').innerHTML='';$('brief-count').append(document.createTextNode(String(topic.count||topic.headlines?.length||0).padStart(2,'0')));$('brief-count').append(make('span','', ' ITEMS'));
  $('topic-serial').textContent=String(selected+1).padStart(2,'0')+' / '+String(topics.length).padStart(2,'0');
  const ranks=(topic.headlines||[]).map(h=>Number(h.rank)).filter(n=>Number.isFinite(n)&&n>0);
  $('brief-rank').textContent=ranks.length?'#'+Math.min(...ranks):'—';
  $('brief-content-label').textContent=topic.aiSummary?'AI 主题摘要':'主题速览';
  $('brief-kind').textContent=topic.aiSummary?'AI ANALYSIS':'TITLE DIGEST';
  if(topic.aiSummary){$('brief-summary').textContent=topic.aiSummary;$('brief-footnote').textContent='AI 摘要仅基于已接入的报告内容；请结合下列来源核实具体事实。';}
  else{
    const sources=[...new Set((topic.headlines||[]).map(h=>h.source).filter(Boolean))];
    $('brief-summary').textContent='该主题收录 '+(topic.count||0)+' 条热点，覆盖 '+(sources.slice(0,3).join('、')||'未知来源')+(sources.length>3?' 等平台。':'。')+' 以下为来源标题摘录，尚未生成独立 AI 摘要。';
    $('brief-footnote').textContent='当前是报告快照。这里不是 AI 研判；点击新闻可查看原始来源。';
  }
  const color=/^#[\da-f]{6}$/i.test(topic.color||'')?topic.color:'#f36bbe';
  document.documentElement.style.setProperty('--accent',color);
  $('signal-orb').style.borderColor=color;$('signal-orb').style.boxShadow='inset -9px -8px 18px #0a0926, 0 0 38px '+color+'55, 0 0 0 12px '+color+'0d';
  if(window.TrendRadarOrbit)window.TrendRadarOrbit.setColor(color);
  window.TrendRadarOrbit?.setSelection?.(topic.id||topic.name||selected);
  for(const el of document.querySelectorAll('[data-topic-index]')){const active=Number(el.dataset.topicIndex)===selected;el.classList.toggle('active',active);if(el.getAttribute('role')==='option')el.setAttribute('aria-selected',String(active));else el.setAttribute('aria-pressed',String(active));}
  const box=$('news-list');box.replaceChildren();
  for(const [i,item] of (topic.headlines||[]).slice(0,4).entries())box.append(makeCard(item,i));
  if(byUser){changed=performance.now();if(cruising)setCruise(false);}
}
function renderGrouped(box,groups,emptyText){
  box.replaceChildren();
  if(!groups.length){if(emptyText)box.append(make('div','ai-empty',emptyText));return;}
  for(const group of groups){
    const wrap=make('div','news-group');
    const head=make('div','news-group-head');
    head.append(make('span','',group.name||'未命名来源'),make('span','',String(group.count||group.items?.length||0)+' 条'));
    wrap.append(head);
    for(const [i,item] of (group.items||[]).entries())wrap.append(makeCard(item,i));
    box.append(wrap);
  }
}
function appendAiText(container,text){
  let count=0;
  for(const raw of String(text||'').split(/\r?\n/)){
    const cleaned=raw.replace(/^\s*#{1,6}\s*/,'').replace(/\*\*/g,'').trim();
    if(!cleaned)continue;
    const bullet=/^([-*•]|\d+[.、)])\s*/.test(cleaned);
    container.append(make('div','ai-line'+(bullet?' ai-bullet':''),cleaned.replace(/^([-*•]|\d+[.、)])\s*/,'')));
    count++;
  }
  if(!count)container.append(make('div','ai-line','（无内容）'));
}
function renderReports(){
  const rss=p.rss||{},rssNew=p.rssNew||{},standalone=p.standalone||{},ai=p.ai||{};
  const rssGroups=Array.isArray(rss.groups)?rss.groups:[];
  const rssNewGroups=Array.isArray(rssNew.groups)?rssNew.groups:[];
  const platforms=Array.isArray(standalone.platforms)?standalone.platforms:[];
  const feeds=Array.isArray(standalone.feeds)?standalone.feeds:[];
  const standaloneGroups=[...platforms,...feeds];
  const rssEntries=rssGroups.reduce((n,g)=>n+(g.items?.length||0),0);
  const newEntries=rssNewGroups.reduce((n,g)=>n+(g.items?.length||0),0);
  const standaloneEntries=standaloneGroups.reduce((n,g)=>n+(g.items?.length||0),0);

  $('tab-count-rss').textContent=String(rssEntries+newEntries);
  $('tab-count-standalone').textContent=String(standaloneEntries);
  $('rss-summary').textContent=Number.isFinite(Number(rss.matched))&&Number.isFinite(Number(rss.total))
    ?Number(rss.matched)+' / '+Number(rss.total)+' 条命中'
    :rssEntries+' 条';
  $('standalone-summary').textContent=platforms.length||feeds.length
    ?platforms.length+' 个平台 · '+feeds.length+' 个订阅源'
    :'未配置';
  renderGrouped($('rss-list'),rssGroups,'本次报告没有命中关键词的 RSS 条目。');
  $('rss-new-heading').hidden=!rssNewGroups.length;
  renderGrouped($('rss-new-list'),rssNewGroups,'');
  renderGrouped($('standalone-list'),standaloneGroups,'本次报告未启用独立展示区，或来源暂无内容。');

  const sections=Array.isArray(ai.sections)?ai.sections:[];
  const summaries=Array.isArray(ai.standaloneSummaries)?ai.standaloneSummaries:[];
  const preview=$('ai-preview'),body=$('ai-overlay-body'),foot=$('ai-overlay-foot');
  preview.replaceChildren();body.replaceChildren();
  $('ai-status').textContent=ai.available?'已生成':'不可用';
  $('ai-open').disabled=!ai.available;
  if(!ai.available){
    const note=(ai.reason||'本次报告未包含 AI 分析')+'。';
    preview.append(make('div','ai-empty',note));
    body.append(make('div','ai-empty',note));
    foot.textContent='没有 AI 研判结果时不会生成占位内容。';
    return;
  }
  for(const section of sections.slice(0,2)){
    const sec=make('div','ai-section');
    sec.append(make('h3','',section.label));
    appendAiText(sec,section.body);
    preview.append(sec);
  }
  const grid=make('div','ai-sections');
  sections.forEach((section,index)=>{
    const sec=make('div','ai-section');
    const head=make('h3');
    head.append(document.createTextNode(section.label),make('i','',String(index+1).padStart(2,'0')));
    sec.append(head);
    appendAiText(sec,section.body);
    grid.append(sec);
  });
  if(summaries.length){
    const sec=make('div','ai-section ai-summary-block');
    sec.append(make('h3','','独立展示源速览'));
    for(const entry of summaries){
      const item=make('div','ai-summary-item');
      item.append(make('strong','',entry.source),make('div','ai-line',entry.summary));
      sec.append(item);
    }
    grid.append(sec);
  }
  body.append(grid);
  const meta=ai.meta||{},bits=[];
  if(meta.aiMode)bits.push('模式 '+meta.aiMode);
  if(Number(meta.analyzedNews))bits.push('已分析 '+meta.analyzedNews+' / '+(Number(meta.totalNews)||'—')+' 条');
  foot.textContent='全局 AI 研判'+(bits.length?' · '+bits.join(' · '):'')+' · 生成于报告快照；AI 内容仅供信息参考，请以原始来源为准。';
}
function renderHistory(){
  const history=p.history&&typeof p.history==='object'?p.history:{};
  const entries=Array.isArray(history.topics)?history.topics.filter(t=>t&&typeof t.name==='string'&&t.name):[];
  const meta=$('memory-meta'),list=$('memory-list');
  if(list)list.replaceChildren();
  if(!meta||!list)return;
  const runs=Number(history.snapshotCount)||0;
  if(!runs||!entries.length){
    meta.textContent='本机首次巡航，24 小时内暂无累计记录。';
    list.append(make('div','memory-empty','下一次报告生成后开始累积热度轨迹。'));
    return;
  }
  const totals=history.totals||{};
  meta.textContent=runs+' 次巡航 · '+entries.length+' 个主题 · '+(Number(totals.titles)||0)+' 条标题';
  const max=entries.reduce((n,t)=>Math.max(n,Number(t.appearances)||0),1);
  for(const entry of entries.slice(0,6)){
    const appearances=Number(entry.appearances)||0;
    const fresh=Math.min(1,Math.max(0,Number(entry.freshness)||0));
    const row=make('button','memory-row');row.type='button';
    const share=Math.max(5,Math.round(appearances/max*100));
    const heat=fresh>.7?'#ffcf7a':(fresh>.4?'#f36bbe':'#8a63e8');
    row.append(make('span','memory-name',entry.name));
    const track=make('span','memory-track'),fill=make('span','memory-fill');
    fill.style.width=share+'%';
    fill.style.background='linear-gradient(90deg,'+heat+'44,'+heat+')';
    fill.style.boxShadow='0 0 8px '+heat+'77';
    track.append(fill);row.append(track);
    row.append(make('span','memory-value',String(appearances)));
    const last=entry.lastSeen?new Date(entry.lastSeen):null;
    const parts=['24h 出现 '+appearances+' 次'];
    if(last&&!Number.isNaN(last.valueOf()))parts.push('最近 '+last.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}));
    if(Number(entry.peakRank)>0)parts.push('最佳 #'+Number(entry.peakRank));
    if(Number(entry.momentum)>0)parts.push('动量 '+Math.round(Number(entry.momentum)*100)+'%');
    row.title=parts.join(' · ');
    const index=topics.findIndex(t=>t.name===entry.name);
    if(index>=0)row.addEventListener('click',()=>{setView('topic');select(index,true);});
    else{row.disabled=true;row.title=row.title+' · 本次报告未命中';}
    list.append(row);
  }
}
let markers=[];
function buildMarkers(){
  const wrap=$('orbit-markers'),svg=$('orbit-leaders');
  if(!wrap||!svg)return;
  wrap.replaceChildren();svg.replaceChildren();markers=[];
  const fields=window.TrendRadarOrbit?.getTopicFields?.();
  for(const [i,topic] of topics.entries()){
    const field=(Array.isArray(fields)&&fields[i])||{};
    const hex=/^#[\da-f]{6}$/i.test(String(field.color||topic.color||''))?String(field.color||topic.color):'#f36bbe';
    const ranks=(topic.headlines||[]).map(h=>Number(h.rank)).filter(n=>Number.isFinite(n)&&n>0);
    const peak=Number(field.peakRank)||(ranks.length?Math.min(...ranks):0);
    const items=Number(field.titleCount)||Number(topic.count)||0;
    const meta=[];
    if(peak>0)meta.push('TOP #'+peak);
    if(items>0)meta.push(items+(items===1?' ITEM':' ITEMS'));
    const btn=make('button','signal-marker');btn.type='button';
    btn.dataset.topicIndex=String(i);btn.setAttribute('aria-pressed','false');
    btn.style.setProperty('--marker-color',hex);
    btn.append(make('i'),make('span','',topic.name));
    if(meta.length)btn.append(make('small','',meta.join(' · ')));
    btn.addEventListener('click',()=>{setView('topic');select(i,true);});
    wrap.append(btn);
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('stroke',hex);line.setAttribute('stroke-opacity','.42');
    svg.append(line);
    markers.push({button:btn,line,index:i});
  }
}
function layoutMarkers(){
  if(!markers.length)return;
  const stage=$('orbit-stage'),orbit=window.TrendRadarOrbit;
  if(!stage||!orbit||typeof orbit.project!=='function')return;
  const w=stage.clientWidth,h=stage.clientHeight;
  if(w<80||h<80)return;
  const cx=w/2,cy=h/2;
  const compact=document.body.classList.contains('portrait-mode')||w<560;
  const rx=Math.max(70,Math.min(w*.43,h*.62)),ry=Math.max(70,Math.min(h*.43,w*.52));
  const items=[];
  for(const marker of markers){
    const pt=orbit.project(marker.index);
    if(!pt){marker.button.hidden=true;marker.line.setAttribute('visibility','hidden');continue;}
    const ax=(pt.x-cx)/rx,ay=(pt.y-cy)/ry;
    const angle=Math.abs(ax)+Math.abs(ay)>.02?Math.atan2(ay,ax):marker.index*2.399963;
    items.push({button:marker.button,line:marker.line,index:marker.index,pt,angle,front:!!pt.front});
  }
  let visible=items;
  if(compact){
    const active=items.find(it=>it.index===selected);
    const others=items.filter(it=>it!==active).sort((a,b)=>(Number(b.front)-Number(a.front))||((b.pt.z||0)-(a.pt.z||0))).slice(0,2);
    visible=active?[active,...others]:others;
  }
  const shown=new Set(visible.map(it=>it.index));
  for(const it of items){
    const on=shown.has(it.index);
    it.button.hidden=!on;
    it.line.setAttribute('visibility',on?'visible':'hidden');
    if(!on)continue;
    it.button.classList.toggle('back',!it.front);
    it.line.setAttribute('stroke-opacity',it.front?'.46':'.12');
  }
  visible.sort((a,b)=>a.angle-b.angle);
  const gap=compact?1.0:.66;
  for(let i=1;i<visible.length;i++){
    if(visible[i].angle-visible[i-1].angle<gap)visible[i].angle=visible[i-1].angle+gap;
  }
  if(visible.length>1&&visible[0].angle+Math.PI*2-visible[visible.length-1].angle<gap)visible[visible.length-1].angle=visible[0].angle+Math.PI*2-gap;
  for(const it of visible){
    const lx=Math.max(8,Math.min(w-8,cx+Math.cos(it.angle)*rx));
    const ly=Math.max(10,Math.min(h-10,cy+Math.sin(it.angle)*ry));
    it.button.style.left=lx.toFixed(1)+'px';
    it.button.style.top=ly.toFixed(1)+'px';
    const dx=it.pt.x-lx,dy=it.pt.y-ly,d=Math.hypot(dx,dy)||1;
    it.line.setAttribute('x1',(lx+dx/d*16).toFixed(1));
    it.line.setAttribute('y1',(ly+dy/d*16).toFixed(1));
    it.line.setAttribute('x2',Math.max(0,Math.min(w,it.pt.x)).toFixed(1));
    it.line.setAttribute('y2',Math.max(0,Math.min(h,it.pt.y)).toFixed(1));
  }
}
function setView(name){
  currentView=name;
  for(const tab of document.querySelectorAll('.brief-tab')){
    const on=tab.dataset.view===name;
    tab.classList.toggle('active',on);tab.setAttribute('aria-selected',String(on));
  }
  for(const view of document.querySelectorAll('.brief-view')){
    const on=view.id==='view-'+name;
    view.hidden=!on;view.classList.toggle('active',on);
  }
}
function openAi(){
  if(!(p.ai&&p.ai.available))return;
  $('ai-overlay').hidden=false;
  $('ai-close').focus();
}
function closeAi(){
  if($('ai-overlay').hidden)return;
  $('ai-overlay').hidden=true;
  $('ai-open').focus();
}
function build(){
 $('quality-button').textContent='画质：'+qualities[qualityIndex][1];
 const metrics=p.metrics||{};
 $('kpi-topics').textContent=metrics.topics??topics.length;
 $('kpi-total').textContent=metrics.hotlistMatched??topics.reduce((n,t)=>n+(t.count||0),0);
 $('kpi-rss').textContent=metrics.rssMatched??'—';
 $('kpi-platforms').textContent=metrics.platforms??'—';
 $('source-note').textContent=isDemo?'样例数据 · 非实时':'报告快照 · 非实时推送';
 const timestamp=p.snapshotAt?new Date(p.snapshotAt):null;
 const validTime=timestamp&&!Number.isNaN(timestamp.valueOf());
 $('snapshot-label').textContent=(isDemo?'演示样例 · ':'报告快照 · ')+(validTime?timestamp.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' 北京时间':'更新时间未知');
 const list=$('topic-list'),chips=$('topic-chips');
 topics.forEach((topic,i)=>{
  const row=make('button','topic-row');row.type='button';row.dataset.topicIndex=i;row.setAttribute('role','option');row.setAttribute('aria-selected','false');row.append(make('span','topic-index',String(i+1).padStart(2,'0')),make('span','topic-name',topic.name),make('span','topic-value',String(topic.count||0).padStart(2,'0')),make('span','topic-spark'));row.addEventListener('click',()=>select(i,true));list.append(row);
  const chip=make('button','chip',topic.name+' / '+String(topic.count||0).padStart(2,'0'));chip.type='button';chip.dataset.topicIndex=i;chip.style.setProperty('--chip-color',topic.color||'#f36bbe');chip.setAttribute('aria-pressed','false');chip.addEventListener('click',()=>{setView('topic');select(i,true);});chips.append(chip);
 });
 for(const tab of document.querySelectorAll('.brief-tab'))tab.addEventListener('click',()=>setView(tab.dataset.view));
 $('ai-open').addEventListener('click',openAi);
 $('ai-close').addEventListener('click',closeAi);
 $('ai-overlay').addEventListener('click',e=>{if(e.target===$('ai-overlay'))closeAi();});
 $('play-button').addEventListener('click',()=>setCruise(!cruising));
 $('portrait-button').addEventListener('click',()=>{const on=document.body.classList.toggle('portrait-mode');$('portrait-button').setAttribute('aria-pressed',String(on));$('portrait-button').textContent=on?'桌面预览':'竖屏预览';});
 $('quality-button').addEventListener('click',()=>{qualityIndex=(qualityIndex+1)%qualities.length;const [key,label]=qualities[qualityIndex];$('quality-button').textContent='画质：'+label;if(window.TrendRadarOrbit)window.TrendRadarOrbit.setQuality(key);});
 document.addEventListener('keydown',e=>{
   if(!$('ai-overlay').hidden){if(e.key==='Escape'){e.preventDefault();closeAi();}return;}
   if(e.target?.matches('input,textarea,[contenteditable]'))return;
   if(currentView!=='topic')return;
   if(e.key==='ArrowRight'){select(selected+1,true);}
   else if(e.key==='ArrowLeft'){select(selected-1,true);}
   else if(e.code==='Space'&&e.target===document.body){e.preventDefault();setCruise(!cruising);}
 });
 renderReports();
 renderHistory();
 buildMarkers();
 setCruise(cruising);select(selected);
}
function setPlaying(value){playing=!!value;window.TrendRadarOrbit?.setPlaying(playing);}
function setCruise(value){cruising=!!value;if(cruising&&!playing)setPlaying(true);$('play-button').setAttribute('aria-pressed',String(cruising));$('play-icon').textContent=cruising?'Ⅱ':'▶';$('play-text').textContent=cruising?'暂停巡航':'继续巡航';changed=performance.now();}
// Only auto-advances topic selection, not news data freshness.
function step(now){if(cruising&&currentView==='topic'&&now-changed>6500){select(selected<0?0:selected+1,false);changed=now;}layoutMarkers();requestAnimationFrame(step);}
build();requestAnimationFrame(step);
})();

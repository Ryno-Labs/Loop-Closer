import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const configured = !SUPABASE_URL.includes('PASTE_') && !SUPABASE_ANON_KEY.includes('PASTE_');
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = s => document.querySelector(s);

const authView=$('#auth-view'), mainView=$('#main-view'), dashboardView=$('#dashboard-view'), loopView=$('#loop-view');
const loopsList=$('#loops-list'), timeline=$('#timeline'), currentWrap=$('#current-wrap'), abCard=$('#ab-card');
const loopDialog=$('#loop-dialog'), stepDialog=$('#step-dialog');
let session=null, loops=[], steps=[], activeLoopId=null, tickHandle=null;

const STATUS_LABEL={not_started:'Not started',active:'Active',waiting:'Waiting',delegated:'Delegated',closed:'Closed'};

function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function elapsedText(ms){if(ms<0)ms=0;const sec=Math.floor(ms/1000),min=Math.floor(sec/60),hr=Math.floor(min/60),day=Math.floor(hr/24);if(day)return `${day}d ${hr%24}h`;if(hr)return `${hr}h ${min%60}m`;if(min)return `${min}m`;return `${sec}s`;}
function fmtDate(v){if(!v)return'';return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(v));}
function stepAge(s){const start=s.started_at||s.created_at,end=s.completed_at||Date.now();return elapsedText(new Date(end)-new Date(start));}
function activeTime(s){let seconds=Number(s.active_seconds||0);if(s.timer_started_at)seconds+=Math.max(0,(Date.now()-new Date(s.timer_started_at))/1000);return elapsedText(seconds*1000);}
function isOverdue(s){return !!(s.deadline&&s.status!=='closed'&&new Date(s.deadline)<new Date());}
function loopSteps(loopId){return steps.filter(s=>s.loop_id===loopId).sort((a,b)=>Number(a.position)-Number(b.position));}
function currentStep(loopId){return steps.find(s=>s.loop_id===loopId&&s.is_current)||null;}
function stateDotClass(s){if(!s)return'';if(isOverdue(s))return'overdue';if(s.status==='waiting')return'waiting';if(s.status==='delegated')return'delegated';return'';}
function currentStateLabel(s){if(!s)return'Choose current step';if(isOverdue(s))return'late';return STATUS_LABEL[s.status].toLowerCase();}
function currentMetaText(s){const bits=[];if(s.waiting_on)bits.push(`waiting on ${esc(s.waiting_on)}`);else if(s.delegated_to)bits.push(`delegated to ${esc(s.delegated_to)}`);else bits.push(currentStateLabel(s));if(s.deadline)bits.push(`${isOverdue(s)?'late':'due'} ${esc(fmtDate(s.deadline))}`);return bits.join(' · ');}

async function boot(){
  if(!configured){
    authView.innerHTML=`<div class="auth-wrap"><div class="brand"><small>Setup required</small>close.</div><div class="auth-copy"><h1>Connect Supabase.</h1><p>Open <strong>config.js</strong>, paste your project URL and publishable/anon key, then reload.</p></div></div>`;
    return;
  }
  const {data}=await supabase.auth.getSession();session=data.session;renderAuthState();
  supabase.auth.onAuthStateChange(async(_event,next)=>{session=next;renderAuthState();if(session)await loadData();});
  if(session)await loadData();
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  tickHandle=setInterval(()=>{if(activeLoopId)renderCurrentOnly();else if(session)renderDashboardStatsOnly();},1000);
}
function renderAuthState(){authView.classList.toggle('hidden',!!session);mainView.classList.toggle('hidden',!session);if(!session){activeLoopId=null;dashboardView.classList.remove('hidden');loopView.classList.add('hidden');}}

$('#login-form').addEventListener('submit',async e=>{e.preventDefault();$('#auth-error').textContent='';const {error}=await supabase.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});if(error)$('#auth-error').textContent=error.message;});
$('#signout-btn').addEventListener('click',()=>supabase.auth.signOut());

async function loadData(){
  const [{data:l,error:le},{data:s,error:se}]=await Promise.all([supabase.from('loops').select('*').order('created_at',{ascending:false}),supabase.from('steps').select('*').order('position',{ascending:true})]);
  if(le||se){console.error(le||se);alert((le||se).message);return;}
  loops=l||[];steps=s||[];if(activeLoopId&&!loops.some(l=>l.id===activeLoopId))activeLoopId=null;activeLoopId?renderLoop():renderDashboard();
}

function renderDashboardStatsOnly(){
  const open=loops.filter(l=>l.status==='open'),currents=open.map(l=>currentStep(l.id)).filter(Boolean),waiting=currents.filter(s=>s.status==='waiting').length,delegated=currents.filter(s=>s.status==='delegated').length,late=currents.filter(isOverdue).length;
  $('#open-count').textContent=open.length;
  const parts=[];if(waiting)parts.push(`${waiting} waiting`);if(delegated)parts.push(`${delegated} delegated`);if(late)parts.push(`${late} late`);
  $('#dashboard-subline').innerHTML=parts.length?`<span class="accent-dot"></span><span>${parts.join(' · ')}</span>`:'<span>Everything is moving.</span>';
}
function renderDashboard(){
  dashboardView.classList.remove('hidden');loopView.classList.add('hidden');activeLoopId=null;renderDashboardStatsOnly();
  const open=loops.filter(l=>l.status==='open');
  if(!open.length){loopsList.innerHTML='<div class="empty">No open loops. Add one thing you want to move from A to B.</div>';return;}
  loopsList.innerHTML=open.map(loop=>{
    const ss=loopSteps(loop.id),closed=ss.filter(s=>s.status==='closed').length,cur=currentStep(loop.id),dot=stateDotClass(cur);
    return `<article class="loop-row" data-loop-id="${loop.id}"><div><h2 class="loop-title">${esc(loop.title)}</h2><div class="loop-meta">${cur?`<span class="state-dot ${dot}"></span><strong>${esc(cur.title)}</strong><span>${esc(currentStateLabel(cur))}</span>`:`<span class="state-dot"></span><strong>Choose current step</strong>`}</div></div><div class="loop-side"><div class="loop-age">${cur?stepAge(cur):'—'}</div><div class="loop-count">${closed} / ${ss.length}</div></div></article>`;
  }).join('');
  loopsList.querySelectorAll('[data-loop-id]').forEach(el=>el.onclick=()=>openLoop(el.dataset.loopId));
}

function openLoop(id){activeLoopId=id;dashboardView.classList.add('hidden');loopView.classList.remove('hidden');window.scrollTo({top:0,behavior:'instant'});renderLoop();}
$('#back-btn').onclick=()=>renderDashboard();

function renderLoop(){
  const loop=loops.find(l=>l.id===activeLoopId);if(!loop){renderDashboard();return;}
  $('#detail-title').textContent=loop.title;
  abCard.innerHTML=`<div class="ab-head"><div class="ab-letter">A.</div><div class="ab-arrow"></div><div class="ab-letter right">B.</div></div><div class="ab-text"><div><strong>Current state</strong>${esc(loop.current_state)}</div><div><strong>Done</strong>${esc(loop.desired_state)}</div></div>`;
  renderCurrentOnly();renderTimeline();
}
function renderCurrentOnly(){
  if(!activeLoopId)return;const cur=currentStep(activeLoopId),ss=loopSteps(activeLoopId);
  if(!cur){currentWrap.innerHTML=`<div class="focus-label"><div class="micro">Current step</div></div><div class="no-current"><strong>No current step.</strong>${ss.length?'Choose one from the path below.':'Add the first step to start closing this loop.'}</div>`;return;}
  const meta=[];if(cur.status==='waiting'&&cur.waiting_on)meta.push(`<span><b>Waiting on</b> ${esc(cur.waiting_on)}</span>`);else if(cur.status==='delegated'&&cur.delegated_to)meta.push(`<span><b>Delegated to</b> ${esc(cur.delegated_to)}</span>`);else meta.push(`<span><b>Status</b> ${esc(STATUS_LABEL[cur.status])}</span>`);if(cur.deadline)meta.push(`<span class="${isOverdue(cur)?'overdue-text':''}"><b>${isOverdue(cur)?'Late':'Due'}</b> ${esc(fmtDate(cur.deadline))}</span>`);
  currentWrap.innerHTML=`<div class="focus-label"><div class="micro">Current step</div><div class="focus-age">open ${stepAge(cur)} · worked ${activeTime(cur)}</div></div><section class="current-card"><h1 class="current-title">${esc(cur.title)}</h1><div class="current-meta">${meta.join('')}</div>${cur.hard_rule?`<div class="rule-line"><b>Rule:</b> ${esc(cur.hard_rule)}</div>`:''}${cur.delegation_note?`<div class="delegation-line"><b>Handed off:</b> ${esc(cur.delegation_note)}</div>`:''}<div class="action-row"><button class="primary" id="close-current-btn">Close step</button><button class="secondary ${cur.timer_started_at?'running':''}" id="timer-current-btn">${cur.timer_started_at?'Stop timer':'Start timer'}</button></div></section>`;
  $('#close-current-btn').onclick=()=>closeStep(cur.id);$('#timer-current-btn').onclick=()=>cur.timer_started_at?stopTimer(cur.id):startTimer(cur.id);
}
function renderTimeline(){
  const ss=loopSteps(activeLoopId);
  if(!ss.length){timeline.innerHTML='<div class="empty">No steps yet. Add the first box between A and B.</div>';return;}
  timeline.innerHTML=ss.map((s,i)=>{
    const meta=[];if(s.status==='closed')meta.push(`${activeTime(s)} active`);else{if(s.status==='waiting'&&s.waiting_on)meta.push(`waiting on ${esc(s.waiting_on)}`);else if(s.status==='delegated'&&s.delegated_to)meta.push(`delegated to ${esc(s.delegated_to)}`);else meta.push(esc(STATUS_LABEL[s.status].toLowerCase()));if(s.deadline)meta.push(`<span class="${isOverdue(s)?'overdue-text':''}">${isOverdue(s)?'late':'due'} ${esc(fmtDate(s.deadline))}</span>`);}
    return `<article class="step ${s.status==='closed'?'closed':''} ${s.is_current?'current':''}" data-step-id="${s.id}"><div class="step-mark">${s.status==='closed'?'✓':i+1}</div><div><div class="step-name">${esc(s.title)}</div><div class="step-meta">${meta.join(' · ')}</div></div><button class="step-menu" data-edit-step="${s.id}" aria-label="Edit step">···</button></article>`;
  }).join('');
  timeline.querySelectorAll('[data-edit-step]').forEach(b=>b.onclick=()=>openStepDialog(steps.find(s=>s.id===b.dataset.editStep)));
}

$('#new-loop-btn').onclick=()=>openLoopDialog();
$('#loop-settings-btn').onclick=()=>openLoopDialog(loops.find(l=>l.id===activeLoopId));
$('#add-step-btn').onclick=()=>{const cur=currentStep(activeLoopId),ss=loopSteps(activeLoopId);openStepDialog(null,cur?.id||(ss.length?ss[ss.length-1].id:'__START__'));};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());

function openLoopDialog(loop=null){
  $('#loop-form').reset();$('#loop-id').value=loop?.id||'';$('#loop-dialog-title').textContent=loop?'Loop settings':'New loop';
  if(loop){$('#loop-title').value=loop.title;$('#loop-a').value=loop.current_state;$('#loop-b').value=loop.desired_state;$('#toggle-loop-btn').textContent=loop.status==='closed'?'Reopen loop':'Close loop';$('#toggle-loop-btn').classList.remove('hidden');}
  else $('#toggle-loop-btn').classList.add('hidden');
  loopDialog.showModal();
}
$('#loop-form').addEventListener('submit',async e=>{
  e.preventDefault();const id=$('#loop-id').value,payload={title:$('#loop-title').value.trim(),current_state:$('#loop-a').value.trim(),desired_state:$('#loop-b').value.trim()};let res;
  if(id)res=await supabase.from('loops').update(payload).eq('id',id).select().single();else res=await supabase.from('loops').insert({...payload,user_id:session.user.id}).select().single();
  if(res.error){alert(res.error.message);return;}loopDialog.close();await loadData();if(!id)openLoop(res.data.id);
});
$('#toggle-loop-btn').onclick=async()=>{const loop=loops.find(l=>l.id===$('#loop-id').value);if(!loop)return;loopDialog.close();await toggleLoop(loop);};

function openStepDialog(step=null,insertAfter=null){
  $('#step-form').reset();$('#step-id').value=step?.id||'';$('#step-insert-after').value=insertAfter||'';$('#step-dialog-title').textContent=step?'Edit step':'Add step';$('#add-after-step-btn').classList.toggle('hidden',!step);
  if(step){$('#step-title').value=step.title||'';$('#step-status').value=step.status;$('#step-waiting-on').value=step.waiting_on||'';$('#step-delegated-to').value=step.delegated_to||'';$('#step-delegation-note').value=step.delegation_note||'';$('#step-hard-rule').value=step.hard_rule||'';$('#step-current').checked=step.is_current;if(step.deadline){const d=new Date(step.deadline),local=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);$('#step-deadline').value=local;}}
  stepDialog.showModal();
}
$('#add-after-step-btn').onclick=()=>{const id=$('#step-id').value;stepDialog.close();setTimeout(()=>openStepDialog(null,id),100);};
function positionForInsert(loopId,insertAfter){const ss=loopSteps(loopId);if(!ss.length)return 1000;if(insertAfter==='__START__')return Number(ss[0].position)-1000;const idx=ss.findIndex(s=>s.id===insertAfter);if(idx<0||idx===ss.length-1)return Number(ss[ss.length-1].position)+1000;return(Number(ss[idx].position)+Number(ss[idx+1].position))/2;}
$('#step-form').addEventListener('submit',async e=>{
  e.preventDefault();const id=$('#step-id').value,status=$('#step-status').value,makeCurrent=$('#step-current').checked,deadline=$('#step-deadline').value?new Date($('#step-deadline').value).toISOString():null,existing=id?steps.find(s=>s.id===id):null;
  const payload={title:$('#step-title').value.trim(),status,waiting_on:$('#step-waiting-on').value.trim()||null,delegated_to:$('#step-delegated-to').value.trim()||null,delegation_note:$('#step-delegation-note').value.trim()||null,hard_rule:$('#step-hard-rule').value.trim()||null,deadline,started_at:status!=='not_started'?(existing?.started_at||new Date().toISOString()):null,completed_at:status==='closed'?(existing?.completed_at||new Date().toISOString()):null,is_current:false};
  let res;if(id)res=await supabase.from('steps').update(payload).eq('id',id).select().single();else res=await supabase.from('steps').insert({...payload,loop_id:activeLoopId,user_id:session.user.id,position:positionForInsert(activeLoopId,$('#step-insert-after').value||'__START__')}).select().single();
  if(res.error){alert(res.error.message);return;}const savedId=res.data.id;if(makeCurrent&&status!=='closed')await makeCurrent(savedId,false);else if(status==='closed')await supabase.from('steps').update({is_current:false}).eq('id',savedId);stepDialog.close();await loadData();
});

async function makeCurrent(id,reload=true){const target=steps.find(s=>s.id===id)||{loop_id:activeLoopId};let {error}=await supabase.from('steps').update({is_current:false}).eq('loop_id',target.loop_id).eq('user_id',session.user.id);if(error){alert(error.message);return;}const current=steps.find(s=>s.id===id),patch={is_current:true};if(!current||current.status==='not_started'){patch.status='active';patch.started_at=current?.started_at||new Date().toISOString();}({error}=await supabase.from('steps').update(patch).eq('id',id));if(error)alert(error.message);if(reload)await loadData();}
async function closeStep(id){const s=steps.find(x=>x.id===id);if(!s)return;let seconds=s.active_seconds||0;if(s.timer_started_at)seconds+=Math.floor((Date.now()-new Date(s.timer_started_at))/1000);const {error}=await supabase.from('steps').update({status:'closed',is_current:false,completed_at:new Date().toISOString(),timer_started_at:null,active_seconds:seconds}).eq('id',id);if(error){alert(error.message);return;}await loadData();const ss=loopSteps(activeLoopId),idx=ss.findIndex(x=>x.id===id),next=ss.slice(idx+1).find(x=>x.status!=='closed');if(next)await makeCurrent(next.id);}
async function startTimer(id){const s=steps.find(x=>x.id===id);if(!s)return;const patch={timer_started_at:new Date().toISOString(),started_at:s.started_at||new Date().toISOString()};if(s.status==='not_started')patch.status='active';const {error}=await supabase.from('steps').update(patch).eq('id',id);if(error)alert(error.message);await loadData();}
async function stopTimer(id){const s=steps.find(x=>x.id===id);if(!s?.timer_started_at)return;const seconds=(s.active_seconds||0)+Math.floor((Date.now()-new Date(s.timer_started_at))/1000);const {error}=await supabase.from('steps').update({timer_started_at:null,active_seconds:seconds}).eq('id',id);if(error)alert(error.message);await loadData();}
async function toggleLoop(loop){if(loop.status==='open'){const openSteps=loopSteps(loop.id).filter(s=>s.status!=='closed');if(openSteps.length&&!confirm(`This loop still has ${openSteps.length} open step${openSteps.length===1?'':'s'}. Close it anyway?`))return;}const closing=loop.status==='open';const {error}=await supabase.from('loops').update({status:closing?'closed':'open',closed_at:closing?new Date().toISOString():null}).eq('id',loop.id);if(error){alert(error.message);return;}await loadData();if(closing)renderDashboard();}

boot();

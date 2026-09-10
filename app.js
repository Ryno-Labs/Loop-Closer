import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const configured = !SUPABASE_URL.includes('PASTE_') && !SUPABASE_ANON_KEY.includes('PASTE_');
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = selector => document.querySelector(selector);

const authView = $('#auth-view');
const mainView = $('#main-view');
const dashboardView = $('#dashboard-view');
const loopView = $('#loop-view');
const loopsList = $('#loops-list');
const closedList = $('#closed-list');
const timeline = $('#timeline');
const currentWrap = $('#current-wrap');
const abCard = $('#ab-card');
const loopDialog = $('#loop-dialog');
const stepDialog = $('#step-dialog');
const ruleDialog = $('#rule-dialog');

let session = null;
let loops = [];
let steps = [];
let activeLoopId = null;
let clockHandle = null;
let pendingCloseStepId = null;
let toastHandle = null;

const STATUS_LABEL = {
  not_started: 'Later',
  active: 'Doing',
  waiting: 'Waiting',
  delegated: 'Delegated',
  closed: 'Closed'
};

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function elapsedText(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day) return `${day}d ${hr % 24}h`;
  if (hr) return `${hr}h ${min % 60}m`;
  if (min) return `${min}m`;
  return `${sec}s`;
}
function fmtDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}).format(new Date(value));
}
function stepAge(step) {
  const start = step.started_at || step.created_at;
  const end = step.completed_at || Date.now();
  return elapsedText(new Date(end) - new Date(start));
}
function activeTime(step) {
  let seconds = Number(step.active_seconds || 0);
  if (step.timer_started_at) seconds += Math.max(0, (Date.now() - new Date(step.timer_started_at)) / 1000);
  return elapsedText(seconds * 1000);
}
function isOverdue(step) {
  return !!(step.deadline && step.status !== 'closed' && new Date(step.deadline) < new Date());
}
function loopSteps(loopId) {
  return steps.filter(s => s.loop_id === loopId).sort((a,b) => Number(a.position) - Number(b.position));
}
function currentStep(loopId) {
  return steps.find(s => s.loop_id === loopId && s.is_current && s.status !== 'closed') || null;
}
function firstOpenStep(loopId) {
  return loopSteps(loopId).find(s => s.status !== 'closed') || null;
}
function stateDotClass(step) {
  if (!step) return '';
  if (isOverdue(step)) return 'overdue';
  if (step.status === 'waiting') return 'waiting';
  if (step.status === 'delegated') return 'delegated';
  return '';
}
function showToast(message) {
  const toast = $('#toast');
  clearTimeout(toastHandle);
  toast.textContent = message;
  toast.classList.add('show');
  toastHandle = setTimeout(() => toast.classList.remove('show'), 2200);
}
function setBusy(button, busy, busyText = 'Saving…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}
function refreshClocks() {
  document.querySelectorAll('[data-step-age-id]').forEach(el => {
    const step = steps.find(s => s.id === el.dataset.stepAgeId);
    if (step) el.textContent = stepAge(step);
  });
  document.querySelectorAll('[data-active-time-id]').forEach(el => {
    const step = steps.find(s => s.id === el.dataset.activeTimeId);
    if (step) el.textContent = activeTime(step);
  });
}

async function boot() {
  if (!configured) {
    authView.innerHTML = `<div class="auth-wrap"><div class="brand"><small>Setup required</small>close.</div><div class="auth-copy"><h1>Connect Supabase.</h1><p>Open <strong>config.js</strong>, paste your project URL and publishable/anon key, then reload.</p></div></div>`;
    return;
  }

  const { data } = await supabase.auth.getSession();
  session = data.session;
  renderAuthState();

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession;
    renderAuthState();
    if (session) setTimeout(() => loadData(), 0);
  });

  if (session) await loadData();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  clockHandle = setInterval(refreshClocks, 1000);
}

function renderAuthState() {
  authView.classList.toggle('hidden', !!session);
  mainView.classList.toggle('hidden', !session);
  if (!session) {
    activeLoopId = null;
    dashboardView.classList.remove('hidden');
    loopView.classList.add('hidden');
  }
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#auth-error').textContent = '';
  const button = $('#login-btn');
  setBusy(button, true, 'Signing in…');
  const { error } = await supabase.auth.signInWithPassword({
    email: $('#email').value.trim(),
    password: $('#password').value
  });
  setBusy(button, false);
  if (error) $('#auth-error').textContent = error.message;
});
$('#signout-btn').addEventListener('click', () => supabase.auth.signOut());

async function loadData() {
  const [{data: loopData, error: loopError}, {data: stepData, error: stepError}] = await Promise.all([
    supabase.from('loops').select('*').order('created_at', {ascending:false}),
    supabase.from('steps').select('*').order('position', {ascending:true})
  ]);
  if (loopError || stepError) {
    console.error(loopError || stepError);
    showToast((loopError || stepError).message);
    return;
  }
  loops = loopData || [];
  steps = stepData || [];
  if (activeLoopId && !loops.some(loop => loop.id === activeLoopId)) activeLoopId = null;
  activeLoopId ? renderLoop() : renderDashboard();
}

function renderDashboard() {
  dashboardView.classList.remove('hidden');
  loopView.classList.add('hidden');
  activeLoopId = null;

  const openLoops = loops.filter(loop => loop.status === 'open');
  const closedLoops = loops.filter(loop => loop.status === 'closed');
  const currents = openLoops.map(loop => currentStep(loop.id)).filter(Boolean);
  const waiting = currents.filter(step => step.status === 'waiting').length;
  const delegated = currents.filter(step => step.status === 'delegated').length;
  const late = currents.filter(isOverdue).length;

  $('#open-count').textContent = openLoops.length;
  const parts = [];
  if (waiting) parts.push(`${waiting} waiting`);
  if (delegated) parts.push(`${delegated} delegated`);
  if (late) parts.push(`${late} late`);
  $('#dashboard-subline').innerHTML = parts.length
    ? `<span class="accent-dot"></span><span>${parts.join(' · ')}</span>`
    : `<span>${openLoops.length ? 'Everything has a next move.' : 'Nothing open.'}</span>`;

  if (!openLoops.length) {
    loopsList.innerHTML = `<div class="empty">No open loops.<div class="empty-action"><button class="primary" id="empty-new-loop">Start a loop</button></div></div>`;
    $('#empty-new-loop').onclick = () => openLoopDialog();
  } else {
    loopsList.innerHTML = openLoops.map(loop => loopRowHtml(loop, false)).join('');
    loopsList.querySelectorAll('[data-loop-id]').forEach(row => row.onclick = () => openLoop(row.dataset.loopId));
  }

  const closedSection = $('#closed-section');
  closedSection.classList.toggle('hidden', !closedLoops.length);
  $('#closed-count').textContent = closedLoops.length;
  closedList.innerHTML = closedLoops.map(loop => loopRowHtml(loop, true)).join('');
  closedList.querySelectorAll('[data-loop-id]').forEach(row => row.onclick = () => openLoop(row.dataset.loopId));

  refreshClocks();
}

function loopRowHtml(loop, closed) {
  const loopStepList = loopSteps(loop.id);
  const completed = loopStepList.filter(step => step.status === 'closed').length;
  const current = currentStep(loop.id);
  const next = current || firstOpenStep(loop.id);
  const dot = stateDotClass(next);
  let meta = '';
  if (closed) {
    meta = `<span>Closed${loop.closed_at ? ` ${esc(fmtDate(loop.closed_at))}` : ''}</span>`;
  } else if (current) {
    const state = isOverdue(current) ? 'late' : STATUS_LABEL[current.status].toLowerCase();
    meta = `<span class="state-dot ${dot}"></span><strong>${esc(current.title)}</strong><span>${esc(state)}</span>`;
  } else if (next) {
    meta = `<span class="state-dot"></span><strong>${esc(next.title)}</strong><span>next</span>`;
  } else {
    meta = `<span class="state-dot"></span><strong>Add the first move</strong>`;
  }
  return `<article class="loop-row" data-loop-id="${loop.id}">
    <div><h2 class="loop-title">${esc(loop.title)}</h2><div class="loop-meta">${meta}</div></div>
    <div class="loop-side">
      <div class="loop-age" ${current ? `data-step-age-id="${current.id}"` : ''}>${current ? stepAge(current) : '—'}</div>
      <div class="loop-count">${completed} / ${loopStepList.length}</div>
    </div>
  </article>`;
}

function openLoop(id) {
  activeLoopId = id;
  dashboardView.classList.add('hidden');
  loopView.classList.remove('hidden');
  window.scrollTo({top:0, behavior:'instant'});
  renderLoop();
}
$('#back-btn').onclick = () => renderDashboard();

function renderLoop() {
  const loop = loops.find(item => item.id === activeLoopId);
  if (!loop) return renderDashboard();

  $('#detail-title').textContent = loop.title;
  abCard.innerHTML = `<div class="ab-head"><div class="ab-letter">A.</div><div class="ab-arrow"></div><div class="ab-letter right">B.</div></div><div class="ab-text"><div><strong>Right now</strong>${esc(loop.current_state)}</div><div><strong>Done means</strong>${esc(loop.desired_state)}</div></div>`;
  abCard.onclick = () => openLoopDialog(loop);

  renderCurrent();
  renderTimeline();
  refreshClocks();
}

function renderCurrent() {
  const loop = loops.find(item => item.id === activeLoopId);
  if (!loop) return;
  const loopStepList = loopSteps(activeLoopId);
  const current = currentStep(activeLoopId);

  if (!current) {
    if (!loopStepList.length) {
      currentWrap.innerHTML = `<div class="focus-label"><div class="eyebrow">Next move</div></div><section class="next-card"><h3>What has to happen first?</h3><p>Add one clear box. It becomes current automatically.</p><button id="first-step-btn" class="primary full">Add first step</button></section>`;
      $('#first-step-btn').onclick = () => openStepDialog(null, '__START__');
      return;
    }

    const openSteps = loopStepList.filter(step => step.status !== 'closed');
    if (!openSteps.length) {
      currentWrap.innerHTML = `<div class="focus-label"><div class="eyebrow">Path clear</div></div><section class="finish-card"><h3>Is B true?</h3><p>${esc(loop.desired_state)}</p><div class="action-row"><button id="close-loop-now" class="primary">Close loop</button><button id="add-another-step" class="secondary">Add step</button></div></section>`;
      $('#close-loop-now').onclick = () => toggleLoop(loop, true);
      $('#add-another-step').onclick = () => openStepDialog(null, loopStepList[loopStepList.length - 1]?.id || '__START__');
      return;
    }

    const next = openSteps[0];
    currentWrap.innerHTML = `<div class="focus-label"><div class="eyebrow">Next move</div></div><section class="next-card"><h3>${esc(next.title)}</h3><p>No box is marked current. Make this one current and keep moving.</p><button id="make-next-current" class="primary full">Make current</button></section>`;
    $('#make-next-current').onclick = () => makeCurrent(next.id);
    return;
  }

  const meta = [];
  if (current.status === 'waiting' && current.waiting_on) meta.push(`<span><b>Waiting on</b> ${esc(current.waiting_on)}</span>`);
  else if (current.status === 'delegated' && current.delegated_to) meta.push(`<span><b>Delegated to</b> ${esc(current.delegated_to)}</span>`);
  else meta.push(`<span><b>Status</b> ${esc(STATUS_LABEL[current.status])}</span>`);
  if (current.deadline) meta.push(`<span class="${isOverdue(current) ? 'overdue-text' : ''}"><b>${isOverdue(current) ? 'Late' : 'Due'}</b> ${esc(fmtDate(current.deadline))}</span>`);

  currentWrap.innerHTML = `<div class="focus-label"><div class="eyebrow">Current step</div><div class="focus-age">open <span data-step-age-id="${current.id}">${stepAge(current)}</span> · worked <span data-active-time-id="${current.id}">${activeTime(current)}</span></div></div>
    <section class="current-card">
      <div class="current-card-header"><h1 class="current-title">${esc(current.title)}</h1><button id="edit-current-btn" class="current-edit">Edit</button></div>
      <div class="current-meta">${meta.join('')}</div>
      ${current.hard_rule ? `<div class="rule-line"><b>Rule:</b> ${esc(current.hard_rule)}</div>` : ''}
      ${current.delegation_note ? `<div class="delegation-line"><b>Handed off:</b> ${esc(current.delegation_note)}</div>` : ''}
      <div class="action-row"><button class="primary" id="close-current-btn">Close step</button><button class="secondary timer-btn ${current.timer_started_at ? 'running' : ''}" id="timer-current-btn">${current.timer_started_at ? 'Stop timer' : 'Start timer'}</button></div>
    </section>`;

  $('#edit-current-btn').onclick = () => openStepDialog(current);
  $('#close-current-btn').onclick = () => requestCloseStep(current.id);
  $('#timer-current-btn').onclick = event => current.timer_started_at ? stopTimer(current.id, event.currentTarget) : startTimer(current.id, event.currentTarget);
}

function renderTimeline() {
  const loopStepList = loopSteps(activeLoopId);
  if (!loopStepList.length) {
    timeline.innerHTML = `<div class="empty">Your path will build as the work reveals itself.</div>`;
    return;
  }

  timeline.innerHTML = loopStepList.map((step, index) => {
    const meta = [];
    if (step.status === 'closed') meta.push(`<span data-active-time-id="${step.id}">${activeTime(step)}</span> active`);
    else {
      if (step.status === 'waiting' && step.waiting_on) meta.push(`waiting on ${esc(step.waiting_on)}`);
      else if (step.status === 'delegated' && step.delegated_to) meta.push(`delegated to ${esc(step.delegated_to)}`);
      else meta.push(esc(STATUS_LABEL[step.status].toLowerCase()));
      if (step.deadline) meta.push(`<span class="${isOverdue(step) ? 'overdue-text' : ''}">${isOverdue(step) ? 'late' : 'due'} ${esc(fmtDate(step.deadline))}</span>`);
    }
    return `<article class="step ${step.status === 'closed' ? 'closed' : ''} ${step.is_current ? 'current' : ''}" data-step-row="${step.id}">
      <div class="step-mark">${step.status === 'closed' ? '✓' : index + 1}</div>
      <div><div class="step-name">${esc(step.title)}</div><div class="step-meta">${meta.join(' · ')}</div></div>
      <button class="step-menu" data-edit-step="${step.id}" aria-label="Edit step">···</button>
    </article>`;
  }).join('');

  timeline.querySelectorAll('[data-step-row]').forEach(row => {
    row.onclick = event => {
      if (event.target.closest('[data-edit-step]')) return;
      openStepDialog(steps.find(step => step.id === row.dataset.stepRow));
    };
  });
  timeline.querySelectorAll('[data-edit-step]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      openStepDialog(steps.find(step => step.id === button.dataset.editStep));
    };
  });
}

$('#new-loop-btn').onclick = () => openLoopDialog();
$('#loop-settings-btn').onclick = () => openLoopDialog(loops.find(loop => loop.id === activeLoopId));
$('#add-step-btn').onclick = () => {
  const current = currentStep(activeLoopId);
  const loopStepList = loopSteps(activeLoopId);
  openStepDialog(null, current?.id || loopStepList[loopStepList.length - 1]?.id || '__START__');
};
document.querySelectorAll('[data-close]').forEach(button => {
  button.onclick = () => document.getElementById(button.dataset.close).close();
});

function openLoopDialog(loop = null) {
  $('#loop-form').reset();
  $('#loop-id').value = loop?.id || '';
  $('#loop-dialog-title').textContent = loop ? 'Loop settings' : 'New loop';
  $('#loop-dialog-eyebrow').textContent = loop ? 'A → B' : 'Start with the ends';
  $('#first-step-field').classList.toggle('hidden', !!loop);
  $('#loop-danger-zone').classList.toggle('hidden', !loop);
  $('#save-loop-btn').disabled = false;
  $('#save-loop-btn').textContent = loop ? 'Save changes' : 'Create loop';

  if (loop) {
    $('#loop-title').value = loop.title;
    $('#loop-a').value = loop.current_state;
    $('#loop-b').value = loop.desired_state;
    $('#toggle-loop-btn').textContent = loop.status === 'closed' ? 'Reopen loop' : 'Close loop';
  }
  loopDialog.showModal();
  setTimeout(() => $('#loop-title').focus(), 50);
}

$('#loop-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#save-loop-btn');
  setBusy(button, true);

  const id = $('#loop-id').value;
  const payload = {
    title: $('#loop-title').value.trim(),
    current_state: $('#loop-a').value.trim(),
    desired_state: $('#loop-b').value.trim()
  };

  let result;
  if (id) result = await supabase.from('loops').update(payload).eq('id', id).select().single();
  else result = await supabase.from('loops').insert({...payload, user_id: session.user.id}).select().single();

  if (result.error) {
    setBusy(button, false);
    showToast(result.error.message);
    return;
  }

  if (!id) {
    const firstMove = $('#loop-first-step').value.trim();
    if (firstMove) {
      const { error } = await supabase.from('steps').insert({
        loop_id: result.data.id,
        user_id: session.user.id,
        title: firstMove,
        position: 1000,
        status: 'active',
        is_current: true,
        started_at: new Date().toISOString()
      });
      if (error) showToast(`Loop created. First step failed: ${error.message}`);
    }
  }

  setBusy(button, false);
  loopDialog.close();
  await loadData();
  if (!id) openLoop(result.data.id);
});

$('#toggle-loop-btn').onclick = async () => {
  const loop = loops.find(item => item.id === $('#loop-id').value);
  if (!loop) return;
  loopDialog.close();
  await toggleLoop(loop);
};

$('#delete-loop-btn').onclick = async () => {
  const loop = loops.find(item => item.id === $('#loop-id').value);
  if (!loop) return;
  if (!confirm(`Delete “${loop.title}” and every step in it?`)) return;
  const { error } = await supabase.from('loops').delete().eq('id', loop.id);
  if (error) return showToast(error.message);
  loopDialog.close();
  activeLoopId = null;
  await loadData();
  showToast('Loop deleted');
};

function setStepState(status) {
  $('#step-status').value = status;
  document.querySelectorAll('[data-state]').forEach(button => button.classList.toggle('selected', button.dataset.state === status));
  $('#waiting-field').classList.toggle('hidden', status !== 'waiting');
  $('#delegated-fields').classList.toggle('hidden', status !== 'delegated');
  if (status === 'waiting') setTimeout(() => $('#step-waiting-on').focus(), 20);
  if (status === 'delegated') setTimeout(() => $('#step-delegated-to').focus(), 20);
}
document.querySelectorAll('[data-state]').forEach(button => button.onclick = () => setStepState(button.dataset.state));

function openStepDialog(step = null, insertAfter = null) {
  $('#step-form').reset();
  $('#step-more').open = false;
  $('#step-id').value = step?.id || '';
  $('#step-insert-after').value = insertAfter || '';
  $('#step-dialog-title').textContent = step ? (step.status === 'closed' ? 'Closed step' : 'Edit step') : 'Add step';
  $('#add-after-step-btn').classList.toggle('hidden', !step);
  $('#delete-step-btn').classList.toggle('hidden', !step);
  $('#reopen-step-btn').classList.toggle('hidden', !step || step.status !== 'closed');
  $('#state-block').classList.toggle('hidden', step?.status === 'closed');

  const hasCurrent = !!currentStep(activeLoopId);
  const defaultStatus = hasCurrent ? 'not_started' : 'active';
  setStepState(step?.status || defaultStatus);

  if (step) {
    $('#step-title').value = step.title || '';
    $('#step-waiting-on').value = step.waiting_on || '';
    $('#step-delegated-to').value = step.delegated_to || '';
    $('#step-delegation-note').value = step.delegation_note || '';
    $('#step-hard-rule').value = step.hard_rule || '';
    if (step.deadline) {
      const date = new Date(step.deadline);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
      $('#step-deadline').value = local;
      $('#step-more').open = true;
    }
    if (step.hard_rule) $('#step-more').open = true;
  }

  $('#save-step-btn').disabled = false;
  $('#save-step-btn').textContent = 'Save step';
  $('#make-current-btn').disabled = false;
  $('#make-current-btn').textContent = 'Make current';
  $('#make-current-btn').classList.toggle('hidden', !step || step.status === 'closed' || step.is_current);
  stepDialog.showModal();
  setTimeout(() => $('#step-title').focus(), 50);
}

$('#add-after-step-btn').onclick = () => {
  const id = $('#step-id').value;
  stepDialog.close();
  setTimeout(() => openStepDialog(null, id), 100);
};

function positionForInsert(loopId, insertAfter) {
  const loopStepList = loopSteps(loopId);
  if (!loopStepList.length) return 1000;
  if (insertAfter === '__START__') return Number(loopStepList[0].position) - 1000;
  const index = loopStepList.findIndex(step => step.id === insertAfter);
  if (index < 0 || index === loopStepList.length - 1) return Number(loopStepList[loopStepList.length - 1].position) + 1000;
  return (Number(loopStepList[index].position) + Number(loopStepList[index + 1].position)) / 2;
}

$('#step-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#save-step-btn');
  const id = $('#step-id').value;
  const existing = id ? steps.find(step => step.id === id) : null;
  const status = existing?.status === 'closed' ? 'closed' : $('#step-status').value;
  const title = $('#step-title').value.trim();
  const deadline = $('#step-deadline').value ? new Date($('#step-deadline').value).toISOString() : null;

  if (status === 'waiting' && !$('#step-waiting-on').value.trim()) {
    $('#step-waiting-on').focus();
    return showToast('Who are you waiting on?');
  }
  if (status === 'delegated' && !$('#step-delegated-to').value.trim()) {
    $('#step-delegated-to').focus();
    return showToast('Who owns the delegated move?');
  }

  const ownership = status === 'waiting'
    ? {waiting_on: $('#step-waiting-on').value.trim(), delegated_to:null, delegation_note:null}
    : status === 'delegated'
      ? {waiting_on:null, delegated_to:$('#step-delegated-to').value.trim(), delegation_note:$('#step-delegation-note').value.trim() || null}
      : {waiting_on:null, delegated_to:null, delegation_note:null};

  const payload = {
    title,
    status,
    ...ownership,
    hard_rule: $('#step-hard-rule').value.trim() || null,
    deadline,
    started_at: status !== 'not_started' && status !== 'closed' ? (existing?.started_at || new Date().toISOString()) : (existing?.started_at || null),
    completed_at: status === 'closed' ? (existing?.completed_at || new Date().toISOString()) : null
  };

  setBusy(button, true);
  let result;
  if (id) {
    result = await supabase.from('steps').update(payload).eq('id', id).select().single();
  } else {
    const shouldBeCurrent = !currentStep(activeLoopId);
    result = await supabase.from('steps').insert({
      ...payload,
      loop_id: activeLoopId,
      user_id: session.user.id,
      position: positionForInsert(activeLoopId, $('#step-insert-after').value || '__START__'),
      is_current: shouldBeCurrent,
      status: shouldBeCurrent && status === 'not_started' ? 'active' : status,
      started_at: shouldBeCurrent && status === 'not_started' ? new Date().toISOString() : payload.started_at
    }).select().single();
  }

  if (result.error) {
    setBusy(button, false);
    showToast(result.error.message);
    return;
  }

  setBusy(button, false);
  stepDialog.close();
  await loadData();
  showToast(id ? 'Step updated' : 'Step added');
});

$('#make-current-btn').onclick = async () => {
  const id = $('#step-id').value;
  if (!id) return;
  const button = $('#make-current-btn');
  setBusy(button, true, 'Making current…');
  setBusy(button, false);
  stepDialog.close();
  await makeCurrent(id);
};

$('#reopen-step-btn').onclick = async () => {
  const id = $('#step-id').value;
  if (!id) return;
  const { error } = await supabase.from('steps').update({status:'not_started', completed_at:null, is_current:false}).eq('id', id);
  if (error) return showToast(error.message);
  stepDialog.close();
  await loadData();
  showToast('Step reopened');
};

$('#delete-step-btn').onclick = async () => {
  const id = $('#step-id').value;
  const step = steps.find(item => item.id === id);
  if (!step) return;
  if (!confirm(`Delete “${step.title}”?`)) return;
  const wasCurrent = step.is_current;
  const { error } = await supabase.from('steps').delete().eq('id', id);
  if (error) return showToast(error.message);
  stepDialog.close();
  await loadData();
  if (wasCurrent) {
    const next = firstOpenStep(activeLoopId);
    if (next) await makeCurrent(next.id);
  }
  showToast('Step deleted');
};

async function makeCurrent(id, reload = true) {
  const target = steps.find(step => step.id === id);
  if (!target || target.status === 'closed') return;

  let { error } = await supabase.from('steps').update({is_current:false}).eq('loop_id', target.loop_id).eq('user_id', session.user.id);
  if (error) return showToast(error.message);

  const patch = {is_current:true};
  if (target.status === 'not_started') {
    patch.status = 'active';
    patch.started_at = target.started_at || new Date().toISOString();
  }
  ({ error } = await supabase.from('steps').update(patch).eq('id', id));
  if (error) return showToast(error.message);

  if (reload) await loadData();
  showToast('Current step set');
}

function requestCloseStep(id) {
  const step = steps.find(item => item.id === id);
  if (!step) return;
  if (step.hard_rule) {
    pendingCloseStepId = id;
    $('#rule-dialog-text').textContent = step.hard_rule;
    ruleDialog.showModal();
  } else {
    closeStep(id);
  }
}

ruleDialog.addEventListener('close', () => {
  if (ruleDialog.returnValue === 'confirm' && pendingCloseStepId) closeStep(pendingCloseStepId);
  pendingCloseStepId = null;
});

async function closeStep(id) {
  const step = steps.find(item => item.id === id);
  if (!step) return;

  let seconds = Number(step.active_seconds || 0);
  if (step.timer_started_at) seconds += Math.floor((Date.now() - new Date(step.timer_started_at)) / 1000);

  const loopStepListBefore = loopSteps(step.loop_id);
  const index = loopStepListBefore.findIndex(item => item.id === id);
  const next = loopStepListBefore.slice(index + 1).find(item => item.status !== 'closed') || null;

  const { error } = await supabase.from('steps').update({
    status:'closed',
    is_current:false,
    completed_at:new Date().toISOString(),
    timer_started_at:null,
    active_seconds:seconds
  }).eq('id', id);
  if (error) return showToast(error.message);

  if (next) {
    const { error: clearError } = await supabase.from('steps').update({is_current:false}).eq('loop_id', step.loop_id).eq('user_id', session.user.id);
    if (clearError) return showToast(clearError.message);
    const patch = {is_current:true};
    if (next.status === 'not_started') {
      patch.status = 'active';
      patch.started_at = next.started_at || new Date().toISOString();
    }
    const { error: nextError } = await supabase.from('steps').update(patch).eq('id', next.id);
    if (nextError) return showToast(nextError.message);
  }

  await loadData();
  showToast(next ? 'Step closed. Next move is current.' : 'Path clear. Check B.');
}

async function startTimer(id, button) {
  const step = steps.find(item => item.id === id);
  if (!step) return;
  setBusy(button, true, 'Starting…');
  const patch = {
    timer_started_at:new Date().toISOString(),
    started_at:step.started_at || new Date().toISOString()
  };
  if (step.status !== 'active') {
    patch.status = 'active';
    patch.waiting_on = null;
    patch.delegated_to = null;
    patch.delegation_note = null;
  }
  const { error } = await supabase.from('steps').update(patch).eq('id', id);
  if (error) {
    setBusy(button, false);
    return showToast(error.message);
  }
  await loadData();
}

async function stopTimer(id, button) {
  const step = steps.find(item => item.id === id);
  if (!step?.timer_started_at) return;
  setBusy(button, true, 'Stopping…');
  const seconds = Number(step.active_seconds || 0) + Math.floor((Date.now() - new Date(step.timer_started_at)) / 1000);
  const { error } = await supabase.from('steps').update({timer_started_at:null, active_seconds:seconds}).eq('id', id);
  if (error) {
    setBusy(button, false);
    return showToast(error.message);
  }
  await loadData();
}

async function toggleLoop(loop, skipOpenStepCheck = false) {
  const closing = loop.status === 'open';
  if (closing && !skipOpenStepCheck) {
    const openSteps = loopSteps(loop.id).filter(step => step.status !== 'closed');
    if (openSteps.length && !confirm(`This loop still has ${openSteps.length} open step${openSteps.length === 1 ? '' : 's'}. Close it anyway?`)) return;
  }

  const { error } = await supabase.from('loops').update({
    status: closing ? 'closed' : 'open',
    closed_at: closing ? new Date().toISOString() : null
  }).eq('id', loop.id);
  if (error) return showToast(error.message);

  if (!closing) {
    activeLoopId = loop.id;
    await loadData();
    openLoop(loop.id);
    showToast('Loop reopened');
  } else {
    activeLoopId = null;
    await loadData();
    showToast('Loop closed');
  }
}

boot();

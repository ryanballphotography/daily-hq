// Redirect to login on expired session
const _nativeFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await _nativeFetch(...args);
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Session expired — redirecting to login');
  }
  return res;
};

// Check auth when returning to the tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') fetch('/api/ping');
});

// Native date/time inputs only open their picker if the click lands on the
// tiny calendar-icon hit target. Force it open on any click in the field.
document.addEventListener('click', e => {
  const el = e.target;
  if (el.matches && el.matches('input[type="date"], input[type="time"]') && el.showPicker) {
    try { el.showPicker(); } catch (err) {}
  }
});

const today = (() => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
})();
let tasks = [];

document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  setDate();
  loadTasks();
  loadShootTasksForToday();
  bindNav();
  bindModal();
  bindQuickAdd();
  bindTimelineDnD();
  bindCmdk();
  showInboxPrompt();
  loadContacts();
});

function setDate() {
  const d = new Date();
  document.getElementById('topbar-date').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function bindNav() {
  document.querySelectorAll('.ni[data-view]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
      el.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
      const view = el.dataset.view;
      document.getElementById('view-' + view).classList.remove('hidden');
      document.getElementById('topbar-title').textContent = el.textContent.trim().replace(/\d+/, '').trim();
      if (view === 'today') renderToday();
      if (view === 'all') renderAll();
      if (view === 'completed') renderCompleted();
      if (view === 'calendar') showCalendarView();
      if (view === 'inbox') showInboxPrompt();
      if (view === 'timeline') renderTimelineFeed(true);
      if (view === 'scheduled') renderScheduled();
      if (view === 'marketing') {
        loadContacts().then(() => {
          renderMarketing();
          loadMarketingContent().then(renderMktContent);
        });
      }
    });
  });
  document.querySelectorAll('.ni.ext').forEach(el => {
    el.addEventListener('click', () => window.open(el.dataset.url, '_blank'));
  });
  document.getElementById('btn-add-task').addEventListener('click', openModal);
}

async function loadTasks() {
  const res = await fetch('/api/tasks');
  tasks = await res.json();
  updateBadge();
  renderToday();
}

async function createTask(data) {
  const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const task = await res.json();
  tasks.unshift(task);
  updateBadge();
  renderToday();
}

async function completeTask(id) {
  await fetch('/api/tasks/' + id + '/complete', { method: 'PATCH' });
  tasks = tasks.filter(t => t.id !== id);
  updateBadge();
  renderToday();
  renderAll();
}

async function deleteTask(id) {
  await fetch('/api/tasks/' + id, { method: 'DELETE' });
  tasks = tasks.filter(t => t.id !== id);
  updateBadge();
  renderToday();
  renderAll();
}

function updateBadge() {
  const badge = document.getElementById('task-badge');
  badge.textContent = tasks.length || '';
  badge.style.display = tasks.length ? 'inline' : 'none';
}

function isOverdue(due) { return due && due.split('T')[0] < today; }
function isDueToday(due) { return due && due.split('T')[0] === today; }

function formatDate(due) {
  if (!due) return '';
  const d = due.split('T')[0];
  if (d === today) return 'Today';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Bang count that would re-derive the task's current DB priority when reparsed.
const PRIORITY_TO_BANGS = { p1: '!!', p2: '!', p3: '' };

// Tasks created before the sentence parser existed (or edited via the old
// field-based flow) have no raw_text. Reconstruct an equivalent sentence from
// their structured fields so reopening+saving without changes doesn't lose
// the due date/time/priority/tag — dates are written as ISO (YYYY-MM-DD),
// which chrono reads unambiguously regardless of locale.
// The original sentence is only safe to hand back for editing while it still
// describes the task. Saving re-parses it server-side, so a stale one (task
// dragged to another day, or typed as "friday" and opened next week) would
// silently overwrite the real date with whatever the words parse to today.
function rawTextStillMatches(t) {
  const p = parseTask(t.raw_text);
  const due = p.dueAt ? localDateStr(p.dueAt) : null;
  const time = p.hasTime ? String(p.dueAt.getHours()).padStart(2, '0') + ':' + String(p.dueAt.getMinutes()).padStart(2, '0') : null;
  return due === (t.due_date ? t.due_date.split('T')[0] : null) && time === (t.time_block || null);
}

function taskToSentence(t) {
  if (t.raw_text && rawTextStillMatches(t)) return t.raw_text;
  let s = t.title || '';
  if (t.tag) s += ' #' + t.tag;
  if (t.due_date) {
    s += ' ' + t.due_date.split('T')[0];
    if (t.time_block) s += ' ' + t.time_block;
  }
  // After the date, not before: the parser rejects an @Name that's followed
  // by a digit (so "@10am" isn't read as a contact).
  if (t.contact) s += ' @' + t.contact;
  const bangs = PRIORITY_TO_BANGS[t.priority];
  if (bangs) s += ' ' + bangs;
  return s.trim();
}

async function editTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  document.getElementById('m-title').value = taskToSentence(t);
  document.getElementById('m-notes').value = t.notes || '';
  document.getElementById('m-category').value = t.category || 'work';
  document.getElementById('m-recurring').value = t.recurring || '';
  resetPickerFields(t.due_date ? t.due_date.split('T')[0] : '', t.time_block || '');
  document.getElementById('modal-bg').classList.remove('hidden');
  document.getElementById('modal-bg')._editId = id;
  updatePreview();
  setTimeout(() => document.getElementById('m-title').focus(), 50);
}

function taskHTML(t) {
  const od = isOverdue(t.due_date);
  const cat = t.category || 'work';
  return `
    <div class="task" id="task-${t.id}" ondblclick="editTask(${t.id})">
      <div class="check ${t.priority || ''}" onclick="completeTask(${t.id})"></div>
      <div class="task-body">
        <div class="task-title">${t.title}</div>
        <div class="task-meta">
          <span class="tag tag-${cat}">${cat}</span>
          ${t.tag ? '<span class="tag">#' + t.tag + '</span>' : ''}
          ${t.contact ? '<span class="tag">@' + t.contact + '</span>' : ''}
          ${t.due_date ? '<span class="task-date ' + (od ? 'overdue' : '') + '">' + (od ? '⚠ ' : '') + formatDate(t.due_date) + '</span>' : ''}
          ${t.time_block ? '<span class="task-time">🕐 ' + t.time_block + '</span>' : ''}
          ${t.recurring ? '<span class="tag">↻ ' + t.recurring + '</span>' : ''}
        </div>
      </div>
      <i class="ti ti-pencil task-del" onclick="editTask(${t.id})" style="margin-right:2px;"></i>
      <i class="ti ti-trash task-del" onclick="deleteTask(${t.id})"></i>
    </div>`;
}

function sortTasks(list) {
  const pOrder = { p1: 1, p2: 2, p3: 3 };
  return list.sort((a, b) => {
    const aOver = isOverdue(a.due_date);
    const bOver = isOverdue(b.due_date);
    // Overdue first, sorted by date then priority
    if (aOver && !bOver) return -1;
    if (!aOver && bOver) return 1;
    // Both have dates - sort by date first, then priority
    if (a.due_date && b.due_date) {
      const dateDiff = a.due_date.localeCompare(b.due_date);
      if (dateDiff !== 0) return dateDiff;
      return (pOrder[a.priority] || 3) - (pOrder[b.priority] || 3);
    }
    // Dated tasks before undated
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    // Both undated - sort by priority
    return (pOrder[a.priority] || 3) - (pOrder[b.priority] || 3);
  });
}

function getWeekBounds(offsetWeeks = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon + (offsetWeeks * 7));
  mon.setHours(0,0,0,0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23,59,59,999);
  return { start: mon, end: sun };
}

function makeSection(label, tasks, collapsed = false) {
  if (!tasks.length) return '';
  const id = 'section-' + label.toLowerCase().replace(/[^a-z]/g, '');
  const chevronIcon = collapsed ? 'right' : 'down';
  let html = '<div class="section-header collapsible-header" data-target="' + id + '">' +
    '<span class="section-lbl" style="margin:0;">' + label + ' <span style="color:var(--text3);font-weight:400;">(' + tasks.length + ')</span></span>' +
    '<i class="ti ti-chevron-' + chevronIcon + '" style="font-size:13px;color:var(--text3);" id="chevron-' + id + '"></i>' +
    '</div>';
  html += '<div id="' + id + '"' + (collapsed ? ' class="hidden"' : '') + '>';
  html += tasks.map(taskHTML).join('');
  html += '</div>';
  return html;
}

function toggleSection(id) {
  const el = document.getElementById(id);
  const chevron = document.getElementById('chevron-' + id);
  if (!el) return;
  el.classList.toggle('hidden');
  if (chevron) chevron.className = 'ti ti-chevron-' + (el.classList.contains('hidden') ? 'right' : 'down');
}

function renderToday() {
  renderTimelineFeed();
  const el = document.getElementById('today-tasks');
  const sorted = sortTasks([...tasks]);
  const thisWeekBounds = getWeekBounds(0);
  const nextWeekBounds = getWeekBounds(1);

  const overdue = sorted.filter(t => isOverdue(t.due_date));
  const dueToday = sorted.filter(t => isDueToday(t.due_date));
  const p1NoDue = sorted.filter(t => !t.due_date && t.priority === 'p1');
  const thisWeek = sorted.filter(t => {
    if (!t.due_date || isOverdue(t.due_date) || isDueToday(t.due_date)) return false;
    const d = new Date(t.due_date.split('T')[0] + 'T00:00:00');
    return d >= thisWeekBounds.start && d <= thisWeekBounds.end;
  });
  const nextWeek = sorted.filter(t => {
    if (!t.due_date || isOverdue(t.due_date) || isDueToday(t.due_date)) return false;
    const d = new Date(t.due_date.split('T')[0] + 'T00:00:00');
    return d >= nextWeekBounds.start && d <= nextWeekBounds.end;
  });
  const upNext = sorted.filter(t => {
    if (!t.due_date || isOverdue(t.due_date) || isDueToday(t.due_date)) return false;
    const d = new Date(t.due_date.split('T')[0] + 'T00:00:00');
    return d > nextWeekBounds.end;
  });
  const undated = sorted.filter(t => !t.due_date && t.priority !== 'p1');

  let html = '';
  if (overdue.length) html += makeSection('Overdue', overdue, false);
  if (dueToday.length) html += makeSection('Today', dueToday, false);
  if (p1NoDue.length) html += makeSection('High priority', p1NoDue, false);
  if (thisWeek.length) html += makeSection('This week', thisWeek, false);
  if (nextWeek.length) html += makeSection('Next week', nextWeek, true);
  if (upNext.length) html += makeSection('Up next', upNext, true);
  if (undated.length) html += makeSection('No date', undated, true);
  if (!html) html = '<div class="empty">Nothing on your plate. Add a task or enjoy the quiet.</div>';
  el.innerHTML = html;
  // Attach section toggle listeners
  el.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', () => toggleSection(header.dataset.target));
  });
}

function renderAll() {
  const el = document.getElementById('all-tasks');
  if (!tasks.length) { el.innerHTML = '<div class="empty">No open tasks.</div>'; return; }
  const sorted = sortTasks([...tasks]);
  const overdue = sorted.filter(t => isOverdue(t.due_date));
  const dueToday = sorted.filter(t => isDueToday(t.due_date));
  const upcoming = sorted.filter(t => t.due_date && !isOverdue(t.due_date) && !isDueToday(t.due_date));
  const undated = sorted.filter(t => !t.due_date);
  let html = '';
  if (overdue.length) html += '<div class="section-lbl">Overdue</div>' + overdue.map(taskHTML).join('');
  if (dueToday.length) html += '<div class="section-lbl">Today</div>' + dueToday.map(taskHTML).join('');
  if (upcoming.length) html += '<div class="section-lbl">Upcoming</div>' + upcoming.map(taskHTML).join('');
  if (undated.length) html += '<div class="section-lbl">No date</div>' + undated.map(taskHTML).join('');
  el.innerHTML = html;
}

async function renderCompleted() {
  const el = document.getElementById('completed-tasks');
  el.innerHTML = '<div class="empty">Loading...</div>';
  const res = await fetch('/api/tasks/completed');
  const done = await res.json();
  if (!done.length) { el.innerHTML = '<div class="empty">Nothing completed yet.</div>'; return; }
  el.innerHTML = done.map(t => `
    <div class="task done">
      <div class="check checked" onclick="uncompleteTask(${t.id})" title="Mark incomplete"><i class="ti ti-check"></i></div>
      <div class="task-body">
        <div class="task-title">${t.title}</div>
        <div class="task-meta">
          <span class="tag tag-${t.category || 'work'}">${t.category || 'work'}</span>
          ${t.completed_at ? '<span class="task-date">' + new Date(t.completed_at).toLocaleDateString('en-GB', {day:'numeric',month:'short'}) + '</span>' : ''}
        </div>
      </div>
      <i class="ti ti-pencil task-del" onclick="editCompletedTask(${t.id})" style="margin-right:2px;"></i>
    </div>`).join('');
}

async function uncompleteTask(id) {
  await fetch('/api/tasks/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done: false, completed_at: null })
  });
  const res = await fetch('/api/tasks');
  tasks = await res.json();
  updateBadge();
  renderCompleted();
  renderToday();
}

async function editCompletedTask(id) {
  const res = await fetch('/api/tasks/completed');
  const done = await res.json();
  const t = done.find(t => t.id === id);
  if (!t) return;
  document.getElementById('m-title').value = taskToSentence(t);
  document.getElementById('m-notes').value = t.notes || '';
  document.getElementById('m-category').value = t.category || 'work';
  document.getElementById('m-recurring').value = t.recurring || '';
  const doneEl = document.getElementById('m-done');
  if (doneEl) doneEl.checked = t.done || false;
  resetPickerFields(t.due_date ? t.due_date.split('T')[0] : '', t.time_block || '');
  document.getElementById('modal-bg').classList.remove('hidden');
  document.getElementById('modal-bg')._editId = id;
  document.getElementById('modal-bg')._wasCompleted = t.done || false;
  updatePreview();
  setTimeout(() => document.getElementById('m-title').focus(), 50);
}

// ── Live parse preview ────────────────────────────────────────────────────
function formatPreview(p) {
  const parts = [];
  if (p.dueAt) {
    const d = new Date(p.dueAt);
    const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
    const month = d.toLocaleDateString('en-GB', { month: 'short' });
    let dateStr = weekday + ' ' + d.getDate() + ' ' + month;
    if (p.hasTime) {
      dateStr += ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    parts.push(dateStr);
  } else {
    parts.push('no date detected');
  }
  if (p.project) parts.push('#' + p.project);
  if (p.contact) parts.push(p.contact);
  if (p.priority > 1) parts.push('priority ' + p.priority);
  return parts.join(' · ');
}

function updatePreview() {
  const el = document.getElementById('m-preview');
  const text = document.getElementById('m-title').value;
  if (!text.trim()) { el.textContent = ''; return; }
  el.textContent = formatPreview(parseTask(text));
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 200);
}

// ── Inbox quick-add bar — same parser, same preview format, one keystroke ──
function updateQuickAddPreview() {
  const el = document.getElementById('quickadd-preview');
  const input = document.getElementById('quickadd-input');
  if (!el || !input) return;
  const text = input.value;
  if (!text.trim()) { el.innerHTML = ''; return; }
  const preview = formatPreview(parseTask(text)).replace(/#(\S+)/, '<span class="qa-tag">#$1</span>');
  el.innerHTML = '<span class="qa-dot"></span><span>' + preview + '</span>';
}

let quickAddPreviewTimer = null;
function scheduleQuickAddPreview() {
  clearTimeout(quickAddPreviewTimer);
  quickAddPreviewTimer = setTimeout(updateQuickAddPreview, 200);
}

async function submitQuickAdd() {
  const input = document.getElementById('quickadd-input');
  const rawText = input.value.trim();
  if (!rawText) return;
  await createTask({ raw_text: rawText, category: 'work', recurring: '' });
  input.value = '';
  document.getElementById('quickadd-preview').innerHTML = '';
}

function bindQuickAdd() {
  const input = document.getElementById('quickadd-input');
  if (!input) return;
  input.addEventListener('input', scheduleQuickAddPreview);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submitQuickAdd(); });
}

function bindModal() {
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  (() => {
  const bg = document.getElementById("modal-bg");
  let mousedownOnBg = false;
  bg.addEventListener("mousedown", e => { mousedownOnBg = e.target === bg; });
  bg.addEventListener("mouseup", e => { if (mousedownOnBg && e.target === bg) closeModal(); mousedownOnBg = false; });
})();
  document.getElementById('modal-save').addEventListener('click', saveModal);
  document.getElementById('m-title').addEventListener('keydown', e => { if (e.key === 'Enter') saveModal(); });
  document.getElementById('m-title').addEventListener('input', schedulePreview);
  document.getElementById('m-pick-toggle').addEventListener('click', () => {
    const el = document.getElementById('m-pick-fields');
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
  });
  document.getElementById('m-pick-date').addEventListener('change', applyPickedDate);
  document.getElementById('m-pick-time').addEventListener('change', applyPickedDate);

  // Single-key shortcuts, as long as you're not typing somewhere else or the
  // modal is already open: n = new task, t/w/s/c/m = jump to a nav tab.
  const NAV_SHORTCUTS = { i: 'inbox', t: 'today', l: 'timeline', s: 'scheduled', c: 'calendar', m: 'marketing' };
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.getElementById('modal-bg').classList.contains('hidden')) return;
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement.isContentEditable) return;
    const key = e.key.toLowerCase();
    if (key === 'n') {
      e.preventDefault();
      const quickAdd = document.getElementById('quickadd-input');
      const onInbox = quickAdd && !document.getElementById('view-inbox').classList.contains('hidden');
      if (onInbox) quickAdd.focus(); else openModal();
      return;
    }
    if (NAV_SHORTCUTS[key]) {
      const nav = document.querySelector('.ni[data-view="' + NAV_SHORTCUTS[key] + '"]');
      if (nav) { e.preventDefault(); nav.click(); }
    }
  });
}

// The sentence stays the source of truth even when using the manual picker:
// picking a date/time writes it into the sentence as plain text (replacing
// whatever this same picker last inserted) rather than as a hidden field
// that could disagree with what the parser derives from the text.
let pickerInsertion = null;
function applyPickedDate() {
  const dateVal = document.getElementById('m-pick-date').value;
  const timeVal = document.getElementById('m-pick-time').value;
  const titleEl = document.getElementById('m-title');
  if (pickerInsertion) {
    titleEl.value = titleEl.value.replace(pickerInsertion, '').trim();
    pickerInsertion = null;
  }
  // The sentence may already contain its own natural-language date (e.g.
  // "friday") from before the manual picker was touched. Without stripping
  // it, the picker's choice and the typed one both stay in the text and
  // disagree about the due date — chrono keeps whichever comes first and
  // silently drops the manual pick. Manually picking a date always wins.
  const existingParse = parseTask(titleEl.value);
  if (existingParse.dueAt) titleEl.value = existingParse.title;
  if (dateVal) {
    pickerInsertion = dateVal + (timeVal ? ' ' + timeVal : '');
    titleEl.value = (titleEl.value ? titleEl.value + ' ' : '') + pickerInsertion;
  }
  updatePreview();
}

function resetPickerFields(dateVal, timeVal) {
  document.getElementById('m-pick-date').value = dateVal || '';
  document.getElementById('m-pick-time').value = timeVal || '';
  document.getElementById('m-pick-fields').style.display = 'none';
  pickerInsertion = null;
}

function openModal() {
  document.getElementById('m-title').value = '';
  document.getElementById('m-notes').value = '';
  document.getElementById('m-category').value = 'work';
  document.getElementById('m-recurring').value = '';
  document.getElementById('m-preview').textContent = '';
  resetPickerFields();
  document.getElementById("modal-bg").classList.remove('hidden');
  setTimeout(() => document.getElementById('m-title').focus(), 50);
}

function closeModal() { document.getElementById("modal-bg").classList.add('hidden'); }

async function saveModal() {
  const rawText = document.getElementById('m-title').value.trim();
  if (!rawText) return;
  const editId = document.getElementById('modal-bg')._editId;
  const markDone = document.getElementById('m-done') && document.getElementById('m-done').checked;
  const wasCompleted = document.getElementById('modal-bg')._wasCompleted || false;
  if (editId && markDone && !wasCompleted) {
    await fetch('/api/tasks/' + editId + '/complete', { method: 'PATCH' });
    tasks = tasks.filter(t => t.id !== editId);
    updateBadge();
    document.getElementById('modal-bg')._editId = undefined;
    document.getElementById('modal-bg')._wasCompleted = undefined;
    const doneEl = document.getElementById('m-done'); if (doneEl) doneEl.checked = false;
    closeModal();
    renderToday(); renderAll();
    return;
  }
  if (editId && wasCompleted && !markDone) {
    await fetch('/api/tasks/' + editId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: false, completed_at: null }) });
    const freshRes = await fetch('/api/tasks');
    tasks = await freshRes.json();
    updateBadge();
    document.getElementById('modal-bg')._editId = undefined;
    document.getElementById('modal-bg')._wasCompleted = undefined;
    closeModal();
    renderToday(); renderAll(); renderCompleted();
    return;
  }
  if (editId) {
    // Edit existing task — the sentence is re-parsed server-side, which stays
    // the single source of truth for the derived fields.
    const res = await fetch('/api/tasks/' + editId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw_text: rawText,
        notes: document.getElementById('m-notes').value,
        category: document.getElementById('m-category').value,
        recurring: document.getElementById('m-recurring').value
      })
    });
    const updated = await res.json();
    const idx = tasks.findIndex(t => t.id === editId);
    if (idx !== -1) tasks[idx] = updated;
    document.getElementById('modal-bg')._editId = undefined;
  } else {
    await createTask({
      raw_text: rawText,
      notes: document.getElementById('m-notes').value,
      category: document.getElementById('m-category').value,
      recurring: document.getElementById('m-recurring').value
    });
    const idx = document.getElementById('modal-bg')._proposalIndex;
    if (idx !== undefined) {
      const el = document.getElementById('proposal-' + idx);
      if (el) el.remove();
      document.getElementById('modal-bg')._proposalIndex = undefined;
    }
  }
  renderToday();
  renderAll();
  closeModal();
}

async function loadCalendarEvents() {
  try {
    const res = await fetch('/api/calendar');
    const data = await res.json();
    return data.events || [];
  } catch(e) {
    console.log('Calendar unavailable', e);
    return [];
  }
}




function showInboxPrompt() {
  const el = document.getElementById('inbox-proposals');
  if (!el) return;
  if (el._loaded) return;
  el.innerHTML = '<div class="inbox-check-card"><div class="inbox-check-icon"><i class="ti ti-mail"></i></div><div><div style="font-size:12.5px;font-weight:600;">Check your inbox</div><button class="inbox-check-link" onclick="loadInbox()">Check emails →</button></div></div>';
}

async function loadInbox(reset = false) {
  const el = document.getElementById('inbox-proposals');
  const badge = document.getElementById('inbox-badge');
  if (!el) return;
  el.innerHTML = '<div class="empty">Checking emails...</div>';
  try {
    const res = await fetch('/api/gmail-summary' + (reset ? '?reset=1' : ''));
    const data = await res.json();
    if (!data.proposals || !data.proposals.length) {
      el.innerHTML = '<div class="empty">No emails needing action. All caught up.</div>';
      if (badge) { badge.style.display = 'none'; }
      return;
    }
    if (badge) { badge.textContent = data.proposals.length; badge.style.display = 'inline'; }
    let html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;"><div style="font-size:13px;font-weight:500;">' + data.proposals.length + ' email' + (data.proposals.length !== 1 ? 's' : '') + ' needing action</div><button onclick="loadInbox(true)" style="font-size:11px;padding:3px 10px;border:0.5px solid var(--border2);border-radius:6px;background:transparent;cursor:pointer;">Refresh</button></div>';
    data.proposals.forEach((p, i) => {
      html += `<div class="inbox-card" id="proposal-${i}">
        <div class="inbox-card-header">
          <div class="inbox-from">${p.from}</div>
          <span class="tag tag-${p.priority === 'p1' ? 'work' : p.priority === 'p2' ? 'home' : 'personal'}" style="font-size:10px;">${p.priority === 'p1' ? 'Urgent' : p.priority === 'p2' ? 'This week' : 'Low priority'}</span>
        </div>
        <div class="inbox-subject">${p.subject}</div>
        <div class="inbox-action">${p.action}</div>
        <div class="inbox-buttons">
          <button class="inbox-btn-accept" onclick="acceptProposal(${i})">+ Add to tasks</button>
          <button class="inbox-btn-skip" onclick="skipProposal(${i})">Skip</button>
        </div>
      </div>`;
    });
    el.innerHTML = html;
    el._proposals = data.proposals;
  } catch(e) {
    el.innerHTML = '<div class="empty">Email check unavailable.</div>';
  }
}

function acceptProposal(i) {
  const el = document.getElementById('inbox-proposals');
  const p = el._proposals[i];
  if (!p) return;
  // Open modal pre-filled with proposal data. Priority carries over as bangs
  // so the parser derives the same p1/p2/p3 the proposal suggested; the
  // sender isn't a clean @Contact so it stays in notes instead.
  const bangs = PRIORITY_TO_BANGS[p.priority] || '';
  document.getElementById('m-title').value = (p.suggestedTask || '') + (bangs ? ' ' + bangs : '');
  document.getElementById('m-notes').value = p.action + ' (from: ' + p.from + ')';
  document.getElementById('m-category').value = 'work';
  document.getElementById('m-recurring').value = '';
  resetPickerFields();
  document.getElementById('modal-bg').classList.remove('hidden');
  document.getElementById('modal-bg')._proposalIndex = i;
  updatePreview();
  setTimeout(() => document.getElementById('m-title').focus(), 50);
}

async function skipProposal(i) {
  const el = document.getElementById('inbox-proposals');
  const p = el && el._proposals ? el._proposals[i] : null;
  if (p && p.threadId) {
    try {
      await fetch('/api/gmail-skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: p.threadId })
      });
    } catch(e) { console.log('Skip save failed', e); }
  }
  const card = document.getElementById('proposal-' + i);
  if (card) card.remove();
  const remaining = document.querySelectorAll('[id^="proposal-"]').length;
  const badge = document.getElementById('inbox-badge');
  if (badge) { badge.textContent = remaining; if (!remaining) badge.style.display = 'none'; }
}


function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function formatDayLabel(d) {
  const now = new Date();
  now.setHours(0,0,0,0);
  const diff = Math.round((d - now) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

function renderScheduled() {
  const el = document.getElementById('scheduled-tasks');
  if (!el) return;
  const dated = tasks.filter(t => t.due_date).sort((a,b) => a.due_date.localeCompare(b.due_date));
  const undated = tasks.filter(t => !t.due_date);
  if (!dated.length && !undated.length) { el.innerHTML = '<div class="empty">No tasks scheduled.</div>'; return; }
  
  // Group by date
  const groups = {};
  dated.forEach(t => {
    const d = t.due_date.split('T')[0];
    if (!groups[d]) groups[d] = [];
    groups[d].push(t);
  });

  let html = '';
  Object.keys(groups).sort().forEach(date => {
    const d = new Date(date + 'T00:00:00');
    const od = date < today;
    html += '<div class="sched-day-label' + (od ? ' overdue' : '') + '">' + formatDayLabel(d) + '</div>';
    html += groups[date].map(taskHTML).join('');
  });
  if (undated.length) {
    html += '<div class="sched-day-label" style="margin-top:1.5rem;">No date</div>';
    html += undated.map(taskHTML).join('');
  }
  el.innerHTML = html || '<div class="empty">Nothing scheduled.</div>';
}


// ── Timeline: tasks and calendar events merged into one day-grouped feed ──────
// Google Calendar's own "Schedule" list view is the model — overdue first,
// then every day from today onward that actually has something in it (bounded
// by whatever the calendar feed returns, same as Google's own list), then
// undated tasks at the bottom. This used to live inside the Inbox as "your
// day", but Inbox is capture-only now — this is its own view so it can grow
// forward instead of being stuck showing just today.
// Category → emoji, shown on task cards so the timeline reads at a glance
// instead of as a wall of text. Skipped when the title already opens with
// its own emoji (e.g. "🎯 Marketing Mondays") to avoid doubling up.
// Calendar titles come from outside (shared/imported calendars), so anything
// interpolated into innerHTML from them has to be escaped.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CATEGORY_EMOJI = { work: '💼', exercise: '🏃', home: '🏠', personal: '🌱' };
const LEADING_EMOJI_RE = /^\p{Extended_Pictographic}/u;
function taskEmoji(t) {
  if (LEADING_EMOJI_RE.test(t.title)) return '';
  return (CATEGORY_EMOJI[t.category] || '') + ' ';
}

function timelineRowsHTML(dayTasks, dayEvents, isToday) {
  const timedEvents = dayEvents.filter(e => !e.allDay);
  const allDayEvents = dayEvents.filter(e => e.allDay);
  const timedTasks = dayTasks.filter(t => t.time_block);
  const untimedTasks = dayTasks.filter(t => !t.time_block);

  // Untimed items (tasks and all-day events with no fixed time) lead the
  // list with a blank time slot instead of living in a separate "Anytime"
  // panel — they used to look identical to tasks with no date at all, which
  // read as a bug even though both were correctly categorised.
  // Some all-day calendar events have the real time typed into the title
  // ("…Wells Cathedral 1830"); place those at that time instead of leaving
  // them floating at the top of the day.
  const allDayWithTime = allDayEvents.map(e => ({ e, t: extractTitleTime(e.title) }));
  const entries = [
    ...untimedTasks.map(t => ({ time: '', kind: 'task', task: t })),
    ...allDayWithTime.filter(x => !x.t).map(x => ({ time: '', kind: 'event', title: x.e.title })),
    ...allDayWithTime.filter(x => x.t).map(x => ({ time: x.t.start, kind: 'event', title: x.e.title })),
    ...timedEvents.map(e => ({ time: new Date(e.start).toTimeString().slice(0, 5), kind: 'event', title: e.title })),
    ...timedTasks.map(t => ({ time: t.time_block, kind: 'task', task: t }))
  ].sort((a, b) => a.time.localeCompare(b.time));

  const now = new Date();
  const nowStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const nowRow = '<div class="tl-row"><div class="tl-now-time">NOW</div><div class="tl-rail"><div class="tl-now-dot"></div></div><div class="tl-now-line"></div></div>';

  let placed = false;
  let html = '';
  entries.forEach((entry, i) => {
    if (isToday && !placed && entry.time > nowStr) { html += nowRow; placed = true; }
    const isLast = i === entries.length - 1;
    if (entry.kind === 'event') {
      html += '<div class="tl-row"><div class="tl-time">' + entry.time + '</div><div class="tl-rail"><div class="tl-dot"></div>' + (isLast && placed ? '' : '<div class="tl-line"></div>') + '</div><div class="tl-body"><div class="tl-event-chip">📅 ' + esc(entry.title) + '</div></div></div>';
    } else {
      const t = entry.task;
      const checkClass = t.priority === 'p1' ? ' p1' : t.priority === 'p2' ? ' p2' : '';
      html += '<div class="tl-row"><div class="tl-time">' + entry.time + '</div><div class="tl-rail"><button aria-label="Mark complete" class="tl-check' + checkClass + '" onclick="completeTask(' + t.id + ')"></button>' + (isLast && placed ? '' : '<div class="tl-line"></div>') + '</div><div class="tl-body"><div class="tl-card" draggable="true" data-task-id="' + t.id + '" ondblclick="editTask(' + t.id + ')"><div class="tl-task-title">' + taskEmoji(t) + esc(t.title) + '</div>' + (t.tag ? '<span class="tl-tag">#' + esc(t.tag) + '</span>' : '') + moveButtonsHTML(t.id) + '<i class="ti ti-pencil task-del" onclick="editTask(' + t.id + ')" style="position:absolute;top:8px;right:10px;"></i></div></div></div>';
    }
  });
  if (isToday && !placed) html += nowRow;
  return html;
}

// Calendar events are cached briefly so a drag/complete doesn't refetch the
// whole feed; navigating to the view or pull-to-refresh forces a fresh load.
let timelineEvents = [];
let timelineEventsAt = 0;

async function renderTimelineFeed(force) {
  const el = document.getElementById('timeline-feed-body');
  if (!el) return;

  if (force || Date.now() - timelineEventsAt > 60000) {
    try { timelineEvents = await loadCalendarEvents(); } catch (e) { timelineEvents = []; }
    if (timelineEvents.length) timelineEventsAt = Date.now();
  }
  const events = timelineEvents;

  const overdue = tasks.filter(t => t.due_date && t.due_date.split('T')[0] < today);
  const undated = tasks.filter(t => !t.due_date);

  // Today is always present so it's a drop target even when it's empty.
  const days = { [today]: { tasks: [], events: [] } };
  const bucket = ds => (days[ds] = days[ds] || { tasks: [], events: [] });
  tasks.forEach(t => {
    if (!t.due_date) return;
    const ds = t.due_date.split('T')[0];
    if (ds < today) return;
    bucket(ds).tasks.push(t);
  });
  events.forEach(e => bucket(e.start.split('T')[0]).events.push(e));

  // Each day is a section carrying its date so a dragged task can be dropped
  // on it. Overdue has no data-date (you can't reschedule *into* overdue).
  let html = '';
  if (overdue.length) {
    html += '<div class="tl-day"><div class="sched-day-label overdue">Overdue</div>' + overdue.map(feedTaskHTML).join('') + '</div>';
  }

  Object.keys(days).sort().forEach(ds => {
    const d = new Date(ds + 'T00:00:00');
    html += '<div class="tl-day" data-date="' + ds + '"><div class="sched-day-label">' + formatDayLabel(d) + '</div>'
      + timelineRowsHTML(days[ds].tasks, days[ds].events, ds === today) + '</div>';
  });

  if (undated.length) {
    html += '<div class="tl-day" data-date=""><div class="sched-day-label">No date</div>' + undated.map(feedTaskHTML).join('') + '</div>';
  }

  el.innerHTML = html;
  el.querySelectorAll('.task[id^="task-"]').forEach(row => {
    row.draggable = true;
    row.dataset.taskId = row.id.slice(5);
  });
}

// ── Reschedule: drag a task onto a day, or push it with +1d / +1w ────────────
// Overdue / No date rows reuse the standard task row; slot the push buttons in
// just before its edit pencil.
function moveButtonsHTML(id) {
  return '<span class="tl-move"><button title="Push a day" onclick="event.stopPropagation();pushTask(' + id + ',1)">+1d</button>'
    + '<button title="Push a week" onclick="event.stopPropagation();pushTask(' + id + ',7)">+1w</button></span>';
}

function feedTaskHTML(t) {
  return taskHTML(t).replace('<i class="ti ti-pencil', moveButtonsHTML(t.id) + '<i class="ti ti-pencil');
}

async function rescheduleTask(id, due) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  if ((t.due_date ? t.due_date.split('T')[0] : '') === (due || '')) return;
  const before = { due_date: t.due_date, time_block: t.time_block };
  // Optimistic: move it now, put it back if the save fails.
  t.due_date = due || null;
  if (!due) t.time_block = null;
  renderTimelineFeed();
  try {
    const res = await fetch('/api/tasks/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(due ? { due_date: due } : { due_date: null, time_block: null })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (e) {
    Object.assign(t, before);
    renderTimelineFeed();
    alert('Couldn’t reschedule that task — it’s been put back.');
  }
}

// Push by n days from whichever is later: its due date or today, so pushing an
// overdue task lands in the future rather than on another past date.
function pushTask(id, days) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const due = t.due_date ? t.due_date.split('T')[0] : today;
  const d = new Date((due > today ? due : today) + 'T00:00:00');
  d.setDate(d.getDate() + days);
  rescheduleTask(id, localDateStr(d));
}

function bindTimelineDnD() {
  const el = document.getElementById('timeline-feed-body');
  if (!el) return;
  const clear = () => el.querySelectorAll('.drop-target, .dragging').forEach(n => n.classList.remove('drop-target', 'dragging'));
  const dayOf = e => { const d = e.target.closest && e.target.closest('.tl-day[data-date]'); return d && el.contains(d) ? d : null; };

  el.addEventListener('dragstart', e => {
    const item = e.target.closest && e.target.closest('[data-task-id]');
    if (!item) return;
    e.dataTransfer.setData('text/plain', item.dataset.taskId);
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('dragging');
  });
  el.addEventListener('dragover', e => {
    const day = dayOf(e);
    if (!day) return;
    e.preventDefault();
    el.querySelectorAll('.drop-target').forEach(n => { if (n !== day) n.classList.remove('drop-target'); });
    day.classList.add('drop-target');
  });
  el.addEventListener('drop', e => {
    const day = dayOf(e);
    if (!day) return;
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    clear();
    if (id) rescheduleTask(id, day.dataset.date);
  });
  el.addEventListener('dragend', clear);
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) clear(); });
}


// ── Mobile navigation ─────────────────────────────────────────────────────────
function isMobile() { return window.innerWidth <= 768; }

function mobileNav(view, tabEl) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  document.getElementById('topbar-title').textContent = 
    view === 'inbox' ? 'Inbox' :
    view === 'today' ? 'Today' :
    view === 'all' ? 'Tasks' :
    view === 'scheduled' ? 'Scheduled' :
    view === 'completed' ? 'Completed' :
    view === 'calendar' ? 'Calendar' :
    view === 'timeline' ? 'Timeline' : view;
  document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  // Also sync desktop sidebar
  document.querySelectorAll('.ni[data-view]').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });
  if (view === 'today') renderToday();
  if (view === 'all') renderAll();
  if (view === 'completed') renderCompleted();
  if (view === 'calendar') showCalendarView();
  if (view === 'inbox') showInboxPrompt();
  if (view === 'timeline') renderTimelineFeed(true);
  if (view === 'scheduled') renderScheduled();
}

function toggleMoreSheet() {
  const sheet = document.getElementById('mobile-more-sheet');
  sheet.classList.toggle('open');
}

// Close more sheet when tapping outside
document.addEventListener('click', e => {
  const sheet = document.getElementById('mobile-more-sheet');
  if (sheet && sheet.classList.contains('open') && !sheet.contains(e.target) && !e.target.closest('.mobile-tab')) {
    sheet.classList.remove('open');
  }
});

function syncMobileBadges() {
  const taskBadge = document.getElementById('mob-task-badge');
  const inboxBadge = document.getElementById('mob-inbox-badge');
  const count = tasks.length;
  if (taskBadge) { taskBadge.textContent = count; taskBadge.style.display = count ? 'block' : 'none'; }
  const inboxCount = document.getElementById('inbox-badge');
  if (inboxBadge && inboxCount) { 
    inboxBadge.textContent = inboxCount.textContent; 
    inboxBadge.style.display = inboxCount.style.display; 
  }
}


// ── Command palette (Cmd/Ctrl+K) ─────────────────────────────────────────────
// Jump to a view, find a task, or add one from a sentence. Matching views and
// tasks rank first and "Add task" comes last, so Enter on a search can't
// create a task by accident — unless nothing matches, in which case adding is
// the only thing on offer. Cmd/Ctrl+Enter always adds.
const CMDK_VIEWS = [
  { view: 'inbox', label: 'Inbox', icon: 'ti-inbox' },
  { view: 'today', label: 'Today', icon: 'ti-layout-dashboard' },
  { view: 'timeline', label: 'Timeline', icon: 'ti-timeline' },
  { view: 'scheduled', label: 'Scheduled', icon: 'ti-list-details' },
  { view: 'calendar', label: 'Calendar', icon: 'ti-calendar' },
  { view: 'marketing', label: 'Marketing', icon: 'ti-speakerphone' },
  { view: 'all', label: 'All Tasks', icon: 'ti-list-check' },
  { view: 'completed', label: 'Completed', icon: 'ti-circle-check' }
];

function cmdkItems(query, taskList) {
  const q = query.trim();
  const needle = q.toLowerCase();
  const items = [];
  (needle ? CMDK_VIEWS.filter(v => v.label.toLowerCase().includes(needle)) : CMDK_VIEWS)
    .forEach(v => items.push({ kind: 'view', view: v.view, label: v.label, icon: v.icon }));
  if (needle) {
    taskList
      .filter(t => [t.title, t.tag, t.contact].some(x => x && String(x).toLowerCase().includes(needle)))
      .slice(0, 8)
      .forEach(t => items.push({ kind: 'task', id: t.id, label: t.title, icon: 'ti-circle', meta: t.due_date ? formatDate(t.due_date) : 'No date' }));
    items.push({ kind: 'add', text: q, label: 'Add task: ' + q, icon: 'ti-plus', meta: formatPreview(parseTask(q)) });
  } else {
    items.unshift({ kind: 'new', label: 'New task…', icon: 'ti-plus' });
  }
  return items;
}

const cmdk = { items: [], sel: 0 };

function renderCmdk() {
  const list = document.getElementById('cmdk-list');
  list.innerHTML = cmdk.items.map((it, i) =>
    '<div class="cmdk-item' + (i === cmdk.sel ? ' sel' : '') + (it.kind === 'add' ? ' add' : '') + '" data-i="' + i + '">'
    + '<i class="ti ' + it.icon + '"></i><span class="cmdk-label">' + esc(it.label) + '</span>'
    + (it.meta ? '<span class="cmdk-meta">' + esc(it.meta) + '</span>' : '') + '</div>').join('')
    || '<div class="cmdk-item"><span class="cmdk-label" style="color:var(--text3)">No results</span></div>';
}

function updateCmdk() {
  cmdk.items = cmdkItems(document.getElementById('cmdk-input').value, tasks);
  cmdk.sel = 0;
  renderCmdk();
}

function openCmdk() {
  document.getElementById('cmdk-bg').classList.remove('hidden');
  const input = document.getElementById('cmdk-input');
  input.value = '';
  updateCmdk();
  input.focus();
}

function closeCmdk() { document.getElementById('cmdk-bg').classList.add('hidden'); }

async function runCmdkItem(it) {
  if (!it) return;
  closeCmdk();
  if (it.kind === 'view') document.querySelector('.ni[data-view="' + it.view + '"]').click();
  else if (it.kind === 'task') editTask(it.id);
  else if (it.kind === 'new') openModal();
  else if (it.kind === 'add') await createTask({ raw_text: it.text, category: 'work', recurring: '' });
}

function bindCmdk() {
  const bg = document.getElementById('cmdk-bg');
  const input = document.getElementById('cmdk-input');
  const list = document.getElementById('cmdk-list');
  if (!bg) return;

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (bg.classList.contains('hidden')) openCmdk(); else closeCmdk();
    }
  });

  input.addEventListener('input', updateCmdk);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeCmdk(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!cmdk.items.length) return;
      cmdk.sel = (cmdk.sel + (e.key === 'ArrowDown' ? 1 : -1) + cmdk.items.length) % cmdk.items.length;
      renderCmdk();
      const cur = list.children[cmdk.sel];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Cmd/Ctrl+Enter: add the text as a task no matter what's highlighted.
      const it = (e.metaKey || e.ctrlKey) ? cmdk.items.find(i => i.kind === 'add') : cmdk.items[cmdk.sel];
      runCmdkItem(it);
    }
  });
  list.addEventListener('click', e => {
    const row = e.target.closest('[data-i]');
    if (row) runCmdkItem(cmdk.items[Number(row.dataset.i)]);
  });
  list.addEventListener('mousemove', e => {
    const row = e.target.closest('[data-i]');
    if (!row || Number(row.dataset.i) === cmdk.sel) return;
    cmdk.sel = Number(row.dataset.i);
    list.querySelectorAll('.cmdk-item').forEach((n, i) => n.classList.toggle('sel', i === cmdk.sel));
  });
  bg.addEventListener('mousedown', e => { if (e.target === bg) closeCmdk(); });
}

// ── Pull to refresh ───────────────────────────────────────────────────────────
// The app shell doesn't scroll on mobile (body has overflow:hidden) — each
// .view scrolls internally instead. window.scrollY is therefore always 0, so
// checking that for "am I at the top" used to arm this on every downward
// swipe, anywhere, even mid-scroll through a list — and firing a full
// location.reload() then dumped you back on the default Inbox tab regardless
// of what you were looking at. Check the actual scroll host, and refresh data
// in place instead of reloading the page.
async function refreshCurrentView() {
  await loadTasks();
  const visible = document.querySelector('.view:not(.hidden)');
  const view = visible ? visible.id.replace('view-', '') : 'inbox';
  if (view === 'all') renderAll();
  if (view === 'completed') renderCompleted();
  if (view === 'calendar') showCalendarView();
  if (view === 'inbox') showInboxPrompt();
  if (view === 'timeline') renderTimelineFeed(true);
  if (view === 'scheduled') renderScheduled();
  if (view === 'marketing') {
    await loadContacts();
    renderMarketing();
    await loadMarketingContent().then(renderMktContent);
  }
}

(function() {
  if (window.innerWidth > 768) return;
  let startY = 0;
  let pulling = false;
  const indicator = document.createElement('div');
  indicator.className = 'pull-refresh-indicator';
  indicator.innerHTML = '<i class="ti ti-refresh"></i>';
  document.body.appendChild(indicator);

  function scrollHost() {
    return document.querySelector('.view:not(.hidden)') || document.scrollingElement;
  }

  document.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    pulling = scrollHost().scrollTop === 0;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    const diff = e.touches[0].clientY - startY;
    if (diff > 60) indicator.classList.add('visible');
    else indicator.classList.remove('visible');
  }, { passive: true });

  document.addEventListener('touchend', e => {
    const diff = e.changedTouches[0].clientY - startY;
    indicator.classList.remove('visible');
    if (pulling && diff > 60) {
      indicator.innerHTML = '<i class="ti ti-loader"></i>';
      refreshCurrentView().finally(() => {
        indicator.classList.remove('visible');
        indicator.innerHTML = '<i class="ti ti-refresh"></i>';
      });
    }
    pulling = false;
  });
})();


// ── Dark mode ─────────────────────────────────────────────────────────────────
function initDarkMode() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    updateDarkIcon(saved);
  }
}

function toggleDark() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateDarkIcon(next);
}

function updateDarkIcon(theme) {
  const btn = document.getElementById('dark-toggle');
  if (btn) btn.innerHTML = theme === 'dark' ? '<i class="ti ti-sun"></i>' : '<i class="ti ti-moon"></i>';
}


async function loadShootTasksForToday() {
  try {
    const res = await fetch('/api/shoot-tasks-today');
    const shootTasks = await res.json();
    if (!shootTasks.length) return;
    // Add to tasks display in Today view
    const el = document.getElementById('sp-panel');
    if (!el) return;
    const existing = el.innerHTML;
    let html = '<div class="section-lbl">Shoot tasks due today</div>';
    html += shootTasks.map(t => '<div class="task"><div class="check p1" onclick="toggleShootTaskFromToday(' + t.id + ')"></div><div class="task-body"><div class="task-title">' + t.title + '</div><div class="task-meta"><span class="tag tag-work">shoot</span><span class="tag">' + (t.shoot_name || '') + '</span></div></div></div>').join('');
    el.innerHTML = html + existing;
  } catch(e) { console.log('Shoot tasks today error', e); }
}

async function toggleShootTaskFromToday(taskId) {
  await fetch('/api/shoot-tasks/' + taskId + '/complete', { method: 'PATCH' });
  loadShootTasksForToday();
}

function showCalendarView() {
  var c = document.getElementById('view-calendar');
  if (c && !c.querySelector('iframe')) {
    var f = document.createElement('iframe');
    f.src = 'https://calendar.google.com/calendar/embed?src=ryan%40ryanballphotography.com&src=c_a4281f75d282938d2163fbbe126730ede2babd78fcae29ee34d2556f6979cad9%40group.calendar.google.com&src=24b8634861e8a4fccb81c62ca9561c52956af0230a8c86ffe2c5f7775bd327ef%40group.calendar.google.com&src=0395cbfbffc800573fc2f3660fc1f019c221e4bedc8051cc6c0c297db9699797%40group.calendar.google.com&src=60877e1a8a8dfba08b542933bfa7f8faedd1d1528f2ada8e0ba91ba67c5074e3%40group.calendar.google.com&src=c_9126b3913ee9069ad38842fe8c2b8fd1ca0ca6a4689554039221089b73cf297b%40group.calendar.google.com&src=d4h4q6l360atpvv3mgj2d4p4lk6l7ggf%40import.calendar.google.com&src=tessa.palokkaran%40outlook.com&src=s22rdh1c5v23u9phjacqsess9incug50%40import.calendar.google.com&showTitle=0&showNav=1&showPrint=0&showTabs=1&showCalendars=1&showTz=0&mode=MONTH&ctz=Europe%2FLondon';
    f.style = 'border:0;width:100%;height:100%;display:block;';
    f.frameBorder = '0';
    c.appendChild(f);
  }
}
/* This line intentionally left blank */



// ══════════════════════════════════════════════════
// MARKETING TAB
// ══════════════════════════════════════════════════

let mktContent = { feed: null, mailer: null };
let mktContacts   = [];
let mktCheckState = {};
let mktActiveTab  = 'targets';
const MKT_CHECKS_KEY = 'mkt_checks_v1';

const STAGES = [
  { id: 'new',    label: 'Not contacted', icon: 'ti-user-plus'    },
  { id: 'card',   label: 'Card sent',     icon: 'ti-mail-forward' },
  { id: 'email',  label: 'Email sent',    icon: 'ti-send'         },
  { id: 'called', label: 'Called',        icon: 'ti-phone'        },
  { id: 'gosee',  label: 'Go-see',        icon: 'ti-briefcase'    },
];
const STAGE_NEXT = { new: 'Card sent', card: 'Email sent', email: 'Called', called: 'Go-see' };
const STAGE_MAP = {};
STAGES.forEach(s => STAGE_MAP[s.id] = s);

// CRM groups, in the order the pipeline should be organised
const ORG_TYPE_ORDER = ['Outreach', 'Client', 'Design Agency', 'Freelance Creatives', 'PR Agency', 'Production Agency'];
// CRM groups that are crew/suppliers, not marketing pipeline targets — never shown on this tab
const MKT_EXCLUDE_ORG_TYPES = ['Food Stylist', 'Photo Studio', 'Photography Assistant', 'Prop Stylist'];

function mktGroupType(c) {
  const raw = (c.org_type || c.orgType || '').trim();
  if (raw) {
    const match = ORG_TYPE_ORDER.find(o => o.toLowerCase() === raw.toLowerCase());
    return match || raw;
  }
  return (c.type === 'target') ? 'Outreach' : 'Client';
}

const WEEKLY_CHECKS = [
  { group: 'Outreach', icon: 'ti-users', items: [
    { id: 'w1', label: 'Find 1 new target creative or art buyer — add to pipeline' },
    { id: 'w2', label: 'Follow + engage on 3-5 target accounts (comments, not just likes)' },
    { id: 'w3', label: 'Send 1 card out or 1 personal email (if card has already landed)' },
    { id: 'w4', label: 'Make 1 phone call (if email + card are both done for that contact)' },
  ]},
  { group: 'Visibility', icon: 'ti-brand-instagram', items: [
    { id: 'w5', label: 'Queue 1 quality Instagram post for the week' },
    { id: 'w6', label: 'Plan 2-3 stories (BTS, personal project progress, life)' },
    { id: 'w7', label: 'Repurpose content across IG + LinkedIn' },
  ]},
  { group: 'Plan check', icon: 'ti-calendar', items: [
    { id: 'w8', label: 'Check 90-day cycle — who is approaching their next touchpoint?' },
    { id: 'w9', label: 'Update pipeline — who has had card / email / call?' },
    { id: 'w10', label: 'Flag any contact approaching 90 days since last touch' },
  ]},
];

const MONTHLY_CHECKS = [
  { group: 'Mailer', icon: 'ti-mail', items: [
    { id: 'm1', label: 'Send mailer to list (minimum every 90 days)' },
    { id: 'm2', label: 'One topic: personal project update, recent work, travel, or news' },
    { id: 'm3', label: 'Add 5 new people to your list' },
  ]},
  { group: 'Personal project', icon: 'ti-camera', items: [
    { id: 'm4', label: 'Do at least one shoot or edit session on your personal project' },
    { id: 'm5', label: 'Share one image or BTS update publicly' },
  ]},
  { group: 'Goals', icon: 'ti-target', items: [
    { id: 'm6', label: 'Set one marketing goal for the month (cards, calls, go-sees)' },
    { id: 'm7', label: 'Check website — anything to update or refresh?' },
    { id: 'm8', label: 'Identify one new target agency or brand to research' },
  ]},
];

// ── DB-backed storage ─────────────────────────────
async function loadContacts() {
  try {
    const res = await fetch('/api/marketing-contacts');
    mktContacts = await res.json();
  } catch(e) { mktContacts = []; }
  try { mktCheckState = JSON.parse(localStorage.getItem(MKT_CHECKS_KEY)) || {}; } catch(e) { mktCheckState = {}; }
  const bg = document.getElementById('contact-modal-bg');
  if (bg) {
    let md = false;
    bg.addEventListener('mousedown', e => { md = e.target === bg; });
    bg.addEventListener('mouseup',   e => { if (md && e.target === bg) closeContactModal(); md = false; });
  }
  renderMktFocus();
}

async function upsertContact(c) {
  await fetch('/api/marketing-contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id:              c.id,
      type:            c.type || 'target',
      name:            c.name,
      role:            c.role || null,
      agency:          c.agency || null,
      org_type:        c.org_type || c.orgType || null,
      crm_id:          c.crm_id || c.crmId || null,
      notes:           c.notes || null,
      stage:           c.stage || 'new',
      last_touchpoint: c.last_touchpoint || c.lastTouchpoint || null,
      influence:       c.influence || 'key',
      from_crm:        c.from_crm !== undefined ? c.from_crm : (c.fromCrm || false),
    })
  });
}

async function patchContact(id, fields) {
  const colMap = { lastTouchpoint: 'last_touchpoint', fromCrm: 'from_crm', orgType: 'org_type', crmId: 'crm_id' };
  const body = {};
  Object.keys(fields).forEach(k => { body[colMap[k] || k] = fields[k]; });
  await fetch('/api/marketing-contacts/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function removeContact(id) {
  await fetch('/api/marketing-contacts/' + id, { method: 'DELETE' });
}

async function toggleInfluence(id) {
  const c = mktContacts.find(m => m.id === id);
  if (!c) return;
  c.influence = (c.influence || 'key') === 'key' ? 'secondary' : 'key';
  await patchContact(id, { influence: c.influence });
  renderMktPipeline();
}

const ORG_PRIORITY_KEY = 'mkt_org_priority';
function getOrgPriority() {
  try { return JSON.parse(localStorage.getItem(ORG_PRIORITY_KEY)) || {}; } catch(e) { return {}; }
}
function toggleOrgPriority(orgName) {
  const p = getOrgPriority();
  p[orgName] = !p[orgName];
  localStorage.setItem(ORG_PRIORITY_KEY, JSON.stringify(p));
  renderMktPipeline();
}

const MKT_SECTION_COLLAPSE_KEY = 'mkt_section_collapsed';
function getMktSectionCollapse() {
  try { return JSON.parse(localStorage.getItem(MKT_SECTION_COLLAPSE_KEY)) || {}; } catch(e) { return {}; }
}
function mktSectionDomId(typeKey) { return typeKey.replace(/[^a-zA-Z0-9]/g, '_'); }
function toggleMktSection(typeKey) {
  const content = document.getElementById('mkt-section-' + mktSectionDomId(typeKey));
  const chev = document.getElementById('mkt-chev-' + mktSectionDomId(typeKey));
  if (!content) return;
  const isCollapsed = content.style.display === 'none';
  const c = getMktSectionCollapse();
  c[typeKey] = !isCollapsed;
  localStorage.setItem(MKT_SECTION_COLLAPSE_KEY, JSON.stringify(c));
  content.style.display = isCollapsed ? '' : 'none';
  if (chev) { chev.classList.toggle('ti-chevron-right', !isCollapsed); chev.classList.toggle('ti-chevron-down', isCollapsed); }
}

function saveCheckState() { localStorage.setItem(MKT_CHECKS_KEY, JSON.stringify(mktCheckState)); }

function weekKey() {
  const d = new Date(), jan1 = new Date(d.getFullYear(), 0, 1);
  const wk = Math.ceil((((d - jan1) / 86400000) + jan1.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + String(wk).padStart(2, '0');
}
function monthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function isChecked(id, period) {
  const key = period === 'weekly' ? weekKey() : monthKey();
  return !!(mktCheckState[key] && mktCheckState[key][id]);
}
function toggleCheck(id, period) {
  const key = period === 'weekly' ? weekKey() : monthKey();
  if (!mktCheckState[key]) mktCheckState[key] = {};
  mktCheckState[key][id] = !mktCheckState[key][id];
  saveCheckState();
  renderMktChecklists();
  updateMktAccCounts();
}

// ── Tabs ──────────────────────────────────────────


async function loadMarketingContent() {
  try {
    const res = await fetch('/api/marketing-content');
    const rows = await res.json();
    mktContent.feed   = rows.find(r => r.type === 'feed'   && !r.sent_at) || rows.find(r => r.type === 'feed')   || null;
    mktContent.mailer = rows.find(r => r.type === 'mailer' && !r.sent_at) || rows.find(r => r.type === 'mailer') || null;
  } catch(e) { console.log('content load error', e); }
}


function renderMktContent() {
  const feed   = mktContent.feed;
  const mailer = mktContent.mailer;
  const now    = new Date();
  if (feed) {
    const n = document.getElementById('mkt-feed-note'); if (n) n.value = feed.note || '';
    const d = document.getElementById('mkt-feed-date'); if (d) d.value = feed.planned_date ? feed.planned_date.split('T')[0] : '';
    const s = document.getElementById('mkt-feed-status'); if (s) s.textContent = feed.sent_at ? 'Posted' : '';
  }
  if (mailer) {
    const n = document.getElementById('mkt-mailer-note'); if (n) n.value = mailer.note || '';
    const d = document.getElementById('mkt-mailer-date'); if (d) d.value = mailer.planned_date ? mailer.planned_date.split('T')[0] : '';
    const s = document.getElementById('mkt-mailer-status');
    const due = document.getElementById('mkt-mailer-due');
    if (s && mailer.sent_at) {
      const days = Math.floor((now - new Date(mailer.sent_at)) / 86400000);
      s.textContent = 'Sent ' + days + 'd ago';
      if (due) due.textContent = days > 60 ? 'Next one due soon' : 'Next one in ~' + (30 - days) + ' days';
    }
  }
}

async function saveContent(type) {
  const note = document.getElementById('mkt-' + type + '-note').value.trim();
  const date = document.getElementById('mkt-' + type + '-date').value;
  const existing = mktContent[type];
  try {
    if (existing && existing.id) {
      const res = await fetch('/api/marketing-content/' + existing.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, planned_date: date || null, sent_at: existing.sent_at || null })
      });
      mktContent[type] = await res.json();
    } else {
      const res = await fetch('/api/marketing-content', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, note, planned_date: date || null })
      });
      mktContent[type] = await res.json();
    }
    const btn = document.querySelector('#mkt-' + type + '-card .mkt-content-save');
    if (btn) { btn.textContent = 'Saved'; setTimeout(() => { btn.textContent = 'Save idea'; }, 1500); }
  } catch(e) { console.log('save error', e); }
}

async function markContentDone(type) {
  const now  = new Date().toISOString();
  const note = document.getElementById('mkt-' + type + '-note').value.trim();
  const date = document.getElementById('mkt-' + type + '-date').value;
  const existing = mktContent[type];
  try {
    if (existing && existing.id) {
      const res = await fetch('/api/marketing-content/' + existing.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, planned_date: date || null, sent_at: now })
      });
      mktContent[type] = await res.json();
    } else {
      const res = await fetch('/api/marketing-content', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, note, planned_date: date || null, sent_at: now })
      });
      mktContent[type] = await res.json();
    }
    document.getElementById('mkt-' + type + '-note').value = '';
    document.getElementById('mkt-' + type + '-date').value = '';
    renderMktContent();
    renderMktFocus();
  } catch(e) { console.log('mark done error', e); }
}

function switchMktTab(tab, btn) {
  mktActiveTab = tab;
  document.querySelectorAll('.mkt-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['pipeline','content'].forEach(p => {
    const el = document.getElementById('mkt-panel-' + p);
    if (el) el.classList.toggle('hidden', p !== tab);
  });
  if (tab === 'pipeline') renderMktPipeline();
  else loadMarketingContent().then(renderMktContent);
}

function renderMktFocus() {
  const el = document.getElementById('mkt-focus-text');
  if (!el) return;
  const now = new Date();
  const existing = mktContacts.filter(c => c.type === 'existing');
  const noDate = existing.filter(c => !c.last_touchpoint && !c.lastTouchpoint).length;
  if (existing.length === 0) { el.textContent = 'Loading clients from your shoot planner...'; return; }
  if (noDate === existing.length) {
    const first = existing.find(c => (c.influence||'key') === 'key');
    const name = first ? first.name.split(' ')[0] : 'your clients';
    el.textContent = 'No touches logged yet. Start with ' + name + ' - when did you last speak to them?';
    return;
  }
  if (noDate > 0) { el.textContent = noDate + ' client' + (noDate>1?'s':'') + ' still need a first touch logged.'; return; }
  let worst = null, worstDays = -Infinity;
  mktContacts.forEach(c => {
    const last = c.last_touchpoint || c.lastTouchpoint;
    if (!last) return;
    const d = Math.floor((now - new Date(last)) / 86400000);
    if (d > worstDays) { worstDays = d; worst = c; }
  });
  if (worst && worstDays > 80) {
    const over = worstDays - 90;
    const name = worst.name.split(' ')[0];
    el.textContent = over > 0 ? name + ' is ' + over + 'd overdue. Send a personal email or call.' : name + ' is due a touch in ' + (90-worstDays) + ' days.';
  } else {
    el.textContent = 'Everyone is within 90 days. Keep showing up.';
  }
}

function renderMarketing() {
  renderMktFocus();
  renderMktPipeline();
}

// ── Kanban ────────────────────────────────────────
function renderMktKanban() {
  const el = document.getElementById('mkt-kanban');
  if (!el) return;
  const now = new Date();
  const targets = mktContacts.filter(c => (c.type || 'target') === 'target');
  el.innerHTML = STAGES.map(stage => {
    const contacts = targets.filter(c => (c.stage || 'new') === stage.id);
    const cards = contacts.length ? contacts.map(c => targetCard(c, now)).join('') : '<div class="mkt-col-empty">No contacts</div>';
    return '<div class="mkt-col mkt-col-' + stage.id + '">'
      + '<div class="mkt-col-header"><i class="ti ' + stage.icon + '" aria-hidden="true"></i><span>' + stage.label + '</span>'
      + (contacts.length ? '<span class="mkt-col-count">' + contacts.length + '</span>' : '')
      + '</div><div class="mkt-col-cards">' + cards + '</div></div>';
  }).join('');
}

function targetCard(c, now) {
  const last = c.last_touchpoint || c.lastTouchpoint;
  const lastDate = last ? new Date(last) : null;
  const daysSince = lastDate ? Math.floor((now - lastDate) / 86400000) : null;
  const daysUntil = daysSince !== null ? 90 - daysSince : null;
  const isOverdue = daysUntil !== null && daysUntil < 0;
  const isSoon    = daysUntil !== null && daysUntil >= 0 && daysUntil <= 14;
  let urg = '';
  if (isOverdue)    urg = '<span class="mkt-card-urgency mkt-urgency-over">🔴 ' + Math.abs(daysUntil) + 'd overdue</span>';
  else if (isSoon)  urg = '<span class="mkt-card-urgency mkt-urgency-soon">🟡 ' + daysUntil + 'd left</span>';
  else if (daysUntil !== null) urg = '<span class="mkt-card-urgency mkt-urgency-ok">🟢 ' + daysUntil + 'd left</span>';
  else              urg = '<span class="mkt-card-urgency mkt-urgency-none">No date yet</span>';
  const roleLabel = c.role === 'artbuyer' ? 'Art buyer' : 'Creative';
  const canAdvance = (c.stage || 'new') !== 'gosee';
  const adv = canAdvance ? '<button class="mkt-card-advance" onclick="advanceContact(\'' + c.id + '\')"><i class="ti ti-arrow-right"></i> ' + STAGE_NEXT[c.stage || 'new'] + '</button>' : '';
  return '<div class="mkt-card' + (isOverdue ? ' mkt-card-overdue' : '') + '">'
    + '<div class="mkt-card-name">' + c.name + (c.agency ? ' <span class="mkt-card-agency-inline">' + c.agency + '</span>' : '') + '</div>'
    + '<div class="mkt-card-meta"><span class="mkt-role-badge mkt-role-' + (c.role || 'creative') + '">' + roleLabel + '</span>' + urg + '</div>'
    + (c.notes ? '<div class="mkt-card-notes">' + c.notes + '</div>' : '')
    + '<div class="mkt-card-actions">' + adv
    + '<div style="display:flex;gap:4px;margin-left:auto;">'
    + '<button class="mkt-card-icon-btn" onclick="editContact(\'' + c.id + '\')" aria-label="Edit"><i class="ti ti-pencil"></i></button>'
    + '<button class="mkt-card-icon-btn" onclick="deleteContact(\'' + c.id + '\')" aria-label="Delete"><i class="ti ti-trash"></i></button>'
    + '</div></div></div>';
}

// ── Existing clients ──────────────────────────────
function urgencyData(c, now) {
  const last = c.last_touchpoint || c.lastTouchpoint;
  const lastDate = last ? new Date(last) : null;
  const daysSince = lastDate ? Math.floor((now - lastDate) / 86400000) : null;
  const daysUntil = daysSince !== null ? 90 - daysSince : null;
  const noDate    = daysSince === null;
  const isOverdue = !noDate && daysUntil < 0;
  const isSoon    = !noDate && !isOverdue && daysUntil <= 14;
  return { daysUntil, isOverdue, isSoon, noDate };
}

function renderMktPipeline() {
  const el = document.getElementById('mkt-pipeline-list');
  if (!el) return;
  const now = new Date();
  const contacts = mktContacts.filter(c => !MKT_EXCLUDE_ORG_TYPES.some(t => t.toLowerCase() === (c.org_type || c.orgType || '').toLowerCase()));
  if (!contacts.length) {
    el.innerHTML = '<div class="mkt-pipeline-empty">Loading contacts from your shoot planner CRM...</div>';
    return;
  }
  const orgPriority = getOrgPriority();
  const typeRank = t => { const i = ORG_TYPE_ORDER.indexOf(t); return i === -1 ? ORG_TYPE_ORDER.length : i; };

  // ── Determine each contact's own CRM type, then a canonical type per
  //    organisation (agency name) — the most-active type any of its
  //    contacts have. This merges orgs that appear under multiple CRM
  //    categories (e.g. an org tagged both Client and Outreach) into one
  //    group, under whichever category ranks first in ORG_TYPE_ORDER. ──
  const withType = contacts.map(c => ({ ...c, ...urgencyData(c, now), _ownType: mktGroupType(c) }));
  const agencyCanonical = {};
  withType.forEach(c => {
    const agencyKey = (c.agency || 'Other').trim().toLowerCase();
    if (!(agencyKey in agencyCanonical) || typeRank(c._ownType) < typeRank(agencyCanonical[agencyKey])) {
      agencyCanonical[agencyKey] = c._ownType;
    }
  });

  // ── Top-level: group by canonical CRM org type, in the defined order ──
  const typeGroups = {};
  withType.forEach(c => {
    const agencyKey = (c.agency || 'Other').trim().toLowerCase();
    const t = agencyCanonical[agencyKey];
    if (!typeGroups[t]) typeGroups[t] = [];
    typeGroups[t].push(c);
  });
  const typeKeys = Object.keys(typeGroups).sort((a, b) => {
    const aRank = typeRank(a), bRank = typeRank(b);
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b);
  });

  const collapsePrefs = getMktSectionCollapse();
  el.innerHTML = typeKeys.map(typeKey => {
    // ── Within each type: group by organisation name ──
    const groups = {};
    typeGroups[typeKey].forEach(c => {
      const key = c.agency || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    const groupKeys = Object.keys(groups);
    const starredKeys = groupKeys.filter(k => !orgPriority[k]).sort((a, b) => a.localeCompare(b));
    const unstarredKeys = groupKeys.filter(k => !!orgPriority[k]).sort((a, b) => a.localeCompare(b));

    const renderOrgGroup = (key) => {
      const isOrgLow = !!orgPriority[key];
      const safeKey = key.replace(/'/g, "\'");
      const orgContacts = groups[key].sort((a, b) => {
        const aKey = (a.influence || 'key') === 'key' ? 0 : 1;
        const bKey = (b.influence || 'key') === 'key' ? 0 : 1;
        if (aKey !== bKey) return aKey - bKey;
        return a.name.localeCompare(b.name);
      });
      const hasOverdue = orgContacts.some(c => c.isOverdue);
      const hasSoon    = orgContacts.some(c => c.isSoon);
      const groupEmoji = hasOverdue ? '🔴' : hasSoon ? '🟡' : '🟢';
      const rows = orgContacts.map(c => {
        const isKey = (c.influence || 'key') === 'key';
        let urg = '';
        if (c.isOverdue)     urg = '<span class="mkt-row-urgency mkt-urgency-over">🔴 ' + Math.abs(c.daysUntil) + 'd overdue</span>';
        else if (c.isSoon)   urg = '<span class="mkt-row-urgency mkt-urgency-soon">🟡 ' + c.daysUntil + 'd left</span>';
        else if (!c.noDate)  urg = '<span class="mkt-row-urgency mkt-urgency-ok">🟢 ' + c.daysUntil + 'd left</span>';
        else                 urg = '<span class="mkt-row-urgency mkt-urgency-none">— log first touch</span>';
        const touchTypeLabels = { card:'📬 Card', email:'✉️ Email', call:'📞 Call', gosee:'🤝 Go-see', onset:'🎬 On set', social:'💬 IG/LI', mailer:'📧 Mailer' };
        const touchTypeBadge = c.last_touch_type ? '<span class="mkt-touch-type-badge">' + (touchTypeLabels[c.last_touch_type] || c.last_touch_type) + '</span>' : '';
        let stageHtml = '';
        if (c._ownType === 'Outreach') {
          const stageId = c.stage || 'new';
          const stageInfo = STAGE_MAP[stageId] || STAGE_MAP.new;
          const advance = stageId !== 'gosee'
            ? '<button class="mkt-row-advance" onclick="advanceContact(\'' + c.id + '\')" title="Advance to: ' + STAGE_NEXT[stageId] + '"><i class="ti ti-arrow-right"></i></button>'
            : '';
          stageHtml = '<span class="mkt-stage-badge"><i class="ti ' + stageInfo.icon + '"></i> ' + stageInfo.label + '</span>' + advance;
        }
        const jobTitleHtml = c.job_title ? '<div class="mkt-row-jobtitle">' + c.job_title + '</div>' : '';
        return '<div class="mkt-row' + (c.isOverdue ? ' mkt-row-overdue' : '') + (isKey ? '' : ' mkt-row-light') + '">'
          + '<button class="mkt-row-star' + (isKey ? ' mkt-row-star-on' : '') + '" onclick="toggleInfluence(\'' + c.id + '\')" title="' + (isKey ? 'Mark as secondary' : 'Mark as key') + '">' + (isKey ? '⭐' : '·') + '</button>'
          + '<div class="mkt-row-name' + (isKey ? '' : ' mkt-row-name-light') + '">' + c.name + jobTitleHtml + '</div>'
          + '<div class="mkt-row-right">' + stageHtml + touchTypeBadge + urg
          + '<button class="mkt-row-touch" onclick="touchContact(\'' + c.id + '\')" title="Log touch">Log touch</button>'
          + '<button class="mkt-card-icon-btn" onclick="editContact(\'' + c.id + '\')" aria-label="Edit"><i class="ti ti-pencil"></i></button>'
          + '<button class="mkt-card-icon-btn" onclick="deleteContact(\'' + c.id + '\')" aria-label="Delete"><i class="ti ti-trash"></i></button>'
          + '</div></div>';
      }).join('');
      return '<div class="mkt-group' + (isOrgLow ? ' mkt-group-low' : '') + '">'
        + '<div class="mkt-group-header"><span class="mkt-group-emoji">' + groupEmoji + '</span><span class="mkt-group-name">' + key + '</span>'
        + '<button class="mkt-org-star' + (isOrgLow ? '' : ' mkt-org-star-on') + '" onclick="toggleOrgPriority(\'' + safeKey + '\')" title="' + (isOrgLow ? 'Prioritise org' : 'Deprioritise org') + '">' + (isOrgLow ? '·' : '⭐') + '</button>'
        + '</div>'
        + '<div class="mkt-group-rows">' + rows + '</div></div>';
    };

    let orgsHtml = starredKeys.map(renderOrgGroup).join('');
    if (unstarredKeys.length) {
      const unstarredKey = typeKey + '::unstarred';
      const unstarredCollapsed = Object.prototype.hasOwnProperty.call(collapsePrefs, unstarredKey) ? collapsePrefs[unstarredKey] : true;
      const safeUnstarredKey = unstarredKey.replace(/'/g, "\\'");
      const unstarredDomId = mktSectionDomId(unstarredKey);
      orgsHtml += '<div class="mkt-unstarred-header" onclick="toggleMktSection(\'' + safeUnstarredKey + '\')">'
        + '<i id="mkt-chev-' + unstarredDomId + '" class="ti ' + (unstarredCollapsed ? 'ti-chevron-right' : 'ti-chevron-down') + '"></i> Unstarred'
        + '</div>'
        + '<div id="mkt-section-' + unstarredDomId + '"' + (unstarredCollapsed ? ' style="display:none;"' : '') + '>' + unstarredKeys.map(renderOrgGroup).join('') + '</div>';
    }

    const collapsed = collapsePrefs[typeKey] === true;
    const safeType = typeKey.replace(/'/g, "\\'");
    const domId = mktSectionDomId(typeKey);
    const header = '<div class="mkt-orgtype-header" onclick="toggleMktSection(\'' + safeType + '\')">'
      + '<i id="mkt-chev-' + domId + '" class="ti ' + (collapsed ? 'ti-chevron-right' : 'ti-chevron-down') + '"></i> ' + typeKey
      + '</div>';

    return '<div class="mkt-orgtype-section">' + header
      + '<div id="mkt-section-' + domId + '"' + (collapsed ? ' style="display:none;"' : '') + '>' + orgsHtml + '</div>'
      + '</div>';
  }).join('');
}

// ── Checklists ────────────────────────────────────
function renderMktChecklists() {
  renderMktChecklist('mkt-weekly-checks',  WEEKLY_CHECKS,  'weekly');
  renderMktChecklist('mkt-monthly-checks', MONTHLY_CHECKS, 'monthly');
}
function renderMktChecklist(elId, groups, period) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = groups.map(group => {
    const items = group.items.map(item => {
      const done = isChecked(item.id, period);
      return '<div class="mkt-check-item' + (done ? ' mkt-done' : '') + '" onclick="toggleCheck(\'' + item.id + '\',\'' + period + '\')">'
        + '<div class="mkt-check-box">' + (done ? '<i class="ti ti-check"></i>' : '') + '</div>'
        + '<div class="mkt-check-label">' + item.label + '</div></div>';
    }).join('');
    return '<div class="mkt-check-group"><div class="mkt-check-group-header"><i class="ti ' + group.icon + '" aria-hidden="true"></i>' + group.group + '</div>' + items + '</div>';
  }).join('');
}
function updateMktAccCounts() {
  const wTotal = WEEKLY_CHECKS.reduce((n,g) => n + g.items.length, 0);
  const wDone  = WEEKLY_CHECKS.reduce((n,g) => n + g.items.filter(i => isChecked(i.id,'weekly')).length, 0);
  const wEl = document.getElementById('mkt-week-count');
  if (wEl) wEl.textContent = wDone + '/' + wTotal;
  const mTotal = MONTHLY_CHECKS.reduce((n,g) => n + g.items.length, 0);
  const mDone  = MONTHLY_CHECKS.reduce((n,g) => n + g.items.filter(i => isChecked(i.id,'monthly')).length, 0);
  const mEl = document.getElementById('mkt-month-count');
  if (mEl) mEl.textContent = mDone + '/' + mTotal;
}

// ── CRM sync ──────────────────────────────────────
async function refreshCrmContacts(btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-refresh"></i> Syncing...'; }
  await loadCrmContacts();
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-refresh"></i> Sync CRM'; }
}

async function loadCrmContacts() {
  try {
    const res = await fetch('/api/crm-contacts');
    const orgs = await res.json();
    for (const org of orgs) {
      for (const c of org.contacts) {
        const saved = mktContacts.find(m => m.crm_id === c.id);
        if (saved) {
          // Update CRM-sourced fields only — preserve influence + last_touchpoint
          saved.name    = c.name;
          saved.agency  = org.orgName;
          saved.org_type = org.orgType;
          saved.job_title = c.jobTitle || null;
          await patchContact(saved.id, { name: c.name, agency: org.orgName, org_type: org.orgType, job_title: c.jobTitle || null });
        } else {
          const nc = {
            id:              'crm_' + c.id,
            crm_id:          c.id,
            type:            'existing',
            name:            c.name,
            agency:          org.orgName,
            org_type:        org.orgType,
            role:            c.role || null,
            job_title:       c.jobTitle || null,
            notes:           c.notes || null,
            last_touchpoint: null,
            influence:       'key',
            from_crm:        true,
            stage:           null,
          };
          mktContacts.push(nc);
          await upsertContact(nc);
        }
      }
    }
    renderMktPipeline();
  } catch(e) { console.log('CRM load error', e); }
}

// ── Contact modal ─────────────────────────────────
function toggleContactType() {
  const type = document.getElementById('cm-type').value;
  const isExisting = type === 'existing';
  const roleField = document.getElementById('cm-role-field');
  const stageRow  = document.getElementById('cm-stage-row');
  const existRow  = document.getElementById('cm-existing-row');
  if (roleField) roleField.style.display = isExisting ? 'none' : '';
  if (stageRow)  stageRow.style.display  = isExisting ? 'none' : '';
  if (existRow)  existRow.style.display  = isExisting ? '' : 'none';
}

function openAddContact() {
  document.getElementById('contact-modal-title').textContent = 'Add contact';
  document.getElementById('cm-type').value       = 'target';
  document.getElementById('cm-name').value       = '';
  document.getElementById('cm-role').value       = 'creative';
  const addAgencyEl = document.getElementById('cm-agency');
  addAgencyEl.value    = '';
  addAgencyEl.readOnly = false;
  addAgencyEl.style.opacity = '1';
  document.getElementById('cm-notes').value      = '';
  document.getElementById('cm-stage').value      = 'new';
  document.getElementById('cm-last-touch').value = '';
  document.getElementById('cm-last-contact').value = '';
  const inf = document.getElementById('cm-influence'); if (inf) inf.value = 'key';
  toggleContactType();
  document.getElementById('contact-modal-bg').classList.remove('hidden');
  document.getElementById('contact-modal-bg')._editId = null;
  setTimeout(() => document.getElementById('cm-name').focus(), 50);
}

function editContact(id) {
  const c = mktContacts.find(c => c.id === id);
  if (!c) return;
  document.getElementById('contact-modal-title').textContent = 'Edit contact';
  const isCrm = !!(c.crm_id || c.crmId);
  document.getElementById('cm-type').value   = c.type || 'target';
  document.getElementById('cm-name').value   = c.name || '';
  document.getElementById('cm-role').value   = c.role || 'creative';
  const agencyEl = document.getElementById('cm-agency');
  agencyEl.value    = c.agency || '';
  agencyEl.readOnly = isCrm;
  agencyEl.style.opacity = isCrm ? '0.5' : '1';
  document.getElementById('cm-notes').value  = c.notes || '';
  document.getElementById('cm-stage').value  = c.stage || 'new';
  const lt = (c.last_touchpoint || c.lastTouchpoint || '').toString().split('T')[0];
  document.getElementById('cm-last-touch').value   = lt;
  document.getElementById('cm-last-contact').value = lt;
  const infEl = document.getElementById('cm-influence');
  if (infEl) infEl.value = c.influence || 'key';
  toggleContactType();
  document.getElementById('contact-modal-bg').classList.remove('hidden');
  document.getElementById('contact-modal-bg')._editId = id;
  setTimeout(() => document.getElementById('cm-name').focus(), 50);
}

function closeContactModal() {
  document.getElementById('contact-modal-bg').classList.add('hidden');
}

async function saveContact() {
  const name = document.getElementById('cm-name').value.trim();
  if (!name) { document.getElementById('cm-name').focus(); return; }
  const type       = document.getElementById('cm-type').value;
  const isExisting = type === 'existing';
  const editId     = document.getElementById('contact-modal-bg')._editId;
  const lastTouch  = isExisting
    ? document.getElementById('cm-last-contact').value
    : document.getElementById('cm-last-touch').value;
  const infEl = document.getElementById('cm-influence');

  const data = {
    id:              editId || ('m' + Date.now()),
    type,
    name,
    role:            isExisting ? null : document.getElementById('cm-role').value,
    agency:          document.getElementById('cm-agency').value.trim(),
    notes:           document.getElementById('cm-notes').value.trim(),
    stage:           isExisting ? null : document.getElementById('cm-stage').value,
    last_touchpoint: lastTouch || null,
    influence:       isExisting ? (infEl ? infEl.value : 'key') : null,
    from_crm:        false,
  };

  if (editId) {
    const idx = mktContacts.findIndex(c => c.id === editId);
    if (idx > -1) mktContacts[idx] = { ...mktContacts[idx], ...data };
  } else {
    mktContacts.push(data);
  }

  await upsertContact(data);
  closeContactModal();
  renderMktPipeline();
}

async function deleteContact(id) {
  if (!confirm('Remove this contact?')) return;
  mktContacts = mktContacts.filter(c => c.id !== id);
  await removeContact(id);
  renderMktPipeline();
}

async function advanceContact(id) {
  const c = mktContacts.find(c => c.id === id);
  if (!c) return;
  const stageIds = STAGES.map(s => s.id);
  const idx = stageIds.indexOf(c.stage || 'new');
  if (idx < stageIds.length - 1) {
    const today    = new Date().toISOString().split('T')[0];
    c.stage        = stageIds[idx + 1];
    c.last_touchpoint = today;
    await patchContact(id, { stage: c.stage, last_touchpoint: today });
    renderMktPipeline();
    await loadTasks();
  }
}

function touchContact(id) {
  const c = mktContacts.find(c => c.id === id);
  if (!c) return;
  document.getElementById('touch-modal-name').textContent = c.name;
  document.getElementById('touch-modal-bg')._contactId = id;
  const last = c.last_touchpoint || c.lastTouchpoint;
  document.getElementById('touch-modal-date').value = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[name="touch-type"]').forEach(r => r.checked = false);
  document.getElementById('touch-modal-notes').value = c.notes || '';
  const lastInfo = document.getElementById('touch-modal-last');
  const clearBtn = document.getElementById('touch-modal-clear');
  if (last) {
    const days = Math.floor((new Date() - new Date(last)) / 86400000);
    const d = last.toString().split('T')[0];
    if (lastInfo) lastInfo.textContent = 'Last touch: ' + d + ' (' + days + ' days ago)';
    if (clearBtn) clearBtn.style.display = '';
  } else {
    if (lastInfo) lastInfo.textContent = 'No touch logged yet';
    if (clearBtn) clearBtn.style.display = 'none';
  }
  document.getElementById('touch-modal-bg').classList.remove('hidden');
}

async function clearTouchPoint(id) {
  const c = mktContacts.find(c => c.id === id);
  if (!c) return;
  if (!confirm('Clear last touchpoint for ' + c.name + '?')) return;
  c.last_touchpoint = null;
  c.lastTouchpoint = null;
  c.last_touch_type = null;
  await patchContact(id, { last_touchpoint: null, last_touch_type: null });
  document.getElementById('touch-modal-bg').classList.add('hidden');
  renderMktPipeline();
}

async function saveTouchModal() {
  const bg = document.getElementById('touch-modal-bg');
  const id = bg._contactId;
  const typeEl = document.querySelector('input[name="touch-type"]:checked');
  if (!typeEl) { return; }
  const date = document.getElementById('touch-modal-date').value || new Date().toISOString().split('T')[0];
  const notes = document.getElementById('touch-modal-notes').value.trim();
  const c = mktContacts.find(c => c.id === id);
  if (!c) return;
  const touchType = typeEl.value;
  c.last_touchpoint = date;
  c.last_touch_type = touchType;
  await patchContact(id, { last_touchpoint: date, last_touch_type: touchType, notes: notes || c.notes || null });
  bg.classList.add('hidden');
  renderMktPipeline();
}

function closeTouchModal() {
  document.getElementById('touch-modal-bg').classList.add('hidden');
}

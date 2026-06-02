const today = (() => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
})();
let tasks = [];
let chatHistory = [];

document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  setDate();
  loadTasks();
  loadShootPlanner();
  loadShootTasksForToday();
  bindNav();
  bindModal();
  bindChat();
  showInboxPrompt();
  loadInboxCalendar();
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
      if (view === 'inbox') { showInboxPrompt(); loadInboxCalendar(); }
      if (view === 'scheduled') renderScheduled();
      if (view === 'weekly') renderWeekly();
      if (view === 'conversations') renderConversations();
      if (view === 'shoots') renderShoots();
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

async function editTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  document.getElementById('m-title').value = t.title;
  document.getElementById('m-notes').value = t.notes || '';
  document.getElementById('m-due').value = t.due_date ? t.due_date.split('T')[0] : '';
  document.getElementById('m-priority').value = t.priority || 'p3';
  document.getElementById('m-category').value = t.category || 'work';
  document.getElementById('m-recurring').value = t.recurring || '';
  document.getElementById('m-tag').value = t.tag || '';
  document.getElementById('modal-bg').classList.remove('hidden');
  document.getElementById('modal-bg')._editId = id;
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
          ${t.tag ? '<span class="tag">' + t.tag + '</span>' : ''}
          ${t.due_date ? '<span class="task-date ' + (od ? 'overdue' : '') + '">' + (od ? '⚠ ' : '') + formatDate(t.due_date) + '</span>' : ''}
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
  document.getElementById('m-title').value = t.title;
  document.getElementById('m-notes').value = t.notes || '';
  document.getElementById('m-due').value = t.due_date ? t.due_date.split('T')[0] : '';
  document.getElementById('m-priority').value = t.priority || 'p3';
  document.getElementById('m-category').value = t.category || 'work';
  document.getElementById('m-recurring').value = t.recurring || '';
  document.getElementById('m-tag').value = t.tag || '';
  const doneEl = document.getElementById('m-done');
  if (doneEl) doneEl.checked = t.done || false;
  document.getElementById('modal-bg').classList.remove('hidden');
  document.getElementById('modal-bg')._editId = id;
  document.getElementById('modal-bg')._wasCompleted = t.done || false;
  setTimeout(() => document.getElementById('m-title').focus(), 50);
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
}

function openModal() {
  document.getElementById('m-title').value = '';
  document.getElementById('m-notes').value = '';
  document.getElementById('m-due').value = today;
  document.getElementById('m-priority').value = 'p3';
  document.getElementById('m-category').value = 'work';
  document.getElementById('m-recurring').value = '';
  document.getElementById('m-tag').value = '';
  document.getElementById("modal-bg").classList.remove('hidden');
  setTimeout(() => document.getElementById('m-title').focus(), 50);
}

function closeModal() { document.getElementById("modal-bg").classList.add('hidden'); }

async function saveModal() {
  const title = document.getElementById('m-title').value.trim();
  if (!title) return;
  const due = document.getElementById('m-due').value;
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
    // Edit existing task
    await fetch('/api/tasks/' + editId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        notes: document.getElementById('m-notes').value,
        due_date: due || null,
        priority: document.getElementById('m-priority').value,
        category: document.getElementById('m-category').value,
        recurring: document.getElementById('m-recurring').value,
        tag: document.getElementById('m-tag').value
      })
    });
    const t = tasks.find(t => t.id === editId);
    if (t) {
      t.title = title;
      t.notes = document.getElementById('m-notes').value;
      t.due_date = due || null;
      t.priority = document.getElementById('m-priority').value;
      t.category = document.getElementById('m-category').value;
      t.recurring = document.getElementById('m-recurring').value;
      t.tag = document.getElementById('m-tag').value;
    }
    document.getElementById('modal-bg')._editId = undefined;
  } else {
    await createTask({
      title,
      notes: document.getElementById('m-notes').value,
      due_date: due || null,
      priority: document.getElementById('m-priority').value,
      category: document.getElementById('m-category').value,
      recurring: document.getElementById('m-recurring').value,
      tag: document.getElementById('m-tag').value
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

async function loadShootPlanner() {
  try {
    const res = await fetch('/api/shoot-planner');
    const data = await res.json();
    window._spData = data;
    renderShootPlannerPanel(data);
    const events = await loadCalendarEvents();
    window._calEvents = events;
    generateBriefingWithContext(data, events);
    return data;
  } catch(e) {
    console.log('Shoot Planner unavailable', e);
    window._spData = null;
    window._calEvents = [];
    generateBriefingWithContext(null, []);
    return null;
  }
}

function renderShootPlannerPanel(data) {
  // Shoots now live in the Shoots tab - nothing to render here
  const el = document.getElementById('sp-panel');
  if (el) el.innerHTML = '';
}

async function generateBriefingWithContext(spData, calEvents) {
  const el = document.getElementById('pa-note-text');
  const overdue = tasks.filter(t => isOverdue(t.due_date)).length;
  const dueToday = tasks.filter(t => isDueToday(t.due_date)).length;
  const todayTasks = tasks.filter(t => isOverdue(t.due_date) || isDueToday(t.due_date));
  const taskList = todayTasks.map(t => '"' + t.title + '" (' + t.category + ', ' + t.priority + (isOverdue(t.due_date) ? ', OVERDUE' : ', due today') + ')').join('; ');

  let shootContext = '';
  if (calEvents && calEvents.length) {
    const now = new Date();
    const todayCal = calEvents.filter(e => {
      if (e.start.split('T')[0] !== today) return false;
      if (e.allDay) return true;
      // Only include if event hasn't ended yet
      const eventEnd = e.end ? new Date(e.end) : new Date(new Date(e.start).getTime() + 3600000);
      return eventEnd > now;
    });
    if (todayCal.length) shootContext += 'CALENDAR TODAY (upcoming only): ' + todayCal.map(e => e.title + (e.allDay ? '' : ' at ' + new Date(e.start).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}))).join(', ') + '. ';
  }
  if (spData && spData.shoots && spData.shoots.length) {
    const todayShoots = spData.shoots.filter(s => s.startDate === today);
    const soonShoots = spData.shoots.filter(s => s.startDate !== today);
    if (todayShoots.length) shootContext += 'TODAY\'S SHOOTS: ' + todayShoots.map(s => s.name).join(', ') + '. ';
    if (soonShoots.length) shootContext += 'UPCOMING SHOOTS: ' + soonShoots.map(s => s.name + ' on ' + s.startDate).join(', ') + '. ';
  }
  if (spData && spData.quotes && spData.quotes.length) {
    const stale = spData.quotes.filter(q => Math.floor((new Date() - new Date(q.createdAt)) / 86400000) >= 2);
    if (stale.length) shootContext += 'STALE QUOTES (unsent 2+ days): ' + stale.map(q => q.name + ' for ' + q.clientName).join(', ') + '. ';
  }

  const days = getWeekDays();
  const weekEnd = days[6].toISOString().split('T')[0];
  const weekTasks = tasks.filter(t => t.due_date && t.due_date.split('T')[0] <= weekEnd && !isOverdue(t.due_date) && !isDueToday(t.due_date));
  const weekTaskList = weekTasks.map(t => '"' + t.title + '" (due ' + formatDate(t.due_date) + ', ' + t.priority + ')').join('; ');
  const context = 'Today is ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '. ' + shootContext + 'Ryan has ' + tasks.length + ' open tasks. ' + (overdue > 0 ? overdue + ' are overdue. ' : '') + (dueToday > 0 ? dueToday + ' due today. ' : '') + 'Tasks due today: ' + taskList + (weekTaskList ? '. Tasks later this week: ' + weekTaskList : '') + '.'

  try {
    const res = await fetch('/api/pa/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: 'You are Ryan\'s personal PA. Ryan is a commercial food photographer based in London and Somerset running his own limited company with clients including Lidl, Nando\'s, Ocado, and Ardbeg. The current year is 2026. Give a short direct morning briefing. Be blunt, no softening. IMPORTANT rules: (1) If UPCOMING SHOOTS lists a shoot as today, lead with that. (2) Only surface tasks that are overdue or due TODAY. Never mention tasks due tomorrow or later — they belong in the weekly view not the daily briefing. The one exception is if there is a shoot tomorrow, mention prep needed today. (3) Output plain text only, no markdown. One punchy sentence summarising what matters right now, then bullet points (use • ) for each actionable item. Use as many or as few bullets as needed — no minimum, no maximum. If nothing is urgent just say so in one sentence.',
        messages: [{ role: 'user', content: 'Here is my context:\n' + context + '\n\nGive me my morning briefing.' }]
      })
    });
    const data = await res.json();
    const raw = data.content[0].text.replace(/\*\*(.+?)\*\*/g, '$1');
    el.innerHTML = raw.split('\n').filter(l => l.trim()).map(line => line.startsWith('•') ? '<div style="display:flex;gap:8px;margin-top:4px;"><span>•</span><span>' + line.slice(1).trim() + '</span></div>' : '<div style="margin-bottom:6px;font-weight:500;">' + line + '</div>').join('');
  } catch (err) {
    el.textContent = shootContext || (tasks.length + ' tasks open.');
  }
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendMsg('me', msg);
  chatHistory.push({ role: 'user', content: msg });
  const loading = appendMsg('pa', 'Thinking...', true);
  const taskContext = tasks.slice(0, 15).map(t => '- ' + t.title + ' (' + t.category + ', ' + t.priority + (t.due_date ? ', due ' + formatDate(t.due_date) : '') + ')').join('\n');
  let calendarContext = 'Not loaded';
  try {
    const calRes = await fetch('/api/calendar');
    const calData = await calRes.json();
    if (calData.events && calData.events.length) {
      calendarContext = calData.events.map(e => {
        const d = new Date(e.start.split('T')[0] + 'T00:00:00');
        const label = d.toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'});
        const time = e.allDay ? 'all day' : new Date(e.start).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
        return '- ' + label + ': ' + e.title + ' (' + time + ')';
      }).join('\n');
    }
  } catch(e) { calendarContext = 'Unavailable'; }

  try {
    const res = await fetch('/api/pa/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: 'You are Ryan\'s personal PA. Ryan is a commercial food photographer in London and Somerset with clients including Lidl, Nando\'s, Ocado, Ardbeg. The current date and time is ' + new Date().toLocaleDateString('en-GB', {weekday:'long',day:'numeric',month:'long',year:'numeric'}) + ' at ' + new Date().toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) + '. Be direct and blunt — no softening, no hedging. Short sentences. One clear answer, not options. Connect advice to real consequences. Money and client emails always come first. He avoids sending estimates and following up with clients — call this out. He does admin late at night which hurts his sleep — push him to do it earlier. Creative work and gardening are legitimate productivity. When he asks if he can do something enjoyable, check his tasks and give a straight yes or no with one reason.\n\nHis open tasks:\n' + taskContext + '\n\nCalendar events (next 14 days):\n' + calendarContext,
        messages: chatHistory
      })
    });
    const data = await res.json();
    const reply = data.content[0].text;
    loading.textContent = reply;
    loading.classList.remove('loading');
    chatHistory.push({ role: 'assistant', content: reply });
  } catch (err) {
    loading.textContent = 'Something went wrong — try again.';
    loading.classList.remove('loading');
  }
}

function bindChat() {
  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
}

function appendMsg(who, text, isLoading = false) {
  const msgs = document.getElementById('chat-msgs');
  const div = document.createElement('div');
  div.className = 'msg msg-' + who;
  div.innerHTML = '<div class="msg-label">' + (who === 'pa' ? 'PA' : 'Ryan') + '</div><div class="msg-bubble' + (isLoading ? ' loading' : '') + '">' + text + '</div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div.querySelector('.msg-bubble');
}



function showInboxPrompt() {
  const el = document.getElementById('inbox-proposals');
  if (!el) return;
  if (el._loaded) return;
  el.innerHTML = '<div style="text-align:center;padding:3rem 1rem;"><div style="font-size:13px;color:var(--text2);margin-bottom:1rem;">Check your inbox for emails needing action</div><button onclick="loadInbox()" class="btn-add">Check emails</button></div>';
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
  // Open modal pre-filled with proposal data
  document.getElementById('m-title').value = p.suggestedTask;
  document.getElementById('m-notes').value = p.action + ' (from: ' + p.from + ')';
  document.getElementById('m-due').value = '';
  document.getElementById('m-priority').value = p.priority || 'p3';
  document.getElementById('m-category').value = 'work';
  document.getElementById('m-recurring').value = '';
  document.getElementById('m-tag').value = p.from;
  document.getElementById('modal-bg').classList.remove('hidden');
  document.getElementById('modal-bg')._proposalIndex = i;
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


function getWeekDays() {
  const days = [];
  const start = new Date();
  start.setHours(0,0,0,0);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
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

const BLOCKS = [
  { id: 'morning', label: 'Morning', time: '8am - 12pm' },
  { id: 'afternoon', label: 'Afternoon', time: '12pm - 6pm' },
  { id: 'evening', label: 'Evening', time: '6pm - 9pm' }
];

function renderWeekly() {
  const el = document.getElementById('weekly-tasks');
  if (!el) return;
  renderWeeklyGrid();
  generateWeeklyPlan(window._spData || null, window._calEvents || []);
}

let draggedTaskId = null;

function dragTask(event, id) {
  draggedTaskId = id;
  event.dataTransfer.effectAllowed = 'move';
}

async function dropTask(event) {
  event.preventDefault();
  if (!draggedTaskId) return;
  const cell = event.currentTarget;
  const date = cell.dataset.date;
  const block = cell.dataset.block;
  const task = tasks.find(t => t.id === draggedTaskId);
  if (!task) return;

  // Check if dropping onto another task for reordering
  const targetTaskEl = event.target.closest('.wgb-task');
  const targetTaskId = targetTaskEl ? parseInt(targetTaskEl.dataset.taskId) : null;

  const sameBlock = task.due_date && task.due_date.split('T')[0] === date && task.time_block === block;

  if (sameBlock && targetTaskId && targetTaskId !== draggedTaskId) {
    // Reorder within block
    await fetch('/api/tasks/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: draggedTaskId, targetTaskId, date, block })
    });
    // Update local sort_order
    const blockTasks = tasks.filter(t => t.due_date && t.due_date.split('T')[0] === date && t.time_block === block);
    let ids = blockTasks.sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(t => t.id);
    ids = ids.filter(id => id !== draggedTaskId);
    const targetIdx = ids.indexOf(targetTaskId);
    if (targetIdx === -1) ids.push(draggedTaskId); else ids.splice(targetIdx, 0, draggedTaskId);
    ids.forEach((id, i) => { const t = tasks.find(t => t.id === id); if (t) t.sort_order = i; });
  } else {
    // Move to new block
    await fetch('/api/tasks/' + draggedTaskId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: date, time_block: block })
    });
    task.due_date = date;
    task.time_block = block;
  }
  draggedTaskId = null;
  renderWeeklyGrid();
}

async function dropTaskUnscheduled(event) {
  event.preventDefault();
  if (!draggedTaskId) return;
  const task = tasks.find(t => t.id === draggedTaskId);
  if (!task) return;
  await fetch('/api/tasks/' + draggedTaskId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due_date: null, time_block: null })
  });
  task.due_date = null;
  task.time_block = null;
  draggedTaskId = null;
  renderWeekly();
}



async function generateWeeklyPlan(spData, calEvents) {
  // Store day summaries for rendering in grid headers
  window._weeklyDaySummaries = {};
  const days = getWeekDays();
  const weekEnd = days[6].toISOString().split('T')[0];

  const tasksByDay = {};
  days.forEach(d => {
    const ds = localDateStr(d);
    tasksByDay[ds] = tasks.filter(t => t.due_date && t.due_date.split('T')[0] === ds);
  });

  let context = 'Today is ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.\n\n';

  if (spData && spData.shoots && spData.shoots.length) {
    context += 'SHOOTS:\n' + spData.shoots.map(s => '- ' + s.name + ' on ' + s.startDate).join('\n') + '\n\n';
  }
  if (calEvents && calEvents.length) {
    const weekCal = calEvents.filter(e => e.start.split('T')[0] <= weekEnd);
    if (weekCal.length) {
      context += 'CALENDAR:\n' + weekCal.map(e => {
        const d = new Date(e.start.split('T')[0] + 'T00:00:00');
        return '- ' + d.toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'short'}) + ': ' + e.title;
      }).join('\n') + '\n\n';
    }
  }
  context += 'TASKS BY DAY:\n';
  days.forEach(d => {
    const ds = localDateStr(d);
    const dayLabel = d.toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'short'});
    const dayTasks = tasksByDay[ds];
    context += dayLabel + ' (' + ds + '): ' + (dayTasks.length ? dayTasks.map(t => t.title + ' (' + t.priority + ')').join(', ') : 'nothing scheduled') + '\n';
  });
  const undated = tasks.filter(t => !t.due_date);
  if (undated.length) context += '\nUNSCHEDULED: ' + undated.map(t => t.title).join(', ') + '\n';

  try {
    const res = await fetch('/api/pa/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: "You are Ryans personal PA. Analyse his week and return ONLY a JSON object, no markdown, no explanation. Format: { \"weekSummary\": \"one punchy sentence about the shape of the week\", \"watchOut\": \"one line risk warning or empty string\", \"days\": { \"YYYY-MM-DD\": \"one short sentence about this day e.g. Admin morning, shoot prep afternoon\" } }. Rules: shoot days = blocked. Family events = context only unless they consume the whole day. Focus on work capacity. Keep each day summary under 8 words.",
        messages: [{ role: 'user', content: context + '\nReturn JSON only.' }]
      })
    });
    const data = await res.json();
    const raw = data.content[0].text.replace(/```json|```/g, '').trim();
    console.log('Weekly PA raw:', raw);
    const parsed = JSON.parse(raw);
    console.log('Weekly PA parsed:', JSON.stringify(parsed));
    window._weeklyDaySummaries = parsed.days || {};
    window._weekSummary = parsed.weekSummary || '';
    window._weekWatchOut = parsed.watchOut || '';
  } catch(e) {
    console.log('Weekly plan error', e);
    window._weeklyDaySummaries = {};
    window._weekSummary = '';
    window._weekWatchOut = '';
  }

  // Re-render the grid now we have summaries
  renderWeeklyGrid();
}

function renderWeeklyGrid() {
  const el = document.getElementById('weekly-tasks');
  if (!el) return;
  const days = getWeekDays();
  const summaries = window._weeklyDaySummaries || {};

  let html = '';

  if (window._weekSummary) {
    html += '<div class="week-summary-bar">' + window._weekSummary + '</div>';
  }
  if (window._weekWatchOut) {
    html += '<div class="week-watchout">\u26a0 ' + window._weekWatchOut + '</div>';
  }

  // Day summary cards
  html += '<div class="week-day-cards">';
  days.forEach(d => {
    const dateStr = localDateStr(d);
    const isToday = dateStr === today;
    const summary = summaries[dateStr] || '';
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
    const dayNum = d.getDate();
    const monthName = d.toLocaleDateString('en-GB', { month: 'short' });
    html += '<div class="week-day-card' + (isToday ? ' week-day-card-today' : '') + '">';
    html += '<div class="wdc-date">';
    html += '<span class="wdc-day">' + dayName + '</span>';
    if (isToday) {
      html += '<span class="wdc-num wdc-num-today">' + dayNum + '</span>';
    } else {
      html += '<span class="wdc-num">' + dayNum + '</span>';
    }
    html += '<span class="wdc-month">' + monthName + '</span>';
    html += '</div>';
    html += '<div class="wdc-summary">' + (summary || '<span style="color:var(--text3);font-style:italic;font-size:11px;">Loading...</span>') + '</div>';
    html += '</div>';
  });
  html += '</div>';

  // Schedule grid
  html += '<div class="week-schedule-label">Schedule</div>';
  html += '<div class="week-grid-blocks">';
  html += '<div class="wgb-header-row">';
  html += '<div class="wgb-block-col"></div>';
  days.forEach(d => {
    const dateStr = localDateStr(d);
    const isToday = dateStr === today;
    html += '<div class="wgb-day-header' + (isToday ? ' wgb-today' : '') + '">';
    html += '<div class="wgb-day-name">' + d.toLocaleDateString('en-GB', { weekday: 'short' }) + '</div>';
    html += '<div class="wgb-day-num' + (isToday ? ' wgb-day-num-today' : '') + '">' + d.getDate() + '</div>';
    html += '</div>';
  });
  html += '</div>';

  BLOCKS.forEach(block => {
    html += '<div class="wgb-row">';
    html += '<div class="wgb-block-col"><div class="wgb-block-label">' + block.label + '</div><div class="wgb-block-time">' + block.time + '</div></div>';
    days.forEach(d => {
      const dateStr = localDateStr(d);
      const isToday = dateStr === today;
      const cellTasks = tasks.filter(t => t.due_date && t.due_date.split('T')[0] === dateStr && t.time_block === block.id).sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
      html += '<div class="wgb-cell' + (isToday ? ' wgb-cell-today' : '') + '" data-date="' + dateStr + '" data-block="' + block.id + '" ondragover="event.preventDefault()" ondrop="dropTask(event)">';
      cellTasks.forEach(t => {
        const cat = t.category || 'work';
        html += '<div class="wgb-task wgb-task-' + cat + '" id="weekly-task-' + t.id + '" draggable="true" data-task-id="' + t.id + '" ondragstart="dragTask(event,' + t.id + ')" ondblclick="editTask(' + t.id + ')" onclick="completeTaskWeekly(' + t.id + ')">';
        html += '<div class="wgb-task-title">' + t.title + '</div>';
        if (t.tag) html += '<div class="wgb-task-tag">' + t.tag + '</div>';
        html += '</div>';
      });
      html += '</div>';
    });
    html += '</div>';
  });
  html += '</div>';

  // No time row - tasks with a date but no time block
  html += '<div class="wgb-row">';
  html += '<div class="wgb-block-col"><div class="wgb-block-label">No time</div><div class="wgb-block-time">unassigned</div></div>';
  days.forEach(d => {
    const dateStr = localDateStr(d);
    const isToday = dateStr === today;
    const noTimeTasks = tasks.filter(t => t.due_date && t.due_date.split('T')[0] === dateStr && !t.time_block).sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
    html += '<div class="wgb-cell wgb-cell-notime' + (isToday ? ' wgb-cell-today' : '') + '" data-date="' + dateStr + '" data-block="" ondragover="event.preventDefault()" ondrop="dropTask(event)">';
    noTimeTasks.forEach(t => {
      const cat = t.category || 'work';
      html += '<div class="wgb-task wgb-task-' + cat + '" id="weekly-task-' + t.id + '" draggable="true" data-task-id="' + t.id + '" ondragstart="dragTask(event,' + t.id + ')" ondblclick="editTask(' + t.id + ')" onclick="completeTaskWeekly(' + t.id + ')">';
      html += '<div class="wgb-task-title">' + t.title + '</div>';
      if (t.tag) html += '<div class="wgb-task-tag">' + t.tag + '</div>';
      html += '</div>';
    });
    html += '</div>';
  });
  html += '</div>';
  html += '</div>';

  // Unscheduled - NO date at all
  const unscheduled = tasks.filter(t => !t.due_date);
  html += '<div class="wgb-unscheduled">';
  html += '<div class="wgb-unscheduled-label">Unscheduled \u2014 no date assigned</div>';
  html += '<div class="wgb-unscheduled-tasks" ondragover="event.preventDefault()" ondrop="dropTaskUnscheduled(event)">';
  if (unscheduled.length) {
    unscheduled.forEach(t => {
      const cat = t.category || 'work';
      html += '<div class="wgb-task wgb-task-' + cat + '" draggable="true" data-task-id="' + t.id + '" ondragstart="dragTask(event,' + t.id + ')" ondblclick="editTask(' + t.id + ')">';
      html += '<div class="wgb-task-title">' + t.title + '</div>';
      html += '</div>';
    });
  } else {
    html += '<div style="font-size:12px;color:var(--text3);">All tasks have dates.</div>';
  }
  html += '</div></div>';
  el.innerHTML = html;
}



// ── Chat toggle ───────────────────────────────────────────────────────────────
function toggleChat() {
  const panel = document.getElementById('chat-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    setTimeout(() => document.getElementById('chat-input').focus(), 100);
  }
}

// ── Generate day ──────────────────────────────────────────────────────────────

async function refreshBriefing() {
  const el = document.getElementById('pa-note-text');
  if (el) el.textContent = 'Refreshing...';
  const events = await loadCalendarEvents();
  window._calEvents = events;
  await loadShootPlanner();
}

async function generateDay() {
  const btn = document.getElementById('btn-generate-day');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Generating...';
  try {
    // Force fresh calendar and shoot planner data
    const events = await loadCalendarEvents();
    window._calEvents = events;
    await loadShootPlanner();
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-brain"></i> Generate my day';
  }
  // Switch to Today view
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  document.querySelector('[data-view="today"]').classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-today').classList.remove('hidden');
  document.getElementById('topbar-title').textContent = 'Today';
  renderToday();
}

// ── Inbox calendar strip ──────────────────────────────────────────────────────
async function loadInboxCalendar() {
  const el = document.getElementById('inbox-calendar-strip');
  if (!el) return;
  try {
    const res = await fetch('/api/calendar');
    const data = await res.json();
    const events = data.events || [];
    const days = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    let html = '<div class="inbox-cal-strip">';
    days.forEach(d => {
      const ds = localDateStr(d);
      const isToday = ds === today;
      const label = isToday ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
      const dayEvents = events.filter(e => e.start.split('T')[0] === ds);
      html += '<div class="inbox-cal-day' + (isToday ? ' today' : '') + '">';
      html += '<div class="inbox-cal-day-label">' + label + '</div>';
      if (dayEvents.length) {
        dayEvents.forEach(e => {
          const time = e.allDay ? '' : ' ' + new Date(e.start).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
          html += '<div class="inbox-cal-event">' + e.title + time + '</div>';
        });
      } else {
        html += '<div class="inbox-cal-empty">Clear</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) {
    console.log('Calendar strip unavailable');
  }
}

// ── Conversations ─────────────────────────────────────────────────────────────
let savedConversations = JSON.parse(localStorage.getItem('pa_conversations') || '[]');

function saveConversation() {
  if (!chatHistory.length) return;
  const conv = {
    id: Date.now(),
    date: new Date().toISOString(),
    preview: chatHistory[0].content.slice(0, 80),
    messages: [...chatHistory]
  };
  savedConversations.unshift(conv);
  if (savedConversations.length > 50) savedConversations = savedConversations.slice(0, 50);
  localStorage.setItem('pa_conversations', JSON.stringify(savedConversations));
}

function renderConversations(filter = '') {
  const el = document.getElementById('conv-list');
  if (!el) return;
  const filtered = savedConversations.filter(c => 
    c.preview.toLowerCase().includes(filter.toLowerCase()) ||
    c.messages.some(m => m.content.toLowerCase().includes(filter.toLowerCase()))
  );
  if (!filtered.length) {
    el.innerHTML = '<div class="empty">No saved conversations yet.</div>';
    return;
  }
  el.innerHTML = filtered.map(c => {
    const d = new Date(c.date);
    const label = d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'short' }) + ' at ' + d.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
    return '<div class="conv-item" onclick="loadConversation(' + c.id + ')">' +
      '<div class="conv-item-date">' + label + '</div>' +
      '<div class="conv-item-preview">' + c.preview + '...</div>' +
      '</div>';
  }).join('');
}

function searchConversations(val) {
  renderConversations(val);
}

function loadConversation(id) {
  const conv = savedConversations.find(c => c.id === id);
  if (!conv) return;
  chatHistory = [...conv.messages];
  const msgs = document.getElementById('chat-msgs');
  msgs.innerHTML = conv.messages.map(m => {
    const who = m.role === 'user' ? 'me' : 'pa';
    const label = m.role === 'user' ? 'Ryan' : 'PA';
    return '<div class="msg msg-' + who + '"><div class="msg-label">' + label + '</div><div class="msg-bubble">' + m.content + '</div></div>';
  }).join('');
  msgs.scrollTop = msgs.scrollHeight;
  toggleChat();
}


// ── Mobile navigation ─────────────────────────────────────────────────────────
function isMobile() { return window.innerWidth <= 768; }

function mobileNav(view, tabEl) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  document.getElementById('topbar-title').textContent = 
    view === 'inbox' ? 'Inbox' :
    view === 'today' ? 'Today' :
    view === 'weekly' ? 'Weekly' :
    view === 'all' ? 'Tasks' :
    view === 'scheduled' ? 'Scheduled' :
    view === 'completed' ? 'Completed' :
    view === 'calendar' ? 'Calendar' :
    view === 'conversations' ? 'Conversations' : view;
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
  if (view === 'inbox') { showInboxPrompt(); loadInboxCalendar(); }
  if (view === 'scheduled') renderScheduled();
  if (view === 'weekly') renderWeekly();
  if (view === 'conversations') renderConversations();
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


async function completeTaskWeekly(id) {
  await fetch('/api/tasks/' + id + '/complete', { method: 'PATCH' });
  tasks = tasks.filter(t => t.id !== id);
  updateBadge();
  // Don't re-render — just strike through the task visually
  const el = document.getElementById('weekly-task-' + id);
  if (el) {
    el.style.opacity = '0.4';
    el.style.textDecoration = 'line-through';
    el.draggable = false;
    el.ondragstart = null;
  }
}


// ── Pull to refresh ───────────────────────────────────────────────────────────
(function() {
  if (window.innerWidth > 768) return;
  let startY = 0;
  let pulling = false;
  const indicator = document.createElement('div');
  indicator.className = 'pull-refresh-indicator';
  indicator.innerHTML = '<i class="ti ti-refresh"></i>';
  document.body.appendChild(indicator);

  document.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    pulling = window.scrollY === 0;
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
      setTimeout(() => location.reload(), 300);
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


// ── Shoots view ───────────────────────────────────────────────────────────────
let shootTasksCache = {};

async function renderShoots() {
  const el = document.getElementById('shoots-content');
  if (!el) return;
  el.innerHTML = '<div class="empty">Loading shoots...</div>';

  try {
    const res = await fetch('/api/shoot-planner');
    const data = await res.json();
    const shoots = data.shoots || [];

    if (!shoots.length) {
      el.innerHTML = '<div class="empty">No upcoming shoots.</div>';
      return;
    }

    let html = '';
    for (const shoot of shoots) {
      const taskRes = await fetch('/api/shoot-tasks/' + shoot.id);
      const shootTasks = await taskRes.json();
      shootTasksCache[shoot.id] = shootTasks;

      const done = shootTasks.filter(t => t.done).length;
      const total = shootTasks.length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const daysUntil = Math.ceil((new Date(shoot.startDate) - new Date()) / 86400000);
      const daysLabel = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : 'In ' + daysUntil + ' days';
      const urgent = daysUntil <= 3;

      html += '<div class="shoot-card" data-shoot-id="' + shoot.id + '">';
      html += '<div class="shoot-card-header">';
      html += '<div class="shoot-card-info">';
      html += '<div class="shoot-card-name">' + shoot.name + '</div>';
      html += '<div class="shoot-card-meta">';
      html += '<span class="tag tag-work">' + shoot.status + '</span>';
      html += '<span class="task-date' + (urgent ? ' overdue' : '') + '">' + shoot.startDate + ' · ' + daysLabel + '</span>';
      if (shoot.location) html += '<span class="tag">' + shoot.location + '</span>';
      html += '</div></div>';
      html += '<div class="shoot-card-progress">';
      if (total > 0) {
        html += '<div class="shoot-progress-bar"><div class="shoot-progress-fill" style="width:' + pct + '%"></div></div>';
        html += '<div class="shoot-progress-label">' + done + '/' + total + '</div>';
      }
      html += '<i class="ti ti-chevron-down shoot-chevron" id="chevron-' + shoot.id + '"></i>';
      html += '</div></div>';

      html += '<div class="shoot-tasks hidden" id="shoot-tasks-' + shoot.id + '">';
      if (total === 0) {
        html += '<div style="padding:1rem;text-align:center;">';
        html += '<div style="font-size:13px;color:var(--text3);margin-bottom:0.75rem;">No tasks yet for this shoot</div>';
        html += '<button class="btn-add generate-tasks-btn" style="font-size:12px;" data-shoot-id="' + shoot.id + '" data-shoot-name="' + shoot.name.replace(/"/g, '') + '">Generate standard tasks</button>';
        html += '</div>';
      } else {
        html += shootTasks.map(t => shootTaskHTML(t, shoot.id)).join('');
        html += '<div style="padding:0.5rem 1rem 0.75rem;">';
        html += '<button class="generate-tasks-btn" style="font-size:11px;padding:3px 10px;border:0.5px solid var(--border2);border-radius:var(--radius);background:transparent;cursor:pointer;color:var(--text3);" data-shoot-id="' + shoot.id + '" data-shoot-name="' + shoot.name.replace(/"/g, '') + '">Regenerate tasks</button>';
        html += '</div>';
      }
      html += '</div></div>';
    }
    el.innerHTML = html;

    // Attach event listeners after render
    el.querySelectorAll('.shoot-card-header').forEach(header => {
      header.addEventListener('click', () => {
        const shootId = header.closest('.shoot-card').dataset.shootId;
        toggleShootTasks(shootId);
      });
    });
    el.querySelectorAll('.generate-tasks-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        generateShootTasks(btn.dataset.shootId, btn.dataset.shootName);
      });
    });
    el.querySelectorAll('.shoot-task-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        toggleShootTask(parseInt(btn.dataset.taskId), btn.dataset.shootId);
      });
    });
    el.querySelectorAll('.shoot-task-date').forEach(input => {
      input.addEventListener('change', e => {
        setShootTaskDate(parseInt(input.dataset.taskId), input.value, input.dataset.shootId);
      });
    });

  } catch(e) {
    el.innerHTML = '<div class="empty">Could not load shoots.</div>';
    console.error('Shoots error:', e);
  }
}


function shootTaskHTML(t, shootId) {
  return '<div class="shoot-task" id="shoot-task-' + t.id + '">' +
    '<div class="check shoot-task-toggle' + (t.done ? ' checked' : '') + '" data-task-id="' + t.id + '" data-shoot-id="' + shootId + '">' +
    (t.done ? '<i class="ti ti-check"></i>' : '') +
    '</div>' +
    '<div class="shoot-task-body">' +
    '<div class="shoot-task-title' + (t.done ? ' done' : '') + '">' + t.title + '</div>' +
    (t.due_date ? '<div class="task-date" style="font-size:11px;margin-top:2px;">' + formatDate(t.due_date) + '</div>' : '') +
    '</div>' +
    '<input type="date" class="shoot-task-date" value="' + (t.due_date ? t.due_date.split('T')[0] : '') + '" data-task-id="' + t.id + '" data-shoot-id="' + shootId + '" title="Set due date" />' +
    '</div>';
}



function toggleShootTasks(shootId) {
  const tasks = document.getElementById('shoot-tasks-' + shootId);
  const chevron = document.getElementById('chevron-' + shootId);
  if (tasks) tasks.classList.toggle('hidden');
  if (chevron) chevron.style.transform = tasks.classList.contains('hidden') ? '' : 'rotate(180deg)';
}

async function toggleShootTask(taskId, shootId) {
  const res = await fetch('/api/shoot-tasks/' + taskId + '/complete', { method: 'PATCH' });
  const updated = await res.json();
  if (shootTasksCache[shootId]) {
    const t = shootTasksCache[shootId].find(t => t.id === taskId);
    if (t) t.done = updated.done;
  }
  // Update UI
  const el = document.getElementById('shoot-task-' + taskId);
  if (el) {
    const check = el.querySelector('.check');
    const title = el.querySelector('.shoot-task-title');
    if (updated.done) {
      check.classList.add('checked');
      check.innerHTML = '<i class="ti ti-check"></i>';
      title.classList.add('done');
    } else {
      check.classList.remove('checked');
      check.innerHTML = '';
      title.classList.remove('done');
    }
  }
  // Update progress bar
  renderShootProgress(shootId);
}

function renderShootProgress(shootId) {
  const tasks = shootTasksCache[shootId] || [];
  const done = tasks.filter(t => t.done).length;
  const total = tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const bar = document.querySelector('#shoot-card-' + shootId + ' .shoot-progress-fill');
  const label = document.querySelector('#shoot-card-' + shootId + ' .shoot-progress-label');
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = done + '/' + total;
}

async function generateShootTasks(shootId, shootName) {
  const res = await fetch('/api/shoot-tasks/' + shootId + '/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shootName })
  });
  await res.json();
  renderShoots();
}

async function setShootTaskDate(taskId, date, shootId) {
  if (!shootId && event && event.target) shootId = event.target.dataset.shootid;
  await fetch('/api/shoot-tasks/' + taskId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due_date: date || null })
  });
  if (shootTasksCache[shootId]) {
    const t = shootTasksCache[shootId].find(t => t.id === taskId);
    if (t) t.due_date = date || null;
  }
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
function switchMktSubTab(sub, btn) {
  const mktSubTabVar = sub;
  document.querySelectorAll('.mkt-subtab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const exEl = document.getElementById('mkt-panel-existing');
  const tgEl = document.getElementById('mkt-panel-targets');
  if (exEl) exEl.classList.toggle('hidden', sub !== 'existing');
  if (tgEl) tgEl.classList.toggle('hidden', sub !== 'targets');
  if (sub === 'existing') renderMktExisting();
  else renderMktKanban();
}


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
  if (tab === 'pipeline') renderMktExisting();
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
  renderMktExisting();
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

function renderMktExisting() {
  const el = document.getElementById('mkt-existing');
  if (!el) return;
  const now = new Date();
  const existing = mktContacts.filter(c => c.type === 'existing');
  if (!existing.length) {
    el.innerHTML = '<div class="mkt-pipeline-empty">Loading clients from your shoot planner CRM...</div>';
    return;
  }
  const groups = {};
  existing.forEach(c => {
    const key = c.agency || 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push({ ...c, ...urgencyData(c, now) });
  });
  const groupKeys = Object.keys(groups).sort((a, b) => {
    const score = cs => cs.some(c => c.isOverdue) ? 0 : cs.some(c => c.isSoon) ? 1 : 2;
    return score(groups[a]) - score(groups[b]);
  });
  el.innerHTML = groupKeys.map(key => {
    const contacts = groups[key].sort((a, b) => {
      const aKey = (a.influence || 'key') === 'key' ? 0 : 1;
      const bKey = (b.influence || 'key') === 'key' ? 0 : 1;
      if (aKey !== bKey) return aKey - bKey;
      const urgScore = c => c.isOverdue ? 0 : c.isSoon ? 1 : c.noDate ? 3 : 2;
      return urgScore(a) - urgScore(b);
    });
    const hasOverdue = contacts.some(c => c.isOverdue);
    const hasSoon    = contacts.some(c => c.isSoon);
    const groupEmoji = hasOverdue ? '🔴' : hasSoon ? '🟡' : '🟢';
    const rows = contacts.map(c => {
      const isKey = (c.influence || 'key') === 'key';
      let urg = '';
      if (c.isOverdue)     urg = '<span class="mkt-row-urgency mkt-urgency-over">🔴 ' + Math.abs(c.daysUntil) + 'd overdue</span>';
      else if (c.isSoon)   urg = '<span class="mkt-row-urgency mkt-urgency-soon">🟡 ' + c.daysUntil + 'd left</span>';
      else if (!c.noDate)  urg = '<span class="mkt-row-urgency mkt-urgency-ok">🟢 ' + c.daysUntil + 'd left</span>';
      else                 urg = '<span class="mkt-row-urgency mkt-urgency-none">— log first touch</span>';
      const touchTypeLabels = { card:'📬 Card', email:'✉️ Email', call:'📞 Call', gosee:'🤝 Go-see', onset:'🎬 On set', social:'💬 IG/LI', mailer:'📧 Mailer' };
      const touchTypeBadge = c.last_touch_type ? '<span class="mkt-touch-type-badge">' + (touchTypeLabels[c.last_touch_type] || c.last_touch_type) + '</span>' : '';
      return '<div class="mkt-row' + (c.isOverdue ? ' mkt-row-overdue' : '') + (isKey ? '' : ' mkt-row-light') + '">'
        + '<div class="mkt-row-emoji">' + (isKey ? '⭐' : '·') + '</div>'
        + '<div class="mkt-row-name' + (isKey ? '' : ' mkt-row-name-light') + '">' + c.name + '</div>'
        + '<div class="mkt-row-right">' + touchTypeBadge + urg
        + '<button class="mkt-row-touch" onclick="touchContact(\'' + c.id + '\')" title="Log touch">Log touch</button>'
        + '<button class="mkt-card-icon-btn" onclick="editContact(\'' + c.id + '\')" aria-label="Edit"><i class="ti ti-pencil"></i></button>'
        + '</div></div>';
    }).join('');
    return '<div class="mkt-group">'
      + '<div class="mkt-group-header"><span class="mkt-group-emoji">' + groupEmoji + '</span><span class="mkt-group-name">' + key + '</span></div>'
      + '<div class="mkt-group-rows">' + rows + '</div></div>';
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
          saved.name   = c.name;
          saved.agency = org.orgName;
          await patchContact(saved.id, { name: c.name, agency: org.orgName });
        } else {
          const nc = {
            id:              'crm_' + c.id,
            crm_id:          c.id,
            type:            'existing',
            name:            c.name,
            agency:          org.orgName,
            org_type:        org.orgType,
            role:            c.role || null,
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
    if (mktActiveTab === 'existing') renderMktExisting();
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
  if (isExisting) renderMktExisting();
  else renderMktKanban();
}

async function deleteContact(id) {
  if (!confirm('Remove this contact?')) return;
  mktContacts = mktContacts.filter(c => c.id !== id);
  await removeContact(id);
  if (mktActiveTab === 'existing') renderMktExisting();
  else renderMktKanban();
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
    renderMktKanban();
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
  renderMktExisting();
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
  renderMktExisting();
}

function closeTouchModal() {
  document.getElementById('touch-modal-bg').classList.add('hidden');
}

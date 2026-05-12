const today = new Date().toISOString().split('T')[0];
let tasks = [];
let chatHistory = [];

document.addEventListener('DOMContentLoaded', () => {
  setDate();
  loadTasks();
  loadShootPlanner();
  loadCalendarEvents().then(events => renderCalendarEvents(events));
  bindNav();
  bindModal();
  bindChat();
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

function taskHTML(t) {
  const od = isOverdue(t.due_date);
  const cat = t.category || 'work';
  return `
    <div class="task" id="task-${t.id}">
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
      <i class="ti ti-trash task-del" onclick="deleteTask(${t.id})"></i>
    </div>`;
}

function renderToday() {
  const el = document.getElementById('today-tasks');
  const overdue = tasks.filter(t => isOverdue(t.due_date));
  const dueToday = tasks.filter(t => isDueToday(t.due_date));
  const p1 = tasks.filter(t => !isOverdue(t.due_date) && !isDueToday(t.due_date) && t.priority === 'p1');
  const rest = tasks.filter(t => !isOverdue(t.due_date) && !isDueToday(t.due_date) && t.priority !== 'p1').slice(0, 5);
  let html = '';
  if (overdue.length) html += '<div class="section-lbl">Overdue</div>' + overdue.map(taskHTML).join('');
  if (dueToday.length) html += '<div class="section-lbl">Due today</div>' + dueToday.map(taskHTML).join('');
  if (p1.length) html += '<div class="section-lbl">High priority</div>' + p1.map(taskHTML).join('');
  if (rest.length) html += '<div class="section-lbl">Up next</div>' + rest.map(taskHTML).join('');
  if (!html) html = '<div class="empty">Nothing on your plate. Add a task or enjoy the quiet.</div>';
  el.innerHTML = html;
}

function renderAll() {
  const el = document.getElementById('all-tasks');
  if (!tasks.length) { el.innerHTML = '<div class="empty">No open tasks.</div>'; return; }
  el.innerHTML = tasks.map(taskHTML).join('');
}

async function renderCompleted() {
  const el = document.getElementById('completed-tasks');
  el.innerHTML = '<div class="empty">Loading...</div>';
  const res = await fetch('/api/tasks/completed');
  const done = await res.json();
  if (!done.length) { el.innerHTML = '<div class="empty">Nothing completed yet.</div>'; return; }
  el.innerHTML = done.map(t => `
    <div class="task done">
      <div class="check checked"><i class="ti ti-check"></i></div>
      <div class="task-body">
        <div class="task-title">${t.title}</div>
        <div class="task-meta"><span class="tag tag-${t.category || 'work'}">${t.category || 'work'}</span></div>
      </div>
    </div>`).join('');
}

function bindModal() {
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById("modal-bg").addEventListener('click', e => { if (e.target.classList.contains("modal-bg")) closeModal(); });
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
  await createTask({
    title,
    notes: document.getElementById('m-notes').value,
    due_date: document.getElementById('m-due').value,
    priority: document.getElementById('m-priority').value,
    category: document.getElementById('m-category').value,
    recurring: document.getElementById('m-recurring').value,
    tag: document.getElementById('m-tag').value
  });
  closeModal();
}

async function generateBriefing() {
  const el = document.getElementById('pa-note-text');
  const overdue = tasks.filter(t => isOverdue(t.due_date)).length;
  const dueToday = tasks.filter(t => isDueToday(t.due_date)).length;
  const taskList = tasks.slice(0, 10).map(t => '"' + t.title + '" (' + t.category + ', ' + t.priority + (t.due_date ? ', due ' + formatDate(t.due_date) : '') + ')').join('; ');
  const context = 'Today is ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '. Ryan has ' + tasks.length + ' open tasks. ' + (overdue > 0 ? overdue + ' are overdue. ' : '') + (dueToday > 0 ? dueToday + ' due today. ' : '') + 'Tasks: ' + taskList;

  try {
    const res = await fetch('/api/pa/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'You are Ryan\'s personal PA. Ryan is a commercial food photographer based in London and Somerset running his own limited company with clients including Lidl, Nando\'s, Ocado, and Ardbeg. The current year is 2026. Give a short direct morning briefing — 2-4 sentences max. Be blunt, no softening. Tell him what to do first and why. Connect tasks to real consequences. If his plate is clear, tell him to enjoy the day. Money tasks always come first. Never list everything — pick the 1-2 things that matter most.',
        messages: [{ role: 'user', content: 'Here is my task context:\n' + context + '\n\nGive me my morning briefing.' }]
      })
    });
    const data = await res.json();
    el.textContent = data.content[0].text;
  } catch (err) {
    el.textContent = tasks.length + ' tasks open. ' + (overdue > 0 ? overdue + ' overdue — start there.' : 'Nothing urgent.');
  }
}

function bindChat() {
  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
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

  try {
    const res = await fetch('/api/pa/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'You are Ryan\'s personal PA. Ryan is a commercial food photographer in London and Somerset with clients including Lidl, Nando\'s, Ocado, Ardbeg. Be direct and blunt — no softening, no hedging. Short sentences. One clear answer, not options. Connect advice to real consequences. Money and client emails always come first. He avoids sending estimates and following up with clients — call this out. He does admin late at night which hurts his sleep — push him to do it earlier. Creative work and gardening are legitimate productivity. When he asks if he can do something enjoyable, check his tasks and give a straight yes or no with one reason.\n\nHis open tasks:\n' + taskContext,
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

function appendMsg(who, text, isLoading = false) {
  const msgs = document.getElementById('chat-msgs');
  const div = document.createElement('div');
  div.className = 'msg msg-' + who;
  div.innerHTML = '<div class="msg-label">' + (who === 'pa' ? 'PA' : 'Ryan') + '</div><div class="msg-bubble' + (isLoading ? ' loading' : '') + '">' + text + '</div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div.querySelector('.msg-bubble');
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

function renderCalendarEvents(events) {
  const el = document.getElementById('sp-panel');
  if (!el) return;
  const today = new Date().toISOString().split('T')[0];
  const todayEvents = events.filter(e => e.start.split('T')[0] === today);
  const upcomingEvents = events.filter(e => e.start.split('T')[0] > today);
  
  let html = el.innerHTML; // keep existing shoot planner content
  
  if (todayEvents.length) {
    html += '<div class="section-lbl">Today calendar</div>';
    html += todayEvents.map(e => `
      <div class="task">
        <div class="check" style="border-color:#639922"></div>
        <div class="task-body">
          <div class="task-title">${e.title}</div>
          <div class="task-meta">
            <span class="tag tag-personal">calendar</span>
            ${!e.allDay && e.start.includes('T') ? '<span class="task-date">' + new Date(e.start).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) + '</span>' : ''}
          </div>
        </div>
      </div>`).join('');
  }

  if (upcomingEvents.length) {
    html += '<div class="section-lbl">Coming up</div>';
    html += upcomingEvents.slice(0, 5).map(e => {
      const d = new Date(e.start.split('T')[0] + 'T00:00:00');
      const label = d.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
      return `<div class="task">
        <div class="check" style="border-color:#999"></div>
        <div class="task-body">
          <div class="task-title">${e.title}</div>
          <div class="task-meta">
            <span class="tag tag-personal">calendar</span>
            <span class="task-date">${label}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  el.innerHTML = html;
}

async function loadShootPlanner() {
  try {
    const res = await fetch('/api/shoot-planner');
    const data = await res.json();
    renderShootPlannerPanel(data);
    const events = await loadCalendarEvents();
    renderCalendarEvents(events);
    generateBriefingWithContext(data, events);
    return data;
  } catch(e) {
    console.log('Shoot Planner unavailable', e);
    const events = await loadCalendarEvents();
    renderCalendarEvents(events);
    generateBriefingWithContext(null, events);
    return null;
  }
}

function renderShootPlannerPanel(data) {
  const el = document.getElementById('sp-panel');
  if (!el) return;
  let html = '';

  if (data.shoots && data.shoots.length) {
    html += '<div class="section-lbl">Upcoming shoots</div>';
    html += data.shoots.map(s => {
      const daysUntil = Math.ceil((new Date(s.startDate) - new Date()) / 86400000);
      const urgent = daysUntil <= 2;
      return `<div class="task">
        <div class="check ${urgent ? 'p1' : 'p2'}"></div>
        <div class="task-body">
          <div class="task-title">${s.name}</div>
          <div class="task-meta">
            <span class="tag tag-work">shoot</span>
            <span class="tag">${s.startDate}</span>
            <span class="task-date ${urgent ? 'overdue' : ''}">${daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : 'In ' + daysUntil + ' days'}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  if (data.quotes && data.quotes.length) {
    html += '<div class="section-lbl">Pending quotes</div>';
    html += data.quotes.map(q => {
      const daysOld = Math.floor((new Date() - new Date(q.createdAt)) / 86400000);
      const stale = daysOld >= 2;
      return `<div class="task">
        <div class="check ${stale ? 'p1' : 'p3'}"></div>
        <div class="task-body">
          <div class="task-title">${q.name} — ${q.clientName}</div>
          <div class="task-meta">
            <span class="tag tag-work">quote</span>
            <span class="task-date ${stale ? 'overdue' : ''}">${stale ? '⚠ ' : ''}${daysOld === 0 ? 'Created today' : daysOld + ' days old'}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  if (!html) html = '<div class="empty" style="padding:0.5rem 0;font-size:12px;">No upcoming shoots or pending quotes.</div>';
  el.innerHTML = html;
}

// Override generateBriefing to include shoot planner data
async function generateBriefingWithContext(spData, calEvents) {
  const el = document.getElementById('pa-note-text');
  const overdue = tasks.filter(t => isOverdue(t.due_date)).length;
  const dueToday = tasks.filter(t => isDueToday(t.due_date)).length;
  const taskList = tasks.slice(0, 10).map(t => '"' + t.title + '" (' + t.category + ', ' + t.priority + (t.due_date ? ', due ' + formatDate(t.due_date) : '') + ')').join('; ');

  let shootContext = '';
  const todayStr = new Date().toISOString().split('T')[0];
  if (calEvents && calEvents.length) {
    const todayCal = calEvents.filter(e => e.start.split('T')[0] === todayStr);
    if (todayCal.length) shootContext += 'CALENDAR TODAY: ' + todayCal.map(e => e.title + (e.allDay ? '' : ' at ' + new Date(e.start).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}))).join(', ') + '. ';
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

  const context = 'Today is ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '. ' + shootContext + 'Ryan has ' + tasks.length + ' open tasks. ' + (overdue > 0 ? overdue + ' are overdue. ' : '') + (dueToday > 0 ? dueToday + ' due today. ' : '') + 'Tasks: ' + taskList;

  try {
    const res = await fetch('/api/pa/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'You are Ryan\'s personal PA. Ryan is a commercial food photographer based in London and Somerset running his own limited company with clients including Lidl, Nando\'s, Ocado, and Ardbeg. The current year is 2026. Give a short direct morning briefing — 2-4 sentences max. Be blunt, no softening. Tell him what to do first and why. If he has a shoot today, lead with that. If quotes are stale, call it out. If his plate is clear, tell him to enjoy the day. Never list everything — pick the 1-2 things that matter most.',
        messages: [{ role: 'user', content: 'Here is my context:\n' + context + '\n\nGive me my morning briefing.' }]
      })
    });
    const data = await res.json();
    el.textContent = data.content[0].text;
  } catch (err) {
    el.textContent = shootContext || (tasks.length + ' tasks open.');
  }
}

const BLOCKED_DOMAINS = ['freeagent.com', 'google.com', 'calendar.google'];

function loadIframe(url, label, navEl) {
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  if (navEl) navEl.classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-iframe').classList.remove('hidden');
  document.getElementById('topbar-title').textContent = label;

  const blocked = BLOCKED_DOMAINS.some(d => url.includes(d));
  const iframe = document.getElementById('main-iframe');
  const blockedEl = document.getElementById('iframe-blocked');

  if (blocked) {
    iframe.style.display = 'none';
    iframe.src = '';
    document.getElementById('iframe-blocked-title').textContent = label + ' can\'t be embedded';
    document.getElementById('iframe-blocked-msg').textContent = 'This app blocks embedding for security reasons.';
    document.getElementById('iframe-open-link').href = url;
    blockedEl.classList.remove('hidden');
  } else {
    blockedEl.classList.add('hidden');
    iframe.style.display = 'block';
    iframe.src = url;
  }
}

function loadCalendar() {
  var c = document.getElementById('view-calendar');
  if (c && !c.querySelector('iframe')) {
    var f = document.createElement('iframe');
    f.src = 'https://calendar.google.com/calendar/embed?src=ryan%40ryanballphotography.com&src=c_a4281f75d282938d2163fbbe126730ede2babd78fcae29ee34d2556f6979cad9%40group.calendar.google.com&src=24b8634861e8a4fccb81c62ca9561c52956af0230a8c86ffe2c5f7775bd327ef%40group.calendar.google.com&src=0395cbfbffc800573fc2f3660fc1f019c221e4bedc8051cc6c0c297db9699797%40group.calendar.google.com&src=60877e1a8a8dfba08b542933bfa7f8faedd1d1528f2ada8e0ba91ba67c5074e3%40group.calendar.google.com&src=c_9126b3913ee9069ad38842fe8c2b8fd1ca0ca6a4689554039221089b73cf297b%40group.calendar.google.com&src=d4h4q6l360atpvv3mgj2d4p4lk6l7ggf%40import.calendar.google.com&src=tessa.palokkaran%40outlook.com&src=s22rdh1c5v23u9phjacqsess9incug50%40import.calendar.google.com&showTitle=0&showNav=1&showPrint=0&showTabs=1&showCalendars=1&showTz=0&mode=MONTH&ctz=Europe%2FLondon';
    f.style = 'border:0;width:100%;height:100%;display:block;';
    f.frameBorder = '0';
    c.appendChild(f);
  }
}

const today = new Date().toISOString().split('T')[0];
let tasks = [];
let chatHistory = [];

document.addEventListener('DOMContentLoaded', () => {
  setDate();
  loadTasks();
  loadShootPlanner();
  loadGmailProposals();
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
      if (view === 'calendar') showCalendarView();
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
      <i class="ti ti-pencil task-del" onclick="editTask(${t.id})" style="margin-right:2px;"></i>
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
  const due = document.getElementById('m-due').value;
  const editId = document.getElementById('modal-bg')._editId;
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
    renderShootPlannerPanel(data);
    const events = await loadCalendarEvents();
    generateBriefingWithContext(data, events);
    return data;
  } catch(e) {
    console.log('Shoot Planner unavailable', e);
    generateBriefingWithContext(null, []);
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

async function generateBriefingWithContext(spData, calEvents) {
  const el = document.getElementById('pa-note-text');
  const overdue = tasks.filter(t => isOverdue(t.due_date)).length;
  const dueToday = tasks.filter(t => isDueToday(t.due_date)).length;
  const taskList = tasks.slice(0, 10).map(t => '"' + t.title + '" (' + t.category + ', ' + t.priority + (t.due_date ? ', due ' + formatDate(t.due_date) : '') + ')').join('; ');

  let shootContext = '';
  if (calEvents && calEvents.length) {
    const todayCal = calEvents.filter(e => e.start.split('T')[0] === today);
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
        system: 'You are Ryan\'s personal PA. Ryan is a commercial food photographer based in London and Somerset running his own limited company with clients including Lidl, Nando\'s, Ocado, and Ardbeg. The current year is 2026. Give a short direct morning briefing — 2-4 sentences max. Be blunt, no softening. Tell him what to do first and why. IMPORTANT: If UPCOMING SHOOTS lists a shoot as today, he is on a shoot day — lead with that and treat it as the top priority regardless of anything else. If quotes are stale, call it out. If his plate is clear, tell him to enjoy the day. Never list everything — pick the 1-2 things that matter most.',
        messages: [{ role: 'user', content: 'Here is my context:\n' + context + '\n\nGive me my morning briefing.' }]
      })
    });
    const data = await res.json();
    el.textContent = data.content[0].text;
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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'You are Ryan\'s personal PA. Ryan is a commercial food photographer in London and Somerset with clients including Lidl, Nando\'s, Ocado, Ardbeg. Be direct and blunt — no softening, no hedging. Short sentences. One clear answer, not options. Connect advice to real consequences. Money and client emails always come first. He avoids sending estimates and following up with clients — call this out. He does admin late at night which hurts his sleep — push him to do it earlier. Creative work and gardening are legitimate productivity. When he asks if he can do something enjoyable, check his tasks and give a straight yes or no with one reason.\n\nHis open tasks:\n' + taskContext + '\n\nCalendar events (next 14 days):\n' + calendarContext,
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


async function loadGmailProposals() {
  const el = document.getElementById('gmail-proposals');
  if (!el) return;
  el.innerHTML = '<div class="empty" style="padding:0.5rem 0;font-size:12px;">Checking emails...</div>';
  try {
    const res = await fetch('/api/gmail-summary');
    const data = await res.json();
    if (!data.proposals || !data.proposals.length) {
      el.innerHTML = '<div class="empty" style="padding:0.5rem 0;font-size:12px;">No emails needing action.</div>';
      return;
    }
    let html = '<div class="section-lbl">Proposed from email <button onclick="loadGmailProposals()" style="font-size:10px;padding:1px 6px;border:0.5px solid var(--border2);border-radius:4px;background:transparent;cursor:pointer;margin-left:6px;">refresh</button></div>';
    data.proposals.forEach((p, i) => {
      html += `<div class="task" id="proposal-${i}">
        <div class="check ${p.priority || 'p3'}"></div>
        <div class="task-body">
          <div class="task-title">${p.suggestedTask}</div>
          <div class="task-meta">
            <span class="tag tag-work">email</span>
            <span class="tag">${p.from}</span>
            <span class="tag">${p.priority}</span>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px;">${p.action}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
          <button onclick="acceptProposal(${i})" style="font-size:11px;padding:2px 8px;border:0.5px solid var(--border2);border-radius:4px;background:var(--text);color:white;cursor:pointer;">Accept</button>
          <button onclick="skipProposal(${i})" style="font-size:11px;padding:2px 8px;border:0.5px solid var(--border2);border-radius:4px;background:transparent;cursor:pointer;">Skip</button>
        </div>
      </div>`;
    });
    el.innerHTML = html;
    el._proposals = data.proposals;
  } catch(e) {
    el.innerHTML = '<div class="empty" style="padding:0.5rem 0;font-size:12px;">Email check unavailable.</div>';
  }
}

function acceptProposal(i) {
  const el = document.getElementById('gmail-proposals');
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

function skipProposal(i) {
  const el = document.getElementById('proposal-' + i);
  if (el) el.remove();
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

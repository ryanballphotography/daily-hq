const today = new Date().toISOString().split('T')[0];
let tasks = [];
let chatHistory = [];

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  setDate();
  loadTasks();
  bindNav();
  bindModal();
  bindChat();
});

function setDate() {
  const d = new Date();
  document.getElementById('topbar-date').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

// --- Nav ---
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

// --- Tasks API ---
async function loadTasks() {
  const res = await fetch('/api/tasks');
  tasks = await res.json();
  updateBadge();
  renderToday();
  generateBriefing();
}

async function createTask(data) {
  const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const task = await res.json();
  tasks.unshift(task);
  updateBadge();
  renderToday();
  renderAll();
}

async function completeTask(id) {
  await fetch(`/api/tasks/${id}/complete`, { method: 'PATCH' });
  tasks = tasks.filter(t => t.id !== id);
  updateBadge();
  renderToday();
  renderAll();
}

async function deleteTask(id) {
  await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  tasks = tasks.filter(t => t.id !== id);
  updateBadge();
  renderToday();
  renderAll();
}

async function loadCompleted() {
  const res = await fetch('/api/tasks/completed');
  return res.json();
}

function updateBadge() {
  const badge = document.getElementById('task-badge');
  badge.textContent = tasks.length || '';
  badge.style.display = tasks.length ? 'inline' : 'none';
}

// --- Render ---
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
  const pclass = t.priority || '';
  const cat = t.category || 'work';
  return `
    <div class="task" id="task-${t.id}">
      <div class="check ${pclass}" onclick="completeTask(${t.id})"></div>
      <div class="task-body">
        <div class="task-title">${t.title}</div>
        <div class="task-meta">
          <span class="tag tag-${cat}">${cat}</span>
          ${t.tag ? `<span class="tag">${t.tag}</span>` : ''}
          ${t.due_date ? `<span class="task-date ${od ? 'overdue' : ''}">${od ? '⚠ ' : ''}${formatDate(t.due_date)}</span>` : ''}
          ${t.recurring ? `<span class="tag"><i class="ti ti-refresh"></i> ${t.recurring}</span>` : ''}
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
  if (overdue.length) html += `<div class="section-lbl">Overdue</div>` + overdue.map(taskHTML).join('');
  if (dueToday.length) html += `<div class="section-lbl">Due today</div>` + dueToday.map(taskHTML).join('');
  if (p1.length) html += `<div class="section-lbl">High priority</div>` + p1.map(taskHTML).join('');
  if (rest.length) html += `<div class="section-lbl">Up next</div>` + rest.map(taskHTML).join('');
  if (!html) html = `<div class="empty">Nothing on your plate. Add a task or enjoy the quiet.</div>`;
  el.innerHTML = html;
}

function renderAll() {
  const el = document.getElementById('all-tasks');
  if (!tasks.length) { el.innerHTML = `<div class="empty">No open tasks.</div>`; return; }
  el.innerHTML = tasks.map(taskHTML).join('');
}

async function renderCompleted() {
  const el = document.getElementById('completed-tasks');
  el.innerHTML = `<div class="empty">Loading...</div>`;
  const res = await fetch('/api/tasks/completed');
  const done = await res.json();
  if (!done.length) { el.innerHTML = `<div class="empty">Nothing completed yet.</div>`; return; }
  el.innerHTML = done.map(t => `
    <div class="task done">
      <div class="check checked"><i class="ti ti-check"></i></div>
      <div class="task-body">
        <div class="task-title">${t.title}</div>
        <div class="task-meta"><span class="tag tag-${t.category || 'work'}">${t.category || 'work'}</span></div>
      </div>
    </div>`).join('');
}

// --- Modal ---
function bindModal() {
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
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
  document.getElementById('modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('m-title').focus(), 50);
}

function closeModal() { document.getElementById('modal').classList.add('hidden'); }

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

// --- PA Briefing ---
async function generateBriefing() {
  const el = document.getElementById('pa-note-text');
  const overdue = tasks.filter(t => isOverdue(t.due_date)).length;
  const dueToday = tasks.filter(t => isDueToday(t.due_date)).length;
  const p1tasks = tasks.filter(t => t.priority === 'p1').map(t => t.title);
  const context = `
    Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}.
    Ryan has ${tasks.length} open tasks.
    ${overdue > 0 ? `${overdue} tasks are overdue.` : 'No overdue tasks.'}
    ${dueToday > 0 ? `${dueToday} tasks are due today.` : ''}
    ${p1tasks.length > 0 ? `High priority tasks: ${p1tasks.join(', ')}.` : ''}
    Open tasks: ${tasks.slice(0, 10).map(t => `"${t.title}" (${t.category}, ${t.priority}${t.due_date ? ', due ' + formatDate(t.due_date) : ''})`).join('; ')}.
  `;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are Ryan's personal PA. Ryan is a commercial food and drink photographer based in London and Somerset. He runs his own limited company.

Your job: give a short, direct morning briefing — 2-4 sentences max. Tell him what to focus on first and why. Be direct and blunt, no softening. Connect tasks to real consequences. If nothing is urgent, tell him to enjoy the day.

Rules:
- Money tasks (invoices, estimates) always come first
- Call out anything overdue directly
- If his plate is clear, give him permission to do something enjoyable
- Never list everything — pick the 1-2 things that matter most
- Speak like a trusted, straight-talking PA who knows his business`,
        messages: [{ role: 'user', content: `Here is Ryan's current task context:\n${context}\n\nGive him his morning briefing.` }]
      })
    });
    const data = await res.json();
    el.textContent = data.content[0].text;
  } catch (err) {
    el.textContent = `${tasks.length} tasks open. ${overdue > 0 ? `${overdue} overdue — start there.` : dueToday > 0 ? `${dueToday} due today.` : 'Nothing urgent — good day to get ahead.'}`;
  }
}

// --- Chat ---
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

  const taskContext = tasks.slice(0, 15).map(t => `- ${t.title} (${t.category}, ${t.priority}${t.due_date ? ', due ' + formatDate(t.due_date) : ''})`).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are Ryan's personal PA. Ryan is a commercial food and drink photographer based in London and Somerset running his own limited company with major clients including Lidl, Nando's, Ocado, and Ardbeg Whisky.

Personality: direct and blunt, no softening, no hedging. Short sentences. Give one clear answer, not a list of options. Connect advice to real consequences. If his work is clear, give him genuine permission to rest or do something enjoyable without guilt.

His current open tasks:
${taskContext}

Key rules:
- Money (invoices, estimates) always comes first
- He avoids following up with clients and sending estimates — call this out directly
- He tends to do admin late at night which hurts his sleep — push him to do it earlier
- Creative work, gardening, personal projects are legitimate productivity
- When he asks if he can do something enjoyable, check his tasks and give a straight yes or no with one reason`,
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
  div.className = `msg msg-${who}`;
  div.innerHTML = `<div class="msg-label">${who === 'pa' ? 'PA' : 'Ryan'}</div><div class="msg-bubble${isLoading ? ' loading' : ''}">${text}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div.querySelector('.msg-bubble');
}

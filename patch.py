import re

# ── app.js ────────────────────────────────────────────────────────────────────
# Replace everything from the MARKETING TAB comment to end of file

MARKETING_JS = r"""

// ══════════════════════════════════════════════════
// MARKETING TAB
// ══════════════════════════════════════════════════

let mktContacts   = [];
let mktCheckState = {};
let mktActiveTab  = 'targets';
const MKT_STORAGE_KEY = 'mkt_contacts_v1';
const MKT_CHECKS_KEY  = 'mkt_checks_v1';

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

// ── Storage ───────────────────────────────────────
function loadContacts() {
  try { mktContacts   = JSON.parse(localStorage.getItem(MKT_STORAGE_KEY)) || []; } catch(e) { mktContacts = []; }
  try { mktCheckState = JSON.parse(localStorage.getItem(MKT_CHECKS_KEY))  || {}; } catch(e) { mktCheckState = {}; }
  const bg = document.getElementById('contact-modal-bg');
  if (bg) {
    let md = false;
    bg.addEventListener('mousedown', e => { md = e.target === bg; });
    bg.addEventListener('mouseup',   e => { if (md && e.target === bg) closeContactModal(); md = false; });
  }
}
function saveContacts()   { localStorage.setItem(MKT_STORAGE_KEY, JSON.stringify(mktContacts)); }
function saveCheckState() { localStorage.setItem(MKT_CHECKS_KEY,  JSON.stringify(mktCheckState)); }

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
function switchMktTab(tab, btn) {
  mktActiveTab = tab;
  document.querySelectorAll('.mkt-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('mkt-kanban').classList.toggle('hidden', tab !== 'targets');
  document.getElementById('mkt-existing').classList.toggle('hidden', tab !== 'existing');
  if (tab === 'targets') renderMktKanban();
  else renderMktExisting();
}

// ── Main render ───────────────────────────────────
function renderMarketing() {
  renderMktKanban();
  renderMktChecklists();
  updateMktAccCounts();
}

// ── Kanban (new targets) ──────────────────────────
function renderMktKanban() {
  const el = document.getElementById('mkt-kanban');
  if (!el) return;
  const now = new Date();
  const targets = mktContacts.filter(c => (c.type || 'target') === 'target');

  el.innerHTML = STAGES.map(stage => {
    const contacts = targets.filter(c => (c.stage || 'new') === stage.id);
    const cards = contacts.length ? contacts.map(c => contactCard(c, now, true)).join('') : '<div class="mkt-col-empty">No contacts</div>';
    return '<div class="mkt-col mkt-col-' + stage.id + '">'
      + '<div class="mkt-col-header"><i class="ti ' + stage.icon + '" aria-hidden="true"></i><span>' + stage.label + '</span>'
      + (contacts.length ? '<span class="mkt-col-count">' + contacts.length + '</span>' : '')
      + '</div><div class="mkt-col-cards">' + cards + '</div></div>';
  }).join('');
}

// ── Existing clients list ─────────────────────────
function renderMktExisting() {
  const el = document.getElementById('mkt-existing');
  if (!el) return;
  const now = new Date();
  const existing = mktContacts.filter(c => c.type === 'existing');

  if (!existing.length) {
    el.innerHTML = '<div class="mkt-pipeline-empty">No existing clients yet. Add the people you\'ve already worked with.</div>';
    return;
  }

  // Sort: most overdue first
  const sorted = existing.map(c => {
    const last = c.lastTouchpoint ? new Date(c.lastTouchpoint) : null;
    const daysSince = last ? Math.floor((now - last) / 86400000) : 999;
    const daysUntil = last ? 90 - daysSince : null;
    return { ...c, daysUntil };
  }).sort((a, b) => {
    if (a.daysUntil === null) return 1;
    if (b.daysUntil === null) return -1;
    return a.daysUntil - b.daysUntil;
  });

  el.innerHTML = sorted.map(c => contactCard(c, now, false)).join('');
}

// ── Shared card renderer ──────────────────────────
function contactCard(c, now, isTarget) {
  const last = c.lastTouchpoint ? new Date(c.lastTouchpoint) : null;
  const daysSince = last ? Math.floor((now - last) / 86400000) : null;
  const daysUntil = daysSince !== null ? 90 - daysSince : null;
  const isOverdue = daysUntil !== null && daysUntil < 0;
  const isSoon    = daysUntil !== null && daysUntil >= 0 && daysUntil <= 14;

  let urgencyHtml = '';
  if (isOverdue)   urgencyHtml = '<span class="mkt-card-urgency mkt-urgency-over">&#9888; ' + Math.abs(daysUntil) + 'd overdue</span>';
  else if (isSoon) urgencyHtml = '<span class="mkt-card-urgency mkt-urgency-soon">' + daysUntil + 'd to next touch</span>';
  else if (daysUntil !== null) urgencyHtml = '<span class="mkt-card-urgency mkt-urgency-ok">' + daysUntil + 'd remaining</span>';
  else urgencyHtml = '<span class="mkt-card-urgency mkt-urgency-ok">No date set</span>';

  const roleLabel = c.role === 'artbuyer' ? 'Art buyer' : 'Creative';
  const canAdvance = isTarget && (c.stage || 'new') !== 'gosee';

  let actionHtml = '';
  if (isTarget && canAdvance) {
    actionHtml = '<button class="mkt-card-advance" onclick="advanceContact(\'' + c.id + '\')"><i class="ti ti-arrow-right"></i> ' + STAGE_NEXT[c.stage || 'new'] + '</button>';
  }
  if (!isTarget) {
    actionHtml = '<button class="mkt-card-advance" onclick="touchContact(\'' + c.id + '\')"><i class="ti ti-phone"></i> Log touchpoint</button>';
  }

  return '<div class="mkt-card' + (isOverdue ? ' mkt-card-overdue' : '') + '">'
    + '<div class="mkt-card-name">' + c.name + (c.agency ? ' <span class="mkt-card-agency-inline">' + c.agency + '</span>' : '') + '</div>'
    + '<div class="mkt-card-meta">'
    + (isTarget ? '<span class="mkt-role-badge mkt-role-' + (c.role || 'creative') + '">' + roleLabel + '</span>' : '<span class="mkt-role-badge mkt-role-existing">Existing client</span>')
    + urgencyHtml
    + '</div>'
    + (c.notes ? '<div class="mkt-card-notes">' + c.notes + '</div>' : '')
    + '<div class="mkt-card-actions">'
    + actionHtml
    + '<div style="display:flex;gap:4px;margin-left:auto;">'
    + '<button class="mkt-card-icon-btn" onclick="editContact(\'' + c.id + '\')" aria-label="Edit"><i class="ti ti-pencil"></i></button>'
    + '<button class="mkt-card-icon-btn" onclick="deleteContact(\'' + c.id + '\')" aria-label="Delete"><i class="ti ti-trash"></i></button>'
    + '</div></div></div>';
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
    return '<div class="mkt-check-group">'
      + '<div class="mkt-check-group-header"><i class="ti ' + group.icon + '" aria-hidden="true"></i>' + group.group + '</div>'
      + items + '</div>';
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

// ── Accordion ─────────────────────────────────────
function toggleMktAcc(id) {
  const body = document.getElementById('mkt-acc-body-' + id);
  const chev = document.getElementById('mkt-acc-chev-' + id);
  if (!body) return;
  body.classList.toggle('hidden');
  if (chev) chev.style.transform = body.classList.contains('hidden') ? '' : 'rotate(180deg)';
}

// ── Contact modal ─────────────────────────────────
function toggleContactType() {
  const type = document.getElementById('cm-type').value;
  const isExisting = type === 'existing';
  document.getElementById('cm-role-field').classList.toggle('hidden', isExisting);
  document.getElementById('cm-stage-row').classList.toggle('hidden', isExisting);
  document.getElementById('cm-existing-row').classList.toggle('hidden', !isExisting);
}

function openAddContact() {
  document.getElementById('contact-modal-title').textContent = 'Add contact';
  document.getElementById('cm-type').value       = 'target';
  document.getElementById('cm-name').value       = '';
  document.getElementById('cm-role').value       = 'creative';
  document.getElementById('cm-agency').value     = '';
  document.getElementById('cm-notes').value      = '';
  document.getElementById('cm-stage').value      = 'new';
  document.getElementById('cm-last-touch').value = '';
  document.getElementById('cm-last-contact').value = '';
  toggleContactType();
  document.getElementById('contact-modal-bg').classList.remove('hidden');
  document.getElementById('contact-modal-bg')._editId = null;
  setTimeout(() => document.getElementById('cm-name').focus(), 50);
}

function editContact(id) {
  const c = mktContacts.find(c => c.id === id);
  if (!c) return;
  document.getElementById('contact-modal-title').textContent = 'Edit contact';
  document.getElementById('cm-type').value       = c.type || 'target';
  document.getElementById('cm-name').value       = c.name || '';
  document.getElementById('cm-role').value       = c.role || 'creative';
  document.getElementById('cm-agency').value     = c.agency || '';
  document.getElementById('cm-notes').value      = c.notes || '';
  document.getElementById('cm-stage').value      = c.stage || 'new';
  document.getElementById('cm-last-touch').value = c.lastTouchpoint || '';
  document.getElementById('cm-last-contact').value = c.lastTouchpoint || '';
  toggleContactType();
  document.getElementById('contact-modal-bg').classList.remove('hidden');
  document.getElementById('contact-modal-bg')._editId = id;
  setTimeout(() => document.getElementById('cm-name').focus(), 50);
}

function closeContactModal() {
  document.getElementById('contact-modal-bg').classList.add('hidden');
}

function saveContact() {
  const name = document.getElementById('cm-name').value.trim();
  if (!name) { document.getElementById('cm-name').focus(); return; }
  const type = document.getElementById('cm-type').value;
  const isExisting = type === 'existing';
  const lastTouch = isExisting
    ? document.getElementById('cm-last-contact').value
    : document.getElementById('cm-last-touch').value;
  const data = {
    type,
    name,
    role:           isExisting ? null : document.getElementById('cm-role').value,
    agency:         document.getElementById('cm-agency').value.trim(),
    notes:          document.getElementById('cm-notes').value.trim(),
    stage:          isExisting ? null : document.getElementById('cm-stage').value,
    lastTouchpoint: lastTouch || null,
  };
  const editId = document.getElementById('contact-modal-bg')._editId;
  if (editId) {
    const idx = mktContacts.findIndex(c => c.id === editId);
    if (idx > -1) mktContacts[idx] = { ...mktContacts[idx], ...data };
  } else {
    mktContacts.push({ id: 'c' + Date.now(), ...data });
  }
  saveContacts();
  closeContactModal();
  if (isExisting) { switchMktTab('existing', null); }
  else            { renderMktKanban(); }
}

function deleteContact(id) {
  if (!confirm('Remove this contact?')) return;
  mktContacts = mktContacts.filter(c => c.id !== id);
  saveContacts();
  if (mktActiveTab === 'existing') renderMktExisting();
  else renderMktKanban();
}

function advanceContact(id) {
  const c = mktContacts.find(c => c.id === id);
  if (!c) return;
  const stageIds = STAGES.map(s => s.id);
  const idx = stageIds.indexOf(c.stage || 'new');
  if (idx < stageIds.length - 1) {
    c.stage = stageIds[idx + 1];
    c.lastTouchpoint = new Date().toISOString().split('T')[0];
    saveContacts();
    renderMktKanban();
  }
}

function touchContact(id) {
  const c = mktContacts.find(c => c.id === id);
  if (!c) return;
  c.lastTouchpoint = new Date().toISOString().split('T')[0];
  saveContacts();
  renderMktExisting();
}
"""

with open('public/app.js', 'r') as f:
    content = f.read()

# Find the marker and replace from there to end
marker = '\n// ══════════════════════════════════════════════════\n// MARKETING TAB'
idx = content.find(marker)
if idx != -1:
    content = content[:idx] + MARKETING_JS
    print('Replaced existing marketing JS')
else:
    content = content + MARKETING_JS
    print('Appended marketing JS (not found before)')

# Patch DOMContentLoaded if needed
if 'loadContacts();' not in content:
    content = content.replace(
        '  showInboxPrompt();\n  loadInboxCalendar();\n});',
        '  showInboxPrompt();\n  loadInboxCalendar();\n  loadContacts();\n});'
    )
    print('Patched DOMContentLoaded')

# Patch bindNav if needed
if "if (view === 'marketing') renderMarketing();" not in content:
    content = content.replace(
        "      if (view === 'shoots') renderShoots();",
        "      if (view === 'shoots') renderShoots();\n      if (view === 'marketing') renderMarketing();"
    )
    print('Patched bindNav')

with open('public/app.js', 'w') as f:
    f.write(content)
print('app.js done')


# ── index.html ────────────────────────────────────────────────────────────────
with open('public/index.html', 'r') as f:
    html = f.read()

# Add sidebar nav item if missing
if 'data-view="marketing"' not in html:
    html = html.replace(
        '      <div class="ni" data-view="shoots"><i class="ti ti-camera"></i> Shoots</div>\n      <div class="ni" data-view="weekly">',
        '      <div class="ni" data-view="shoots"><i class="ti ti-camera"></i> Shoots</div>\n      <div class="ni" data-view="marketing"><i class="ti ti-speakerphone"></i> Marketing</div>\n      <div class="ni" data-view="weekly">'
    )
    print('Added sidebar nav item')

# Replace or add marketing view
MARKETING_VIEW = '''
      <!-- Marketing view -->
      <div class="view hidden" id="view-marketing" style="padding:0;display:flex;flex-direction:column;height:calc(100vh - 49px);">
        <div class="mkt-pipeline-header">
          <div class="mkt-pipeline-title">
            <span>Client Pipeline</span>
            <span class="mkt-pipeline-sub">90-day cycle &middot; creatives before art buyers</span>
          </div>
          <button class="btn-add" onclick="openAddContact()" style="font-size:12px;padding:5px 12px;flex-shrink:0;"><i class="ti ti-plus"></i> Add contact</button>
        </div>
        <div class="mkt-tabs">
          <button class="mkt-tab active" onclick="switchMktTab('targets',this)"><i class="ti ti-user-plus"></i> New targets</button>
          <button class="mkt-tab" onclick="switchMktTab('existing',this)"><i class="ti ti-users"></i> Existing clients</button>
        </div>
        <div class="mkt-kanban" id="mkt-kanban"></div>
        <div class="mkt-existing hidden" id="mkt-existing" style="flex:1;overflow-y:auto;padding:1rem 1.25rem;"></div>
        <div class="mkt-lower">
          <div class="mkt-accordion">
            <div class="mkt-acc-header" onclick="toggleMktAcc('weekly')">
              <div class="mkt-acc-left"><i class="ti ti-calendar-week"></i><span>Monday checklist</span><span class="mkt-acc-count" id="mkt-week-count"></span></div>
              <i class="ti ti-chevron-down mkt-acc-chevron" id="mkt-acc-chev-weekly"></i>
            </div>
            <div class="mkt-acc-body hidden" id="mkt-acc-body-weekly"><div class="mkt-checklist" id="mkt-weekly-checks"></div></div>
          </div>
          <div class="mkt-accordion">
            <div class="mkt-acc-header" onclick="toggleMktAcc('monthly')">
              <div class="mkt-acc-left"><i class="ti ti-calendar-month"></i><span>Monthly checklist</span><span class="mkt-acc-count" id="mkt-month-count"></span></div>
              <i class="ti ti-chevron-down mkt-acc-chevron" id="mkt-acc-chev-monthly"></i>
            </div>
            <div class="mkt-acc-body hidden" id="mkt-acc-body-monthly"><div class="mkt-checklist" id="mkt-monthly-checks"></div></div>
          </div>
          <div class="mkt-accordion">
            <div class="mkt-acc-header" onclick="toggleMktAcc('rules')">
              <div class="mkt-acc-left"><i class="ti ti-info-circle"></i><span>Ground rules</span></div>
              <i class="ti ti-chevron-down mkt-acc-chevron" id="mkt-acc-chev-rules"></i>
            </div>
            <div class="mkt-acc-body hidden" id="mkt-acc-body-rules">
              <div class="mkt-rules">
                <div class="mkt-rule"><span class="mkt-rule-lbl">Sequence</span><span class="mkt-rule-val">Creative first &rarr; then art buyer. Never reverse.</span></div>
                <div class="mkt-rule"><span class="mkt-rule-lbl">Mailer floor</span><span class="mkt-rule-val">Every 90 days is the absolute minimum.</span></div>
                <div class="mkt-rule"><span class="mkt-rule-lbl">IG quality</span><span class="mkt-rule-val">Only post if it\'s strong. Never post below standard.</span></div>
                <div class="mkt-rule"><span class="mkt-rule-lbl">Email tone</span><span class="mkt-rule-val">No "do you have work for me". Cool. No CTA except website.</span></div>
                <div class="mkt-rule"><span class="mkt-rule-lbl">Signature</span><span class="mkt-rule-val">Phone + URL on every single email, no exceptions.</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>'''

if 'id="view-marketing"' in html:
    html = re.sub(r'<!-- Marketing view -->.*?</div>\s*(?=\n\s*</div>\s*\n\s*</div>)', MARKETING_VIEW.strip(), html, flags=re.DOTALL)
    print('Replaced existing marketing view')
else:
    html = html.replace('</div>\n\n  </div>', MARKETING_VIEW + '\n\n  </div>', 1)
    print('Added marketing view')

# Replace or add contact modal
CONTACT_MODAL = '''  <!-- Contact modal -->
  <div class="modal-bg hidden" id="contact-modal-bg">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title" id="contact-modal-title">Add contact</div>
        <div class="modal-actions">
          <button class="btn-cancel" onclick="closeContactModal()">Cancel</button>
          <button class="btn-save" onclick="saveContact()">Save</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="modal-field">
          <label>Type</label>
          <select id="cm-type" onchange="toggleContactType()">
            <option value="target">New target</option>
            <option value="existing">Existing client</option>
          </select>
        </div>
        <div class="modal-row">
          <div class="modal-field">
            <label>Name</label>
            <input type="text" id="cm-name" placeholder="Full name" />
          </div>
          <div class="modal-field" id="cm-role-field">
            <label>Role</label>
            <select id="cm-role">
              <option value="creative">Creative (AD/CD)</option>
              <option value="artbuyer">Art buyer / producer</option>
            </select>
          </div>
        </div>
        <div class="modal-field">
          <label>Company / Agency</label>
          <input type="text" id="cm-agency" placeholder="Agency, studio or brand name" />
        </div>
        <div class="modal-field">
          <label>Notes</label>
          <textarea id="cm-notes" placeholder="How you know them, style notes, anything useful..."></textarea>
        </div>
        <div class="modal-row" id="cm-stage-row">
          <div class="modal-field">
            <label>Stage</label>
            <select id="cm-stage">
              <option value="new">Not contacted</option>
              <option value="card">Card sent</option>
              <option value="email">Email sent</option>
              <option value="called">Called</option>
              <option value="gosee">Go-see booked</option>
            </select>
          </div>
          <div class="modal-field">
            <label>Last touchpoint</label>
            <input type="date" id="cm-last-touch" />
          </div>
        </div>
        <div class="modal-field hidden" id="cm-existing-row">
          <label>Last contact date</label>
          <input type="date" id="cm-last-contact" />
        </div>
      </div>
    </div>
  </div>'''

if 'id="contact-modal-bg"' in html:
    html = re.sub(r'  <!-- Contact modal -->.*?</div>\s*\n</body>', CONTACT_MODAL + '\n</body>', html, flags=re.DOTALL)
    print('Replaced existing contact modal')
else:
    html = html.replace('  <script src="app.js"></script>\n</body>', '  <script src="app.js"></script>\n\n' + CONTACT_MODAL + '\n</body>')
    print('Added contact modal')

# Add mobile more sheet item if missing
if "mobileNav('marketing'" not in html:
    html = html.replace(
        "mobileNav('shoots',null);toggleMoreSheet()\"><i class=\"ti ti-camera\"></i> Shoots</div>\n    <div class=\"mobile-more-item\" onclick=\"mobileNav('scheduled",
        "mobileNav('shoots',null);toggleMoreSheet()\"><i class=\"ti ti-camera\"></i> Shoots</div>\n    <div class=\"mobile-more-item\" onclick=\"mobileNav('marketing',null);toggleMoreSheet()\"><i class=\"ti ti-speakerphone\"></i> Marketing</div>\n    <div class=\"mobile-more-item\" onclick=\"mobileNav('scheduled"
    )
    print('Added mobile nav item')

with open('public/index.html', 'w') as f:
    f.write(html)
print('index.html done')


# ── style.css ─────────────────────────────────────────────────────────────────
MARKETING_CSS = """
/* MARKETING TAB */
.mkt-pipeline-header { display:flex; align-items:center; justify-content:space-between; padding:12px 1.25rem; border-bottom:0.5px solid var(--border); gap:12px; flex-shrink:0; }
.mkt-pipeline-title { display:flex; flex-direction:column; gap:2px; }
.mkt-pipeline-title span:first-child { font-size:14px; font-weight:500; color:var(--text); }
.mkt-pipeline-sub { font-size:11px; color:var(--text3); }

.mkt-tabs { display:flex; border-bottom:0.5px solid var(--border); flex-shrink:0; padding:0 1rem; gap:4px; }
.mkt-tab { font-size:13px; padding:8px 14px; border:none; background:none; cursor:pointer; color:var(--text2); border-bottom:2px solid transparent; margin-bottom:-1px; display:flex; align-items:center; gap:6px; }
.mkt-tab i { font-size:14px; }
.mkt-tab.active { color:var(--text); border-bottom-color:var(--text); font-weight:500; }
.mkt-tab:hover:not(.active) { color:var(--text); }

.mkt-kanban { display:flex; flex:1; overflow-x:auto; border-bottom:0.5px solid var(--border); min-height:0; }
.mkt-kanban::-webkit-scrollbar { height:4px; }
.mkt-kanban::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }

.mkt-col { min-width:190px; flex:1; display:flex; flex-direction:column; border-right:0.5px solid var(--border); }
.mkt-col:last-child { border-right:none; }
.mkt-col-new    { border-top:2px solid #888; }
.mkt-col-card   { border-top:2px solid #4A90D9; }
.mkt-col-email  { border-top:2px solid #3BAA72; }
.mkt-col-called { border-top:2px solid #E09A30; }
.mkt-col-gosee  { border-top:2px solid #8B6FD4; }
.mkt-col-header { display:flex; align-items:center; gap:7px; padding:9px 12px; font-size:12px; font-weight:500; border-bottom:0.5px solid var(--border); flex-shrink:0; color:var(--text2); }
.mkt-col-header i { font-size:14px; }
.mkt-col-count { margin-left:auto; font-size:11px; background:var(--bg3); color:var(--text3); padding:1px 6px; border-radius:20px; }
.mkt-col-cards { flex:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:7px; }
.mkt-col-empty { font-size:12px; color:var(--text3); text-align:center; padding:1.5rem 0.5rem; font-style:italic; }

.mkt-card { background:var(--bg2); border:0.5px solid var(--border); border-radius:var(--radius); padding:10px; }
.mkt-card.mkt-card-overdue { border-color:var(--p1); }
.mkt-card-name { font-weight:500; color:var(--text); font-size:13px; margin-bottom:1px; }
.mkt-card-agency-inline { font-weight:400; color:var(--text3); font-size:12px; }
.mkt-card-notes { font-size:11px; color:var(--text3); margin:5px 0; line-height:1.4; border-top:0.5px solid var(--border); padding-top:5px; }
.mkt-card-meta { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin:5px 0 8px; }
.mkt-card-urgency { font-size:10px; font-weight:500; padding:1px 6px; border-radius:20px; }
.mkt-urgency-over { background:#FCEBEB; color:var(--p1); }
.mkt-urgency-soon { background:#FEF7EC; color:var(--p2); }
.mkt-urgency-ok   { background:var(--bg3); color:var(--text3); }
[data-theme="dark"] .mkt-urgency-over { background:#3A0A0A; }
[data-theme="dark"] .mkt-urgency-soon { background:#2A1800; }
.mkt-role-badge { font-size:10px; padding:1px 6px; border-radius:20px; font-weight:500; }
.mkt-role-creative { background:#EEF5FF; color:#185FA5; border:0.5px solid #B8D2F5; }
.mkt-role-artbuyer { background:#F3EEFF; color:#5A30B0; border:0.5px solid #C9B5F0; }
.mkt-role-existing { background:#EDFAF3; color:#1B6B43; border:0.5px solid #A8DDBE; }
[data-theme="dark"] .mkt-role-creative { background:#0C2A4A; color:#7BB8F0; border-color:#1A4A7A; }
[data-theme="dark"] .mkt-role-artbuyer { background:#1A1040; color:#9A90E0; border-color:#2A1A60; }
[data-theme="dark"] .mkt-role-existing { background:#0A2A18; color:#6AAD8A; border-color:#1A4A30; }
.mkt-card-actions { display:flex; align-items:center; gap:5px; padding-top:8px; border-top:0.5px solid var(--border); }
.mkt-card-advance { font-size:11px; padding:3px 8px; border:0.5px solid var(--border2); border-radius:var(--radius); background:var(--text); color:var(--bg); cursor:pointer; display:flex; align-items:center; gap:4px; white-space:nowrap; }
.mkt-card-advance:hover { opacity:0.85; }
.mkt-card-advance i { font-size:11px; }
.mkt-card-icon-btn { width:24px; height:24px; border:0.5px solid var(--border2); border-radius:var(--radius); background:none; cursor:pointer; color:var(--text3); display:flex; align-items:center; justify-content:center; font-size:12px; }
.mkt-card-icon-btn:hover { background:var(--bg3); color:var(--text); }

.mkt-pipeline-empty { font-size:13px; color:var(--text3); padding:2rem 1.25rem; text-align:center; }

.mkt-lower { flex-shrink:0; border-top:0.5px solid var(--border); }
.mkt-accordion { border-bottom:0.5px solid var(--border); }
.mkt-accordion:last-child { border-bottom:none; }
.mkt-acc-header { display:flex; align-items:center; justify-content:space-between; padding:10px 1.25rem; cursor:pointer; user-select:none; }
.mkt-acc-header:hover { background:var(--bg2); }
.mkt-acc-left { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; color:var(--text); }
.mkt-acc-left i { font-size:15px; color:var(--text3); }
.mkt-acc-count { font-size:11px; color:var(--text3); font-weight:400; background:var(--bg3); padding:1px 7px; border-radius:20px; }
.mkt-acc-chevron { font-size:14px; color:var(--text3); transition:transform 0.2s; }
.mkt-acc-body { padding:1rem 1.25rem; background:var(--bg2); }
.mkt-checklist { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); gap:8px; }
.mkt-check-group { border:0.5px solid var(--border); border-radius:var(--radius); background:var(--bg); overflow:hidden; }
.mkt-check-group-header { display:flex; align-items:center; gap:8px; padding:8px 12px; font-size:12px; font-weight:500; color:var(--text); border-bottom:0.5px solid var(--border); }
.mkt-check-group-header i { font-size:14px; color:var(--text3); }
.mkt-check-item { display:flex; align-items:flex-start; gap:10px; padding:7px 12px; border-bottom:0.5px solid var(--border); cursor:pointer; }
.mkt-check-item:last-child { border-bottom:none; }
.mkt-check-item:hover { background:var(--bg2); }
.mkt-check-item.mkt-done .mkt-check-label { text-decoration:line-through; color:var(--text3); }
.mkt-check-box { width:15px; height:15px; border-radius:4px; border:1.5px solid var(--border2); flex-shrink:0; margin-top:2px; display:flex; align-items:center; justify-content:center; font-size:10px; transition:all 0.15s; }
.mkt-check-item.mkt-done .mkt-check-box { background:var(--text); border-color:var(--text); color:var(--bg); }
.mkt-check-label { font-size:12px; color:var(--text); line-height:1.4; }
.mkt-rules { display:flex; flex-direction:column; border:0.5px solid var(--border); border-radius:var(--radius); overflow:hidden; background:var(--bg); }
.mkt-rule { display:flex; gap:12px; padding:8px 12px; border-bottom:0.5px solid var(--border); font-size:12px; }
.mkt-rule:last-child { border-bottom:none; }
.mkt-rule-lbl { font-weight:500; color:var(--text); min-width:95px; flex-shrink:0; }
.mkt-rule-val { color:var(--text2); line-height:1.5; }

@media (max-width:700px) {
  .mkt-kanban { min-height:260px; }
  .mkt-col { min-width:155px; }
  .mkt-checklist { grid-template-columns:1fr; }
}
"""

with open('public/style.css', 'r') as f:
    css = f.read()

if '/* MARKETING TAB */' in css:
    css = re.sub(r'/\* MARKETING TAB \*/.*', MARKETING_CSS.strip(), css, flags=re.DOTALL)
    print('Replaced existing marketing CSS')
else:
    css = css + MARKETING_CSS
    print('Appended marketing CSS')

with open('public/style.css', 'w') as f:
    f.write(css)
print('style.css done')
print('\nAll done. Run: git add . && git commit -m "Marketing — two-mode pipeline" && git push')

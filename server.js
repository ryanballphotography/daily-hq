require('dotenv').config();
const fetch = require('node-fetch');
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json());
app.use(cookieParser());

// ── Auth middleware ───────────────────────────────
async function checkAuth(req, res, next) {
  // Allow API calls through with their own auth
  if (req.path.startsWith('/api/')) return next();
  // Check sp_token cookie against shared sessions table
  const token = req.cookies['sp_token'];
  if (!token) return res.redirect('https://shoot-planner.ryanballphotography.com/login');
  try {
    const result = await pool.query(
      "SELECT * FROM sessions WHERE token = $1 AND expires_at > NOW()",
      [token]
    );
    if (!result.rows.length) return res.redirect('https://shoot-planner.ryanballphotography.com/login');
    next();
  } catch(e) {
    // If sessions table doesn't exist yet, allow through
    console.log('Auth check error:', e.message);
    next();
  }
}

app.use(checkAuth);
app.use(express.static(path.join(__dirname, 'public')));

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      due_date DATE,
      priority VARCHAR(4),
      category VARCHAR(20) DEFAULT 'work',
      tag VARCHAR(50),
      recurring VARCHAR(20),
      done BOOLEAN DEFAULT false,
      completed_at TIMESTAMP,
      snoozed_until DATE,
      source VARCHAR(50) DEFAULT 'manual',
      time_block VARCHAR(20) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Add time_block column if it doesn't exist (for existing DBs)
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_block VARCHAR(20) DEFAULT NULL`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`);
  await pool.query(`CREATE TABLE IF NOT EXISTS shoot_tasks (
    id SERIAL PRIMARY KEY,
    shoot_id VARCHAR(100) NOT NULL,
    shoot_name TEXT,
    title TEXT NOT NULL,
    done BOOLEAN DEFAULT false,
    completed_at TIMESTAMP,
    due_date DATE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS marketing_contacts (
    id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(20) DEFAULT 'target',
    name TEXT NOT NULL,
    role VARCHAR(50),
    agency TEXT,
    org_type VARCHAR(50),
    crm_id VARCHAR(100),
    notes TEXT,
    stage VARCHAR(20) DEFAULT 'new',
    last_touchpoint DATE,
    last_touch_type VARCHAR(20),
    influence VARCHAR(20) DEFAULT 'key',
    from_crm BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS marketing_content (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL,
    note TEXT,
    planned_date DATE,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE marketing_contacts ADD COLUMN IF NOT EXISTS last_touch_type VARCHAR(20)`);
  console.log('DB ready');
}

app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM tasks 
      WHERE done = false 
      AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_DATE)
      ORDER BY 
        CASE priority WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 WHEN 'p3' THEN 3 ELSE 4 END,
        due_date ASC NULLS LAST,
        created_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  const { title, notes, due_date, priority, category, tag, recurring } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, notes, due_date, priority, category, tag, recurring)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, notes, due_date || null, priority || 'p3', category || 'work', tag || null, recurring || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  try {
    const result = await pool.query(
      `UPDATE tasks SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/tasks/:id/complete', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE tasks SET done = true, completed_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    const task = result.rows[0];
    if (task.recurring && task.due_date) {
      const next = new Date(task.due_date);
      if (task.recurring === 'daily') next.setDate(next.getDate() + 1);
      if (task.recurring === 'weekly') next.setDate(next.getDate() + 7);
      if (task.recurring === 'monthly') next.setMonth(next.getMonth() + 1);
      await pool.query(
        `INSERT INTO tasks (title, notes, due_date, priority, category, tag, recurring, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [task.title, task.notes, next.toISOString().split('T')[0], task.priority, task.category, task.tag, task.recurring, task.source]
      );
    }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/completed", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tasks WHERE done = true ORDER BY completed_at DESC LIMIT 50");
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/pa/briefing", async (req, res) => {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (data.quotes) data.quotes = data.quotes.filter(q => q.name && q.name.trim() && q.name !== "New Quote" && q.clientName && q.clientName.trim());
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/pa/chat", async (req, res) => {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (data.quotes) data.quotes = data.quotes.filter(q => q.name && q.name.trim() && q.name !== "New Quote" && q.clientName && q.clientName.trim());
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.get("/api/calendar", async (req, res) => {
  try {
    const response = await fetch("https://shoot-planner.ryanballphotography.com/api/calendar-events", {
      headers: { "x-api-key": process.env.DAILY_HQ_SECRET }
    });
    const data = await response.json();
    res.json(data);
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.get("/api/shoot-planner", async (req, res) => {
  try {
    const response = await fetch("https://shoot-planner.ryanballphotography.com/api/daily-hq-summary", {
      headers: { "x-api-key": process.env.DAILY_HQ_SECRET }
    });
    const data = await response.json();
    if (data.quotes) data.quotes = data.quotes.filter(q => q.name && q.name.trim() && q.name !== "New Quote" && q.clientName && q.clientName.trim());
    res.json(data);
  } catch(err) { res.status(500).json({error: err.message}); }
});


app.get("/api/gmail-summary", async (req, res) => {
  try {
    const taskRes = await pool.query("SELECT title FROM tasks WHERE done = false");
    const taskTitles = taskRes.rows.map(r => r.title).join('||');
    const reset = req.query.reset ? "&reset=1" : "";
    const url = "https://shoot-planner.ryanballphotography.com/api/gmail-summary?tasks=" + encodeURIComponent(taskTitles) + reset;
    const response = await fetch(url, {
      headers: { "x-api-key": process.env.DAILY_HQ_SECRET }
    });
    const data = await response.json();
    res.json(data);
  } catch(err) { res.status(500).json({error: err.message}); }
});



app.post("/api/gmail-skip", async (req, res) => {
  try {
    const response = await fetch("https://shoot-planner.ryanballphotography.com/api/gmail-skip", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.DAILY_HQ_SECRET },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch(err) { res.status(500).json({error: err.message}); }
});


app.patch("/api/tasks/:id/timeblock", async (req, res) => {
  const { time_block } = req.body;
  try {
    const result = await pool.query(
      'UPDATE tasks SET time_block = $1 WHERE id = $2 RETURNING *',
      [time_block || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({error: err.message}); }
});


app.post("/api/tasks/reorder", async (req, res) => {
  const { taskId, targetTaskId, date, block } = req.body;
  try {
    // Get all tasks in this block
    const result = await pool.query(
      'SELECT id, sort_order FROM tasks WHERE due_date::date = $1 AND time_block = $2 AND done = false ORDER BY sort_order ASC, id ASC',
      [date, block]
    );
    let ids = result.rows.map(r => r.id);
    // Move taskId to position of targetTaskId
    ids = ids.filter(id => id !== taskId);
    const targetIdx = ids.indexOf(targetTaskId);
    if (targetIdx === -1) {
      ids.push(taskId);
    } else {
      ids.splice(targetIdx, 0, taskId);
    }
    // Update sort_order for all
    for (let i = 0; i < ids.length; i++) {
      await pool.query('UPDATE tasks SET sort_order = $1 WHERE id = $2', [i, ids[i]]);
    }
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});


const DEFAULT_SHOOT_TASKS = [
  'Pencil Studio',
  'Pencil Stylists',
  'Pencil Assistant',
  'Confirm shoot dates with client',
  'Receive brief / PPM notes',
  'Write shot list',
  'Props sourced',
  'Products received',
  'Confirm Studio, Stylists and Assistants',
  'Deliver Brief to Stylists',
  'Images backed up',
  'Retouch Images',
  'Client approval on selects',
  'Deliver Images',
  'Purchase Order received',
  'Invoice Client'
];

app.get("/api/shoot-tasks/:shootId", async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM shoot_tasks WHERE shoot_id = $1 ORDER BY sort_order ASC, id ASC',
      [req.params.shootId]
    );
    res.json(result.rows);
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.post("/api/shoot-tasks/:shootId/generate", async (req, res) => {
  const { shootName } = req.body;
  try {
    // Check if tasks already exist
    const existing = await pool.query('SELECT id FROM shoot_tasks WHERE shoot_id = $1', [req.params.shootId]);
    if (existing.rows.length > 0) return res.json({ skipped: true, message: 'Tasks already exist' });
    // Insert default tasks
    for (let i = 0; i < DEFAULT_SHOOT_TASKS.length; i++) {
      await pool.query(
        'INSERT INTO shoot_tasks (shoot_id, shoot_name, title, sort_order) VALUES ($1, $2, $3, $4)',
        [req.params.shootId, shootName, DEFAULT_SHOOT_TASKS[i], i]
      );
    }
    const result = await pool.query('SELECT * FROM shoot_tasks WHERE shoot_id = $1 ORDER BY sort_order ASC', [req.params.shootId]);
    res.json(result.rows);
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.patch("/api/shoot-tasks/:id/complete", async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE shoot_tasks SET done = NOT done, completed_at = CASE WHEN done THEN NULL ELSE NOW() END WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.patch("/api/shoot-tasks/:id", async (req, res) => {
  const { due_date } = req.body;
  try {
    const result = await pool.query(
      'UPDATE shoot_tasks SET due_date = $1 WHERE id = $2 RETURNING *',
      [due_date || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({error: err.message}); }
});

app.get("/api/shoot-tasks-today", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM shoot_tasks WHERE done = false AND due_date = CURRENT_DATE ORDER BY sort_order ASC"
    );
    res.json(result.rows);
  } catch(err) { res.status(500).json({error: err.message}); }
});

// ── CRM contacts from shoot planner shared DB ─────────────────────────────────
app.get("/api/crm-contacts", async (req, res) => {
  try {
    const response = await fetch("https://shoot-planner.ryanballphotography.com/api/crm-summary", {
      headers: { "x-api-key": process.env.DAILY_HQ_SECRET }
    });
    const data = await response.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Marketing contacts ────────────────────────────────────────────────────────
app.get("/api/marketing-contacts", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM marketing_contacts ORDER BY created_at ASC");
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/marketing-contacts", async (req, res) => {
  const { id, type, name, role, agency, org_type, crm_id, notes, stage, last_touchpoint, influence, from_crm } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO marketing_contacts (id, type, name, role, agency, org_type, crm_id, notes, stage, last_touchpoint, last_touch_type, influence, from_crm)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         type=EXCLUDED.type, name=EXCLUDED.name, role=EXCLUDED.role,
         agency=EXCLUDED.agency, org_type=EXCLUDED.org_type, notes=EXCLUDED.notes,
         stage=EXCLUDED.stage, last_touchpoint=EXCLUDED.last_touchpoint,
         influence=EXCLUDED.influence, from_crm=EXCLUDED.from_crm
       RETURNING *`,
      [id, type||'target', name, role||null, agency||null, org_type||null, crm_id||null, notes||null, stage||'new', last_touchpoint||null, req.body.last_touch_type||null, influence||'key', from_crm||false]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/marketing-contacts/:id", async (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  try {
    const result = await pool.query(
      `UPDATE marketing_contacts SET ${setClause}, updated_at=NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/marketing-contacts/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM marketing_contacts WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Marketing content (feed posts + mailers) ─────────────────────────────────
app.get("/api/marketing-content", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM marketing_content ORDER BY created_at DESC");
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/marketing-content", async (req, res) => {
  const { type, note, planned_date } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO marketing_content (type, note, planned_date)
       VALUES ($1,$2,$3) RETURNING *`,
      [type, note || null, planned_date || null]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/marketing-content/:id", async (req, res) => {
  const { note, planned_date, sent_at } = req.body;
  try {
    const result = await pool.query(
      `UPDATE marketing_content SET note=$1, planned_date=$2, sent_at=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
      [note || null, planned_date || null, sent_at || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
initDB().then(() => app.listen(PORT, () => console.log(`Daily HQ running on ${PORT}`)));
// temp debug

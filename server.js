require('dotenv').config();
const fetch = require('node-fetch');
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json());
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

const PORT = process.env.PORT || 3000;
initDB().then(() => app.listen(PORT, () => console.log(`Daily HQ running on ${PORT}`)));
// temp debug

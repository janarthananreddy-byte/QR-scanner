const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();

// Supabase PostgreSQL connection (env vars injected by Vercel integration)
const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  ssl: { rejectUnauthorized: false },
  max: 1 // keep connections low for serverless
});

// Create table on startup
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      cyclist_code TEXT NOT NULL,
      scanned_at TEXT NOT NULL,
      pit_stop TEXT DEFAULT 'CP1',
      scanner_name TEXT DEFAULT ''
    )
  `);
  console.log('DB ready');
}
initDB().catch(err => console.error('DB init error:', err.message));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// POST /api/scan
app.post('/api/scan', async (req, res) => {
  const { cyclist_code, pit_stop, scanner_name } = req.body;
  if (!cyclist_code) return res.status(400).json({ error: 'Missing cyclist_code' });
  const code = cyclist_code.trim().toUpperCase();
  if (!/^CC\d+$/.test(code)) {
    return res.status(400).json({ error: 'Invalid code "' + code + '". Expected CC followed by digits' });
  }
  const cp = pit_stop || 'CP1';
  try {
    const dup = await pool.query(
      'SELECT id FROM scans WHERE cyclist_code = $1 AND pit_stop = $2',
      [code, cp]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Rider ' + code + ' already scanned at ' + cp });
    }
    const scanned_at = new Date().toISOString();
    const result = await pool.query(
      'INSERT INTO scans (cyclist_code, scanned_at, pit_stop, scanner_name) VALUES ($1, $2, $3, $4) RETURNING *',
      [code, scanned_at, cp, scanner_name || '']
    );
    res.json(result.rows[0]);
  } catch(e) {
    console.error('/api/scan error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/scans
app.get('/api/scans', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM scans ORDER BY id DESC');
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  try {
    const [byPitStop, byScanner, totalRes] = await Promise.all([
      pool.query('SELECT pit_stop, COUNT(*)::int AS count FROM scans GROUP BY pit_stop ORDER BY pit_stop'),
      pool.query(`SELECT pit_stop,
        COALESCE(NULLIF(scanner_name,''), '(unnamed)') AS scanner_name,
        COUNT(*)::int AS count
        FROM scans GROUP BY pit_stop, scanner_name ORDER BY pit_stop, count DESC`),
      pool.query('SELECT COUNT(*)::int AS count FROM scans')
    ]);
    res.json({
      byPitStop: byPitStop.rows,
      byScanner: byScanner.rows,
      total: totalRes.rows[0].count
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/scan/:id (admin, no UI button)
app.delete('/api/scan/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM scans WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/export/csv
app.get('/api/export/csv', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM scans ORDER BY id');
    const lines = ['id,cyclist_code,scanned_at,pit_stop,scanner_name',
      ...rows.map(s => [s.id, s.cyclist_code, s.scanned_at, s.pit_stop, s.scanner_name || ''].join(','))];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="scans.csv"');
    res.send(lines.join('\n'));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/export/xlsx
app.get('/api/export/xlsx', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM scans ORDER BY id');
    const lines = ['id,cyclist_code,scanned_at,pit_stop,scanner_name',
      ...rows.map(s => [s.id, s.cyclist_code, s.scanned_at, s.pit_stop, s.scanner_name || ''].join(','))];
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', 'attachment; filename="scans.csv"');
    res.send(lines.join('\n'));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server on port ' + PORT));
module.exports = app;

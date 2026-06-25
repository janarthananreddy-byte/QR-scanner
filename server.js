const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/tmp/scans.db'
  : path.join(__dirname, 'scans.db');
const db = new Database(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cyclist_code TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  pit_stop TEXT DEFAULT 'CP1',
  scanner_name TEXT DEFAULT ''
)`);
try { db.exec("ALTER TABLE scans ADD COLUMN scanner_name TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE scans ADD COLUMN pit_stop TEXT DEFAULT 'CP1'"); } catch(e) {}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// POST /api/scan
app.post('/api/scan', (req, res) => {
  const { cyclist_code, pit_stop, scanner_name } = req.body;
  if (!cyclist_code) return res.status(400).json({ error: 'Missing cyclist_code' });
  const code = cyclist_code.trim().toUpperCase();
  if (!/^CC\d+$/.test(code)) {
    return res.status(400).json({ error: 'Invalid code "' + code + '". Expected CC followed by digits' });
  }
  const cp = pit_stop || 'CP1';
  const existing = db.prepare('SELECT id FROM scans WHERE cyclist_code = ? AND pit_stop = ?').get(code, cp);
  if (existing) {
    return res.status(409).json({ error: 'Rider ' + code + ' already scanned at ' + cp });
  }
  const scanned_at = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO scans (cyclist_code, scanned_at, pit_stop, scanner_name) VALUES (?, ?, ?, ?)'
  ).run(code, scanned_at, cp, scanner_name || '');
  res.json({ id: info.lastInsertRowid, cyclist_code: code, scanned_at, pit_stop: cp, scanner_name: scanner_name || '' });
});

// GET /api/scans
app.get('/api/scans', (req, res) => {
  res.json(db.prepare('SELECT * FROM scans ORDER BY id DESC').all());
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  const byPitStop = db.prepare('SELECT pit_stop, COUNT(*) as count FROM scans GROUP BY pit_stop').all();
  const total = db.prepare('SELECT COUNT(*) as count FROM scans').get().count;
  res.json({ byPitStop, total });
});

// DELETE /api/scan/:id
app.delete('/api/scan/:id', (req, res) => {
  db.prepare('DELETE FROM scans WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/export/csv
app.get('/api/export/csv', (req, res) => {
  const scans = db.prepare('SELECT * FROM scans ORDER BY id').all();
  const lines = ['id,cyclist_code,scanned_at,pit_stop,scanner_name',
    ...scans.map(s => [s.id, s.cyclist_code, s.scanned_at, s.pit_stop, s.scanner_name || ''].join(','))];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="scans.csv"');
  res.send(lines.join('\n'));
});

// GET /api/export/xlsx (CSV with xlsx mime for Excel open)
app.get('/api/export/xlsx', (req, res) => {
  const scans = db.prepare('SELECT * FROM scans ORDER BY id').all();
  const lines = ['id,cyclist_code,scanned_at,pit_stop,scanner_name',
    ...scans.map(s => [s.id, s.cyclist_code, s.scanned_at, s.pit_stop, s.scanner_name || ''].join(','))];
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', 'attachment; filename="scans.csv"');
  res.send(lines.join('\n'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server on port ' + PORT));
module.exports = app;

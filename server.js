const express = require('express');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/tmp/scans.db'
  : path.join(__dirname, 'scans.db');
const db = new Database(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cyclist_code TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  pit_stop TEXT DEFAULT 'CP1',
  scanner_name TEXT DEFAULT ''
)
`);

try { db.exec("ALTER TABLE scans ADD COLUMN scanner_name TEXT DEFAULT ''"); } catch(e) {}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.post('/api/scan', (req, res) => {
  try {
    const { cyclist_code, pit_stop, scanner_name } = req.body;
    if (!cyclist_code) return res.status(400).json({ error: 'cyclist_code is required' });
    const code = cyclist_code.trim().toUpperCase();
    if (!/^CC\d+$/.test(code)) {
      return res.status(400).json({ error: `Invalid code "${code}". Expected format: CC followed by digits` });
    }
    // Duplicate = same rider at same checkpoint
    const existing = db.prepare('SELECT id FROM scans WHERE cyclist_code = ? AND pit_stop = ?').get(code, pit_stop || 'CP1');
    if (existing) {
      return res.status(409).json({ error: `Rider ${code} already scanned at ${pit_stop || 'CP1'}` });
    }
    const scanned_at = new Date().toISOString();
    const info = db.prepare(
      'INSERT INTO scans (cyclist_code, scanned_at, pit_stop, scanner_name) VALUES (?, ?, ?, ?)'
    ).run(code, scanned_at, pit_stop || 'CP1', scanner_name || '');
    res.json({ id: info.lastInsertRowid, cyclist_code: code, scanned_at, pit_stop: pit_stop || 'CP1', scanner_name: scanner_name || '' });
  } catch (err) {
    console.error('Error saving scan:', err.message);
    res.status(500).json({ error: 'Failed to save scan: ' + err.message });
  }
});

app.get('/api/scans', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM scans ORDER BY id DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/scan/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM scans WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/csv', (req, res) => {
  const rows = db.prepare('SELECT id, cyclist_code, scanned_at, pit_stop, scanner_name FROM scans ORDER BY id').all();
  const header = 'ID,Cyclist Code,Scanned At,Pit Stop,Scanner Name\n';
  const body = rows.map(r => `${r.id},${r.cyclist_code},${r.scanned_at},${r.pit_stop},${r.scanner_name}`).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="pit_stop_scans.csv"');
  res.send(header + body);
});

app.get('/api/export/xlsx', (req, res) => {
  const rows = db.prepare('SELECT id, cyclist_code, scanned_at, pit_stop, scanner_name FROM scans ORDER BY id').all();
  const data = [
    ['ID', 'Cyclist Code', 'Scanned At', 'Pit Stop', 'Scanner Name'],
    ...rows.map(r => [r.id, r.cyclist_code, r.scanned_at, r.pit_stop, r.scanner_name])
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 24 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Pit Stop Scans');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="pit_stop_scans.xlsx"');
  res.send(buf);
});

app.listen(PORT, () => console.log(`QR Scanner running on http://localhost:${PORT}`));

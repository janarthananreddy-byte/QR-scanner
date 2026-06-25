const express = require('express');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Init DB - use /tmp for writable path on Vercel serverless
const DB_PATH = process.env.NODE_ENV === 'production' ? '/tmp/scans.db' : 'scans.db';
const db = new Database(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS scans (
id INTEGER PRIMARY KEY AUTOINCREMENT,
cyclist_code TEXT NOT NULL,
scanned_at TEXT NOT NULL,
pit_stop TEXT DEFAULT 'Main'
)
`);

app.use(express.json());
// Serve from public/ first, then root (for index.html)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Save a scan
app.post('/api/scan', (req, res) => {
const { cyclist_code, pit_stop } = req.body;
if (!cyclist_code || !/^CC\d{8}$/i.test(cyclist_code.trim())) {
return res.status(400).json({ error: 'Invalid cyclist code. Expected format: CCXXXXXXXX' });
}
const scanned_at = new Date().toISOString();
const stmt = db.prepare('INSERT INTO scans (cyclist_code, scanned_at, pit_stop) VALUES (?, ?, ?)');
const info = stmt.run(cyclist_code.trim().toUpperCase(), scanned_at, pit_stop || 'Main');
res.json({ id: info.lastInsertRowid, cyclist_code: cyclist_code.trim().toUpperCase(), scanned_at, pit_stop: pit_stop || 'Main' });
});

// Get all scans (newest first)
app.get('/api/scans', (req, res) => {
const rows = db.prepare('SELECT * FROM scans ORDER BY id DESC').all();
res.json(rows);
});

// Delete a scan
app.delete('/api/scan/:id', (req, res) => {
db.prepare('DELETE FROM scans WHERE id = ?').run(req.params.id);
res.json({ ok: true });
});

// Export CSV
app.get('/api/export/csv', (req, res) => {
const rows = db.prepare('SELECT id, cyclist_code, scanned_at, pit_stop FROM scans ORDER BY id').all();
const header = 'ID,Cyclist Code,Scanned At,Pit Stop\n';
const body = rows.map(r => `${r.id},${r.cyclist_code},${r.scanned_at},${r.pit_stop}`).join('\n');
res.setHeader('Content-Type', 'text/csv');
res.setHeader('Content-Disposition', 'attachment; filename="pit_stop_scans.csv"');
res.send(header + body);
});

// Export XLSX
app.get('/api/export/xlsx', (req, res) => {
const rows = db.prepare('SELECT id, cyclist_code, scanned_at, pit_stop FROM scans ORDER BY id').all();
const data = [
['ID', 'Cyclist Code', 'Scanned At', 'Pit Stop'],
...rows.map(r => [r.id, r.cyclist_code, r.scanned_at, r.pit_stop])
];
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(data);
ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 24 }, { wch: 14 }];
XLSX.utils.book_append_sheet(wb, ws, 'Pit Stop Scans');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
res.setHeader('Content-Disposition', 'attachment; filename="pit_stop_scans.xlsx"');
res.send(buf);
});

app.listen(PORT, () => console.log(`QR Scanner running on http://localhost:${PORT}`));

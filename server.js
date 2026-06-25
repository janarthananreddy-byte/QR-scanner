const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const app = express();
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/api/health', async (req, res) => {
  try {
    const start = Date.now();
    const { error } = await supabase.from('scans').select('id').limit(1);
    if (error) throw error;
    res.json({ status: 'ok', latency: Date.now() - start });
  } catch(e) { res.status(503).json({ status: 'error', message: e.message }); }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const { data } = await supabase.from('app_users').select('id,username').eq('username', username.trim()).eq('password', password).maybeSingle();
    if (data) res.json({ ok: true, username: data.username });
    else res.status(401).json({ error: 'Invalid username or password' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users', async (req, res) => {
  try {
    const { data, error } = await supabase.from('app_users').select('id,username,created_at').order('id');
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
  try {
    const { data, error } = await supabase.from('app_users').insert({ username: username.trim(), password }).select().single();
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('app_users').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/scan', async (req, res) => {
  const { cyclist_code, pit_stop, scanner_name } = req.body;
  if (!cyclist_code) return res.status(400).json({ error: 'Missing cyclist_code' });
  const code = cyclist_code.trim().toUpperCase();
  if (!/^CC\d+$/.test(code)) return res.status(400).json({ error: 'Invalid code' });
  const cp = pit_stop || 'CP1';
  try {
    const { data: dup } = await supabase.from('scans').select('id').eq('cyclist_code', code).eq('pit_stop', cp).maybeSingle();
    if (dup) return res.status(409).json({ error: 'Rider ' + code + ' already scanned at ' + cp });
    const scanned_at = new Date().toISOString();
    const { data, error } = await supabase.from('scans').insert({ cyclist_code: code, scanned_at, pit_stop: cp, scanner_name: scanner_name || '' }).select().single();
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/scans', async (req, res) => {
  try {
    const { data, error } = await supabase.from('scans').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats', async (req, res) => {
  try {
    const { data, error } = await supabase.from('scans').select('pit_stop,scanner_name');
    if (error) throw error;
    const pitMap = {}, scannerMap = {};
    data.forEach(r => {
      const cp = r.pit_stop || 'CP1', name = r.scanner_name || '(unnamed)';
      pitMap[cp] = (pitMap[cp] || 0) + 1;
      const key = cp + '||' + name;
      if (!scannerMap[key]) scannerMap[key] = { pit_stop: cp, scanner_name: name, count: 0 };
      scannerMap[key].count++;
    });
    res.json({
      byPitStop: Object.entries(pitMap).map(([pit_stop, count]) => ({ pit_stop, count })).sort((a,b) => a.pit_stop.localeCompare(b.pit_stop)),
      byScanner: Object.values(scannerMap).sort((a,b) => a.pit_stop.localeCompare(b.pit_stop) || b.count - a.count),
      total: data.length
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reset', async (req, res) => {
  try {
    const { error } = await supabase.from('scans').delete().neq('id', 0);
    if (error) throw error;
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// T-SHIRT ENDPOINTS
app.get('/api/tshirt/:cc_id', async (req, res) => {
  const cc_id = req.params.cc_id.trim().toUpperCase();
  try {
    const { data } = await supabase.from('tshirts').select('*').eq('cc_id', cc_id).maybeSingle();
    if (!data) return res.status(404).json({ error: 'Rider ' + cc_id + ' not found in t-shirt list' });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tshirt/deliver', async (req, res) => {
  const { cc_id, delivered_by, distribution_center } = req.body;
  if (!cc_id) return res.status(400).json({ error: 'Missing cc_id' });
  const code = cc_id.trim().toUpperCase();
  try {
    const { data: existing } = await supabase.from('tshirts').select('id,delivered').eq('cc_id', code).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Rider not found' });
    if (existing.delivered) return res.status(409).json({ error: 'T-shirt already delivered to ' + code });
    const { data, error } = await supabase.from('tshirts').update({ delivered: true, delivered_at: new Date().toISOString(), delivered_by: delivered_by || '', distribution_center: distribution_center || '' }).eq('cc_id', code).select().single();
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tshirts/bulk', async (req, res) => {
  const { rows } = req.body;
  if (!rows || !rows.length) return res.status(400).json({ error: 'No data provided' });
  const records = rows.map(r => ({
    cc_id: String(r.cc_id || r.CC_ID || r['CC ID'] || r['CC_ID'] || '').trim().toUpperCase(),
    name: String(r.name || r.Name || r.NAME || r['Rider Name'] || '').trim(),
    size: String(r.size || r.Size || r.SIZE || r['T-Shirt Size'] || r['Tshirt Size'] || r.tshirt_size || '').trim().toUpperCase()
  })).filter(r => r.cc_id && r.cc_id.length > 0);
  if (!records.length) return res.status(400).json({ error: 'No valid rows found. Check column names: cc_id, name, size' });
  try {
    const { error } = await supabase.from('tshirts').upsert(records, { onConflict: 'cc_id' });
    if (error) throw error;
    res.json({ ok: true, count: records.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tshirts', async (req, res) => {
  try {
    const { data, error } = await supabase.from('tshirts').select('*').order('cc_id');
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tshirts/stats', async (req, res) => {
  try {
    const { data, error } = await supabase.from('tshirts').select('size,delivered,distribution_center');
    if (error) throw error;
    const total = data.length, delivered = data.filter(r => r.delivered).length;
    const bySize = {};
    data.forEach(r => { const s = r.size || '?'; bySize[s] = (bySize[s] || 0) + 1; });
    res.json({ total, delivered, pending: total - delivered, bySize });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export/csv', async (req, res) => {
  try {
    const { data, error } = await supabase.from('scans').select('*').order('id');
    if (error) throw error;
    const lines = ['id,cyclist_code,scanned_at,pit_stop,scanner_name', ...data.map(s => [s.id, s.cyclist_code, s.scanned_at, s.pit_stop, s.scanner_name || ''].join(','))];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="scans.csv"');
    res.send(lines.join('\n'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export/xlsx', async (req, res) => {
  try {
    const { data, error } = await supabase.from('scans').select('*').order('id');
    if (error) throw error;
    const rows = data.map(s => ({ ID: s.id, 'Cyclist Code': s.cyclist_code, 'Scanned At': s.scanned_at ? new Date(s.scanned_at).toLocaleString() : '', 'Pit Stop': s.pit_stop || '', 'Scanner Name': s.scanner_name || '' }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:6},{wch:16},{wch:22},{wch:8},{wch:16}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scans');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="scans.xlsx"');
    res.send(buf);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server on port ' + PORT));
module.exports = app;

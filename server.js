const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Supabase client — uses HTTP (PostgREST), no TCP firewall issues on Vercel
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    // Check duplicate
    const { data: dup } = await supabase
      .from('scans')
      .select('id')
      .eq('cyclist_code', code)
      .eq('pit_stop', cp)
      .maybeSingle();
    if (dup) return res.status(409).json({ error: 'Rider ' + code + ' already scanned at ' + cp });

    const scanned_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('scans')
      .insert({ cyclist_code: code, scanned_at, pit_stop: cp, scanner_name: scanner_name || '' })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch(e) {
    console.error('/api/scan error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/scans
app.get('/api/scans', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scans')
      .select('*')
      .order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/stats — aggregate in JS (works for event scale, no GROUP BY needed)
app.get('/api/stats', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scans')
      .select('pit_stop, scanner_name');
    if (error) throw error;

    const pitMap = {}, scannerMap = {};
    data.forEach(r => {
      const cp = r.pit_stop || 'CP1';
      const name = r.scanner_name || '(unnamed)';
      pitMap[cp] = (pitMap[cp] || 0) + 1;
      const key = cp + '||' + name;
      if (!scannerMap[key]) scannerMap[key] = { pit_stop: cp, scanner_name: name, count: 0 };
      scannerMap[key].count++;
    });

    res.json({
      byPitStop: Object.entries(pitMap)
        .map(([pit_stop, count]) => ({ pit_stop, count }))
        .sort((a, b) => a.pit_stop.localeCompare(b.pit_stop)),
      byScanner: Object.values(scannerMap)
        .sort((a, b) => a.pit_stop.localeCompare(b.pit_stop) || b.count - a.count),
      total: data.length
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/scan/:id (admin only, no UI button)
app.delete('/api/scan/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('scans').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/export/csv
app.get('/api/export/csv', async (req, res) => {
  try {
    const { data, error } = await supabase.from('scans').select('*').order('id');
    if (error) throw error;
    const lines = ['id,cyclist_code,scanned_at,pit_stop,scanner_name',
      ...data.map(s => [s.id, s.cyclist_code, s.scanned_at, s.pit_stop, s.scanner_name || ''].join(','))];
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
    const { data, error } = await supabase.from('scans').select('*').order('id');
    if (error) throw error;
    const lines = ['id,cyclist_code,scanned_at,pit_stop,scanner_name',
      ...data.map(s => [s.id, s.cyclist_code, s.scanned_at, s.pit_stop, s.scanner_name || ''].join(','))];
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

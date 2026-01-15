/**
 * Aggregates all api-captures/*.json into a master CSV for analysis.
 * Rebuilds master on each run (idempotent).
 */
const fs = require('fs');
const path = require('path');

const CAPTURE_DIR = path.join(process.cwd(), 'api-captures');
const OUT_CSV = path.join(CAPTURE_DIR, 'master.csv');

function listCaptureFiles() {
  if (!fs.existsSync(CAPTURE_DIR)) return [];
  return fs
    .readdirSync(CAPTURE_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'master.json' && f !== 'master.csv');
}

function asCsvValue(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s}"`;
  }
  return s;
}

function writeCsv(rows) {
  const header = [
    'runId',
    'runLabel',
    'capturedAt',
    'entryTs',
    'url',
    'method',
    'status',
    'contentType',
    'jsonLen',
    'textLen',
    'parseError',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    const line = header
      .map((k) => asCsvValue(r[k]))
      .join(',');
    lines.push(line);
  }
  fs.writeFileSync(OUT_CSV, lines.join('\n'), 'utf8');
  console.log(`[aggregate] wrote ${rows.length} rows to ${OUT_CSV}`);
}

function aggregate() {
  const files = listCaptureFiles();
  const rows = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(CAPTURE_DIR, file), 'utf8');
      const data = JSON.parse(raw);
      const runId = data.runId || file.replace('.json', '');
      const runLabel = data.runLabel || 'capture';
      const capturedAt = data.capturedAt || '';
      const entries = Array.isArray(data.entries) ? data.entries : data;

      for (const e of entries) {
        rows.push({
          runId: e.runId || runId,
          runLabel: e.runLabel || runLabel,
          capturedAt,
          entryTs: e.ts || '',
          url: e.url || '',
          method: e.method || '',
          status: e.status ?? '',
          contentType: e.contentType || '',
          jsonLen: (e.jsonSnippet || '').length,
          textLen: (e.textSnippet || '').length,
          parseError: e.parseError || '',
        });
      }
    } catch (err) {
      console.log(`[aggregate] failed to read ${file}: ${err?.message || err}`);
    }
  }

  writeCsv(rows);
}

aggregate();

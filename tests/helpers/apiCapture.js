const fs = require('fs');
const path = require('path');
const { ensureDirExists } = require('./fsUtils');

function makeRunId(runLabel) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  const safeLabel = (runLabel || 'capture').replace(/[^a-z0-9_-]+/gi, '-');
  return `${safeLabel}-${ts}-${rand}`;
}

function attachApiCapture(page, runLabel) {
  const entries = [];
  const runId = makeRunId(runLabel);

  page.on('response', async (res) => {
    const req = res.request();
    const resourceType = req.resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;

    const url = res.url();
    const method = req.method();
    const postData = req.postData();

    let ct = '';
    try {
      ct = (res.headers()['content-type'] || '').toLowerCase();
    } catch {}

    let status = 0;
    try {
      status = res.status();
    } catch {}

    let jsonSnippet = '';
    let parseError = '';
    let textSnippet = '';
    if (ct.includes('application/json')) {
      try {
        const json = await res.json();
        jsonSnippet = JSON.stringify(json).slice(0, 800);
      } catch (err) {
        parseError = err?.message || String(err);
      }
    }
    // Fallback to text for compressed/streamed or non-json bodies.
    if (!jsonSnippet) {
      try {
        const text = await res.text();
        textSnippet = (text || '').slice(0, 1500);
      } catch (err) {
        if (!parseError) parseError = err?.message || String(err);
      }
    }

    entries.push({
      runId,
      runLabel,
      ts: new Date().toISOString(),
      url,
      method,
      status,
      contentType: ct,
      postData,
      jsonSnippet,
      textSnippet,
      parseError,
      requestHeaders: req.headers ? req.headers() : {},
      responseHeaders: res.headers ? res.headers() : {},
    });

    const isJsonish = ct.includes('application/json');
    if (isJsonish) {
      console.log(`[resp][json] ${url}`);
      if (jsonSnippet) {
        console.log(`[resp][json][body] ${jsonSnippet}`);
      }
      if (!jsonSnippet && textSnippet) {
        console.log(`[resp][json][body-fallback] ${textSnippet}`);
      }
      if (parseError) {
        console.log(`[resp][json][error] ${parseError}`);
      }
    } else if (textSnippet) {
      console.log(`[resp][text] ${url}`);
      console.log(`[resp][text][body] ${textSnippet}`);
    }
  });

  const saveCapture = () => {
    if (!entries.length) return null;
    const baseDir = path.join(process.cwd(), 'api-captures');
    ensureDirExists(baseDir);
    const safeLabel = (runLabel || 'capture').replace(/[^a-z0-9_-]+/gi, '-');
    const outPath = path.join(baseDir, `${runId}.json`);
    const payload = {
      runId,
      runLabel: safeLabel,
      capturedAt: new Date().toISOString(),
      entries,
      meta: {
        env: process.env.CI ? 'ci' : 'local',
        node: process.version,
      },
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[capture] saved ${entries.length} entries to ${outPath}`);
    return outPath;
  };

  return { saveCapture };
}

module.exports = {
  attachApiCapture,
};

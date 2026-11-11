'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { escapeHtml, buildReport, buildTextReport, reportFilename, isInsideDirectory } = require('../src/main/reports');
const { makeResult, summarize } = require('../src/main/results');

const tool = { id: 'system', title: 'System Check' };
const systemInfo = {
  computerName: 'TEST-PC',
  osName: 'Example Linux',
  osDetail: 'Linux 6.1 x64',
  user: 'alice',
  admin: false,
  mode: 'Offline - local only'
};

function sampleRun(extra = {}) {
  const results = [
    makeResult(
      { id: 'os-info', name: 'Operating system', tool: 'system' },
      {
        status: 'pass',
        finding: 'Example Linux 1.0',
        evidence: 'Kernel: 6.1',
        explanation: 'Identifies the system.',
        nextStep: 'No action required.'
      }
    )
  ];
  return {
    tool: 'system',
    toolTitle: 'System Check',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:02.000Z',
    durationMs: 2000,
    cancelled: false,
    results,
    summary: summarize(results),
    requested: 1,
    completed: 1,
    ...extra
  };
}

test('escapeHtml neutralizes markup', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("a & b 'c'"), 'a &amp; b &#39;c&#39;');
});

test('HTML report contains measured values and metadata', () => {
  const html = buildReport({ tool, run: sampleRun(), systemInfo, version: '1.0.0', generatedAt: '2026-01-01T00:00:03.000Z' });
  assert.match(html, /Feather AI Diagnostic Report/);
  assert.match(html, /TEST-PC/);
  assert.match(html, /Example Linux 1\.0/);
  assert.match(html, /Kernel: 6\.1/);
  assert.match(html, /No repair actions were run in this session/);
  assert.match(html, /not proof that this computer is compromised/i);
});

test('HTML report escapes evidence rather than injecting it', () => {
  const run = sampleRun();
  run.results[0].evidence = '<img src=x onerror=alert(1)>';
  const html = buildReport({ tool, run, systemInfo });
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x/);
});

test('cancelled run is labelled in the report', () => {
  const html = buildReport({ tool, run: sampleRun({ cancelled: true }), systemInfo });
  assert.match(html, /cancelled before all selected items finished/i);
});

test('text report lists results and repairs', () => {
  const text = buildTextReport({
    tool,
    run: sampleRun(),
    systemInfo,
    repairs: [{ name: 'Flush DNS cache', risk: 'Low', outcome: 'success', startedAt: '2026-01-01T00:00:01.000Z', summary: 'Done.' }]
  });
  assert.match(text, /FEATHER AI DIAGNOSTIC REPORT/);
  assert.match(text, /\[PASS\] Operating system/);
  assert.match(text, /Flush DNS cache/);
  assert.match(text, /No telemetry was uploaded/);
});

test('report cannot be built without results', () => {
  assert.throws(() => buildReport({ tool, run: { results: null }, systemInfo }), /no check results/i);
  assert.throws(() => buildTextReport({ tool, run: null, systemInfo }), /no check results/i);
});

test('report filenames are stable and filesystem safe', () => {
  const date = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(reportFilename(tool, date), 'FeatherAI-system-20260102-030405');
  assert.equal(reportFilename({ id: 'bad name!' }, date), 'FeatherAI-badname-20260102-030405');
});

test('isInsideDirectory rejects escapes', () => {
  const base = path.join('/tmp', 'feather');
  assert.equal(isInsideDirectory(base, path.join(base, 'a.html')), true);
  assert.equal(isInsideDirectory(base, path.join(base, '..', 'evil.html')), false);
  assert.equal(isInsideDirectory(base, base), true);
});

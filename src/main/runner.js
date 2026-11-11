'use strict';

const { checksForPlatform, toolMap } = require('../shared/catalog');
const { makeResult, summarize } = require('./results');

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'CHECK_TIMEOUT' })), ms);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

class CheckRunner {
  constructor({ platform, onEvent = () => {}, audit = () => {}, clock = () => Date.now() }) {
    this.platform = platform;
    this.onEvent = onEvent;
    this.audit = audit;
    this.clock = clock;
  }

  async run({ tool, checkIds, signal }) {
    const toolDef = toolMap[tool];
    if (!toolDef || !toolDef.checks?.length) throw new Error('This tool does not run checks.');
    const available = checksForPlatform(this.platform.platform, tool);
    if (Array.isArray(checkIds) && checkIds.length === 0) throw new Error('Select at least one check first.');
    const wanted = new Set(Array.isArray(checkIds) && checkIds.length ? checkIds : available.map((c) => c.id));
    const selected = available.filter((c) => wanted.has(c.id));
    if (!selected.length) throw new Error('Select at least one check first.');

    const startedAt = new Date().toISOString();
    const started = this.clock();
    this.audit('scan-start', `${toolDef.title}: ${selected.length} check(s)`);
    this.onEvent({ type: 'run:start', tool, total: selected.length, checkIds: selected.map((c) => c.id), startedAt });

    const results = [];
    for (let i = 0; i < selected.length; i += 1) {
      if (signal?.aborted) break;
      const check = selected[i];
      this.onEvent({
        type: 'run:progress',
        tool,
        index: i + 1,
        total: selected.length,
        checkId: check.id,
        name: check.name,
        percent: Math.round((i / selected.length) * 100),
        indeterminate: false
      });

      const checkStarted = this.clock();
      let data;
      try {
        data = await withTimeout(
          Promise.resolve(this.platform.runCheck(check, { signal })),
          Math.max(5000, check.timeout + 8000),
          `${check.name} did not finish within its time limit.`
        );
      } catch (error) {
        if (signal?.aborted) break;
        data = {
          status: 'error',
          finding: error.code === 'CHECK_TIMEOUT' ? `${check.name} timed out.` : `${check.name} could not complete.`,
          evidence: error.message || String(error),
          explanation: 'The check did not finish, so Feather AI is not reporting a pass or a problem for it.',
          nextStep: 'Run the check again. If it keeps failing, run Feather AI as administrator or review the component involved.'
        };
      }

      if (signal?.aborted) break;
      const result = makeResult(check, { ...data, durationMs: this.clock() - checkStarted });
      results.push(result);
      this.onEvent({ type: 'run:result', tool, result });
      this.audit('check-result', `${check.id}: ${result.status} - ${result.finding}`);
      this.onEvent({
        type: 'run:progress',
        tool,
        index: i + 1,
        total: selected.length,
        checkId: check.id,
        name: check.name,
        percent: Math.round(((i + 1) / selected.length) * 100),
        indeterminate: false
      });
    }

    const finishedAt = new Date().toISOString();
    const cancelled = Boolean(signal?.aborted);
    const summary = summarize(results);
    const run = {
      tool,
      toolTitle: toolDef.title,
      startedAt,
      finishedAt,
      durationMs: this.clock() - started,
      cancelled,
      results,
      summary,
      requested: selected.length,
      completed: results.length
    };
    this.audit('scan-end', `${toolDef.title}: ${summary.total} results, warnings ${summary.warn}, failures ${summary.fail}, cancelled ${cancelled}`);
    this.onEvent({ type: 'run:done', tool, run });
    return run;
  }
}

module.exports = { CheckRunner };

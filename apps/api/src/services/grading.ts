import { Database, one } from '../../../../packages/db/src/db.js';
import { LlmService } from '../../../../packages/llm/src/provider.js';
import { runInstant, outputCheck } from '../../../../packages/grading/src/server.js';
import { type Check, type Result } from '../../../../packages/grading/src/instant.js';
import { finalize } from './progress.js';
import { trace } from '@opentelemetry/api';
import { gradeMetrics } from '../../../../packages/shared/src/telemetry.js';
export class GradingService {
  constructor(
    public db: Database,
    public llm: LlmService,
  ) {}
  async dryRun(c: any, prompt: string, user: string) {
    if (
      this.llm.config.LLM_PROVIDER === 'disabled' &&
      c.checks.some((k: Check) => k.phase === 'model' && k.type !== 'code_tests')
    ) {
      const { fail } = await import('../../../../packages/shared/src/utils.js');
      fail(503, 'ai_not_configured', 'Configure the AI provider to evaluate this challenge.');
    }
    const count = await this.llm.count(prompt, user);
    const checks: Check[] = c.checks,
      results: Result[] = checks
        .filter((k) => k.phase === 'instant')
        .map((k) => runInstant(k, prompt, count.count, c.token_budget));
    const blocked = checks.some(
      (k) => k.required && k.phase === 'instant' && !results.find((r) => r.key === k.key)?.passed,
    );
    let reservation: string | null = null,
      output = '';
    try {
      if (!blocked && checks.some((k) => k.phase === 'model' && k.type !== 'code_tests'))
        reservation = await this.llm.reserve(user, null, c, checks);
      if (!blocked && c.run_config) {
        const r = await this.llm.provider.complete({
          model: this.llm.config.RUN_MODEL,
          system: c.run_config.system,
          messages: [...c.run_config.prefix_messages, { role: 'user', content: prompt }],
          maxTokens: c.run_config.max_output_tokens,
          temperature: 0,
        });
        output = r.text;
        await this.llm.usage(
          user,
          null,
          'run_prompt',
          this.llm.config.RUN_MODEL,
          r.inputTokens,
          r.outputTokens,
        );
      }
      for (const k of checks.filter((k) => k.phase === 'model')) {
        if (k.type === 'code_tests')
          results.push({
            key: k.key,
            passed: true,
            score: 0,
            skipped: true,
            message: 'Coming soon',
          });
        else if (blocked)
          results.push({
            key: k.key,
            passed: false,
            score: 0,
            message: 'Fix the checks above first',
          });
        else if (k.type === 'llm_judge')
          results.push(await this.llm.judge(k, prompt, c.context, user, null));
        else results.push(outputCheck(k, output, c.context));
      }
      return {
        passed: checks
          .filter((k) => k.required && k.type !== 'code_tests')
          .every((k) => results.find((r) => r.key === k.key)?.passed),
        tokenCount: count.count,
        tokenCounter: count.counter,
        checks: results,
        modelOutput: output || null,
        xpAwarded: 0,
      };
    } finally {
      if (reservation)
        await this.db.query('UPDATE model_reservations SET reserved_micros=0 WHERE id=$1', [
          reservation,
        ]);
    }
  }
  async grade(id: string, options: { retryOnError?: boolean } = {}) {
    return trace.getTracer('promptlab').startActiveSpan('grade', async (span) => {
      const start = performance.now();
      span.setAttribute('submissionId', id);
      try {
        return await this.gradeInner(id, options.retryOnError ?? false);
      } finally {
        gradeMetrics.duration.record((performance.now() - start) / 1000);
        span.end();
      }
    });
  }
  private async gradeInner(id: string, retryOnError: boolean) {
    const s = await one(this.db, 'SELECT * FROM submissions WHERE id=$1', [id]);
    if (!s || ['passed', 'failed', 'error'].includes(s.status)) return;
    // Lease is durable. Retried/stuck jobs use the sweeper to recover rather than duplicate LLM calls.
    const claimed = await one(
      this.db,
      "UPDATE submissions SET status='grading',grading_started_at=now() WHERE id=$1 AND status='queued' RETURNING *",
      [id],
    );
    if (!claimed) return;
    const learner = await one(this.db, 'SELECT banned_at,deleted_at FROM users WHERE id=$1', [
      s.user_id,
    ]);
    if (!learner || learner.banned_at || learner.deleted_at) {
      await this.db.query(
        "UPDATE submissions SET status='error',error_code='account_restricted',graded_at=now() WHERE id=$1",
        [id],
      );
      await this.db.query(
        'UPDATE model_reservations SET reserved_micros=0 WHERE submission_id=$1',
        [id],
      );
      return;
    }
    const v = await one(this.db, 'SELECT * FROM challenge_versions WHERE id=$1', [
      s.challenge_version_id,
    ]);
    const checks: Check[] = (
      await this.db.query(
        'SELECT * FROM challenge_checks WHERE challenge_version_id=$1 ORDER BY position',
        [s.challenge_version_id],
      )
    ).rows;
    const results: Result[] = checks
      .filter((c) => c.phase === 'instant')
      .map((c) => runInstant(c, s.prompt, s.token_count, s.token_budget));
    await this.llm.cache.set(`submission:${id}:checks`, JSON.stringify(results), 300);
    try {
      const blocked = checks.some(
        (c) => c.required && c.phase === 'instant' && !results.find((r) => r.key === c.key)?.passed,
      );
      if (!blocked && checks.some((c) => c.phase === 'model' && c.type !== 'code_tests'))
        await this.llm.reserve(s.user_id, id, v, checks);
      let output = s.model_output ?? '';
      if (v.run_config && !blocked && s.model_output === null) {
        const r = await this.llm.provider.complete({
          model: this.llm.config.RUN_MODEL,
          system: v.run_config.system,
          messages: [...v.run_config.prefix_messages, { role: 'user', content: s.prompt }],
          maxTokens: v.run_config.max_output_tokens,
          temperature: 0,
        });
        output = r.text.slice(0, 50000);
        await this.llm.usage(
          s.user_id,
          id,
          'run_prompt',
          this.llm.config.RUN_MODEL,
          r.inputTokens,
          r.outputTokens,
        );
        await this.db.query(
          'UPDATE submissions SET model_output=$2,model_output_tokens=$3,model_name=$4 WHERE id=$1',
          [id, output, r.outputTokens, r.model],
        );
      }
      for (const c of checks.filter((c) => c.phase === 'model')) {
        if (c.type === 'code_tests')
          results.push({
            key: c.key,
            passed: true,
            score: 0,
            skipped: true,
            message: 'Coming soon: isolated code execution is disabled',
          });
        else if (blocked)
          results.push({
            key: c.key,
            passed: false,
            score: 0,
            message: 'Fix the checks above first',
          });
        else if (c.type === 'llm_judge')
          results.push(await this.llm.judge(c, s.prompt, v.context, s.user_id, id));
        else results.push(outputCheck(c, output, v.context));
        await this.llm.cache.set(`submission:${id}:checks`, JSON.stringify(results), 300);
      }
      await this.db.tx(async (q) => {
        await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [s.user_id]);
        await finalize(q, s, checks, results);
      });
      gradeMetrics.total.add(1, {
        result: (await one(this.db, 'SELECT status FROM submissions WHERE id=$1', [id])).status,
      });
    } catch (e) {
      await this.db.query(
        "UPDATE submissions SET status=$2,error_code=$3,graded_at=CASE WHEN $2='error' THEN now() ELSE NULL END,grading_started_at=NULL WHERE id=$1 AND status='grading'",
        [id, retryOnError ? 'queued' : 'error', retryOnError ? null : 'model_unavailable'],
      );
      if (this.llm.config.NODE_ENV !== 'test')
        console.error('Grading failed', id, e instanceof Error ? e.name : 'unknown');
      if (retryOnError) throw e;
    } finally {
      await this.db.query(
        "UPDATE model_reservations SET reserved_micros=0 WHERE submission_id=$1 AND EXISTS(SELECT 1 FROM submissions WHERE id=$1 AND status IN ('passed','failed','error'))",
        [id],
      );
      await this.llm.cache.del(`dashboard:${s.user_id}`);
      // Redis can be rebuilt from the ledger; a cache outage must not undo a grade.
      try {
        await this.llm.afterFinalize?.(s.user_id);
      } catch (e) {
        console.error(
          'Leaderboard cache update failed',
          e instanceof Error ? e.message : 'unknown',
        );
      }
    }
  }
}

import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { createApp } from '../../api/src/app.js';
import { rebuildLeaderboards } from '../../../packages/db/src/leaderboard.js';
import { ResendEmailSender } from '../../../packages/shared/src/email.js';
import {
  schedules,
  sweepSubmissions,
  reconcileStats,
  notifyStreakRisk,
  purgeUsers,
  rollupUsage,
  pickDaily,
} from './maintenance.js';
export async function runWorker() {
  const { app, db, grading, config } = await createApp();
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const maintenanceQueue = new Queue('maintenance', { connection: connection as any });
  const gradeQueue = new Queue('grade', { connection: connection as any });
  const mailer = new ResendEmailSender(config);
  const gradeWorker = new Worker(
    'grade',
    async (job) => {
      const s = (
        await db.query('SELECT user_id FROM submissions WHERE id=$1', [job.data.submissionId])
      ).rows[0];
      app.log.info(
        { jobId: job.id, submissionId: job.data.submissionId, userId: s?.user_id },
        'Grading submission',
      );
      await grading.grade(job.data.submissionId);
    },
    { connection: connection as any, concurrency: 8, limiter: { max: 20, duration: 60000 } },
  );
  const handlers: Record<string, () => Promise<unknown>> = {
    'grade.sweep': () => sweepSubmissions(db, gradeQueue),
    'leaderboard.rebuild': () => rebuildLeaderboards(db, connection),
    'stats.reconcile': () => reconcileStats(db),
    'daily.pick': () => pickDaily(db),
    'streak.risk': () => notifyStreakRisk(db),
    'users.purge': () => purgeUsers(db),
    'usage.rollup': () => rollupUsage(db, config),
  };
  const maintenanceWorker = new Worker(
    'maintenance',
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`Unknown maintenance job: ${job.name}`);
      const result = await handler();
      app.log.info({ jobId: job.id, jobName: job.name, result }, 'Maintenance completed');
    },
    { connection: connection as any, concurrency: 1 },
  );
  const emailWorker = new Worker(
    'email',
    async (job) => {
      await mailer.sendMagicLink(job.data);
    },
    { connection: connection as any, concurrency: 4 },
  );
  for (const schedule of schedules)
    await maintenanceQueue.upsertJobScheduler(schedule.name, schedule.repeat, {
      name: schedule.name,
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    });
  for (const worker of [gradeWorker, maintenanceWorker, emailWorker])
    worker.on('failed', (job, error) =>
      app.log.error(
        { jobId: job?.id, jobName: job?.name, errorName: error.name },
        'Background job failed',
      ),
    );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await Promise.all([gradeWorker.close(), maintenanceWorker.close(), emailWorker.close()]);
      await Promise.all([maintenanceQueue.close(), gradeQueue.close()]);
      await connection.quit();
      await app.close();
      process.exit(0);
    });
}

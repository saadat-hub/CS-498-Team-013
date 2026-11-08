import { runWorker } from './runtime.js';

// The separate runtime owns schedules, queues, retries and graceful shutdown.
await runWorker();

import { metrics, trace, SpanStatusCode } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
export async function installTelemetry(app: FastifyInstance, c: Config) {
  let shutdown: (() => Promise<void>) | undefined;
  if (c.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const base = c.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '');
    const sdk = new NodeSDK({
      serviceName: 'promptlab-backend',
      traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    });
    sdk.start();
    shutdown = () => sdk.shutdown();
  }
  const sentry = c.SENTRY_DSN ? await import('@sentry/node') : null;
  sentry?.init({
    dsn: c.SENTRY_DSN,
    defaultIntegrations: false,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.breadcrumbs;
      return event;
    },
  });
  const meter = metrics.getMeter('promptlab'),
    duration = meter.createHistogram('http_server_duration', { unit: 'ms' }),
    requests = meter.createCounter('http_requests_total');
  app.addHook('onRequest', async (r) => {
    (r as any).telemetry = {
      started: performance.now(),
      span: trace.getTracer('promptlab').startSpan('http.request'),
    };
  });
  app.addHook('onResponse', async (r, reply) => {
    const t = (r as any).telemetry;
    if (!t) return;
    const attributes = {
      route: r.routeOptions.url ?? 'unknown',
      method: r.method,
      status: reply.statusCode,
    };
    requests.add(1, attributes);
    duration.record(performance.now() - t.started, attributes);
    t.span.setAttributes(attributes);
    if (reply.statusCode >= 500) {
      t.span.setStatus({ code: SpanStatusCode.ERROR });
      sentry?.captureMessage('Backend request failed', {
        level: 'error',
        tags: { route: attributes.route, requestId: r.id },
      });
    }
    t.span.end();
  });
  app.addHook('onClose', async () => {
    await shutdown?.();
    await sentry?.close(2000);
  });
}
export const gradeMetrics = {
  total: metrics.getMeter('promptlab').createCounter('submissions_total'),
  duration: metrics.getMeter('promptlab').createHistogram('grade_duration_seconds', { unit: 's' }),
  llmCalls: metrics.getMeter('promptlab').createCounter('llm_calls_total'),
  llmCost: metrics.getMeter('promptlab').createCounter('llm_cost_usd_total'),
  fallback: metrics.getMeter('promptlab').createCounter('token_counter_fallback_total'),
};

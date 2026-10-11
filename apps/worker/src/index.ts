import { handleApi } from './api';
import { handleSetup, handleWebhook } from './bot';
import { missingEnv, type Env } from './env';
import { HEARTBEAT_CRON, health, heartbeat } from './heartbeat';
import { runScheduled } from './scheduled';
import { cors, HttpError, json } from './http';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    const missing = missingEnv(env);
    if (missing.length) {
      console.error(`config: missing env ${missing.join(', ')}`);
      return json({ error: 'server_misconfigured' }, 500);
    }

    if (path === '/bot/webhook' && req.method === 'POST') return handleWebhook(req, env);
    if (path === '/bot/setup') return handleSetup(req, env, url.origin);

    if (path.startsWith('/api/')) {
      const headers = cors(env, req);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      try {
        const res = await handleApi(req, env, path, ctx);
        for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
        return res;
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.code }, e.status, headers);
        console.error(`api: ${(e as Error).message}`);
        return json({ error: 'server' }, 500, headers);
      }
    }

    if (path === '/') return new Response('ok');
    if (path === '/health') return json(await health(env));
    return json({ error: 'not_found' }, 404);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (missingEnv(env).length) return console.error('cron: missing env');
    const job = event.cron === HEARTBEAT_CRON ? heartbeat(env, 'cron') : runScheduled(env);
    ctx.waitUntil(job.then(() => undefined).catch((e) => console.error(`cron: ${(e as Error).message}`)));
  },
} satisfies ExportedHandler<Env>;

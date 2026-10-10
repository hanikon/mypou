import { handleApi } from './api';
import { handleSetup, handleWebhook } from './bot';
import { missingEnv, type Env } from './env';
import { cors, HttpError, json } from './http';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
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
        const res = await handleApi(req, env, path);
        for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
        return res;
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.code }, e.status, headers);
        console.error(`api: ${(e as Error).message}`);
        return json({ error: 'server' }, 500, headers);
      }
    }

    if (path === '/') return new Response('ok');
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;

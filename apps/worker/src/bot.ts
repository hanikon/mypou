import { Api, Bot, InlineKeyboard, webhookCallback } from 'grammy';
import type { Env } from './env';
import { safeEqual } from './http';

const TEXT = {
  ru: {
    start: 'Привет! Здесь живёт твой питомец-капля. Покорми его, поиграй и позови друга 🫧',
    play: '🎮 Играть',
  },
  en: {
    start: 'Hi! Your droplet pet lives here. Feed it, play with it and invite a friend 🫧',
    play: '🎮 Play',
  },
};

const lang = (code?: string) => (code?.startsWith('en') ? 'en' : 'ru');

let cached: { token: string; handle: (req: Request) => Promise<Response> } | undefined;

function createBot(env: Env) {
  const bot = new Bot(env.BOT_TOKEN);
  bot.command('start', (ctx) => {
    const t = TEXT[lang(ctx.from?.language_code)];
    return ctx.reply(t.start, { reply_markup: new InlineKeyboard().webApp(t.play, env.WEB_ORIGIN) });
  });
  bot.catch((err) => console.error(`bot: ${err.message}`));
  // grammY сам проверяет заголовок X-Telegram-Bot-Api-Secret-Token.
  return webhookCallback(bot, 'cloudflare-mod', { secretToken: env.WEBHOOK_SECRET });
}

export function handleWebhook(req: Request, env: Env) {
  // Сначала свой проверочный секрет: чужие запросы не должны доходить до бота.
  if (!safeEqual(req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '', env.WEBHOOK_SECRET)) {
    return Promise.resolve(new Response('unauthorized', { status: 401 }));
  }
  if (cached?.token !== env.BOT_TOKEN) cached = { token: env.BOT_TOKEN, handle: createBot(env) };
  return cached.handle(req);
}

const page = (body: string) =>
  new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot setup</title>` +
      `<body style="font:16px system-ui;max-width:420px;margin:40px auto;padding:0 16px">${body}</body>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );

/**
 * Разовая настройка бота с телефона: форма просит WEBHOOK_SECRET (в теле POST, не в URL),
 * затем регистрирует webhook, команды и кнопку меню.
 */
export async function handleSetup(req: Request, env: Env, origin: string): Promise<Response> {
  if (req.method === 'GET') {
    return page(
      `<h2>Настройка бота</h2><form method="post"><p>Введи WEBHOOK_SECRET:</p>` +
        `<input name="secret" type="password" autocomplete="off" style="width:100%;padding:10px">` +
        `<p><button style="padding:10px 16px">Настроить</button></p></form>`,
    );
  }
  const form = await req.formData();
  const secret = String(form.get('secret') ?? '');
  if (!safeEqual(secret, env.WEBHOOK_SECRET)) return page('<p>❌ Неверный секрет.</p>');

  const api = new Api(env.BOT_TOKEN);
  const results: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      results.push(`✅ ${name}`);
    } catch (e) {
      results.push(`❌ ${name}: ${(e as Error).message.replaceAll(env.BOT_TOKEN, '***')}`);
    }
  };
  await step('webhook', () =>
    api.setWebhook(`${origin}/bot/webhook`, {
      secret_token: env.WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      drop_pending_updates: true,
    }),
  );
  await step('commands', () => api.setMyCommands([{ command: 'start', description: 'Открыть игру / Open the game' }]));
  await step('menu button', () =>
    api.setChatMenuButton({ menu_button: { type: 'web_app', text: '🎮', web_app: { url: env.WEB_ORIGIN } } }),
  );
  return page(`<h2>Готово</h2><p>${results.join('<br>')}</p>`);
}

import { Api, Bot, InlineKeyboard, webhookCallback, type Context } from 'grammy';
import { db } from './db';
import { tgClient, type Env } from './env';
import { safeEqual } from './http';
import { appButton, flush } from './notify';
import { acceptInvite } from './social';

type Lang = 'ru' | 'en';
const lang = (code?: string): Lang => (code?.startsWith('en') ? 'en' : 'ru');

const TEXT = {
  ru: {
    start: 'Привет! Здесь живёт твой питомец-капля. Покорми его, поиграй и позови друга 🫧',
    invite: {
      added: (n: string) => `🤝 ${n} теперь в друзьях!`,
      already: (n: string) => `${n} уже в друзьях.`,
      self: () => 'Это твоя собственная ссылка 🙂',
      invalid: () => 'Приглашение не найдено.',
      full: () => 'Слишком много друзей.',
    },
    settingsTitle: 'Уведомления. Нажми, чтобы включить или выключить:',
    all: 'Все уведомления',
    hunger: 'Питомец голоден',
    social: 'Друзья: гости и подарки',
    game: 'Твой ход в игре',
  },
  en: {
    start: 'Hi! Your droplet pet lives here. Feed it, play with it and invite a friend 🫧',
    invite: {
      added: (n: string) => `🤝 You and ${n} are friends now!`,
      already: (n: string) => `You and ${n} are already friends.`,
      self: () => 'That is your own link 🙂',
      invalid: () => 'Invite not found.',
      full: () => 'Too many friends.',
    },
    settingsTitle: 'Notifications. Tap to turn on or off:',
    all: 'All notifications',
    hunger: 'Pet is hungry',
    social: 'Friends: visits and gifts',
    game: 'Your turn in a game',
  },
};

const PREFS = ['notify', 'notify_hunger', 'notify_social', 'notify_game'] as const;
type Pref = (typeof PREFS)[number];
const LABEL: Record<Pref, 'all' | 'hunger' | 'social' | 'game'> = {
  notify: 'all',
  notify_hunger: 'hunger',
  notify_social: 'social',
  notify_game: 'game',
};

let cached: { token: string; handle: (req: Request) => Promise<Response> } | undefined;

function createBot(env: Env) {
  const bot = new Bot(env.BOT_TOKEN, { client: tgClient(env) });

  /** Пользователь написал боту — теперь бот может писать ему. Заодно создаём/обновляем запись. */
  async function touchUser(ctx: Context) {
    if (!ctx.from || ctx.from.is_bot) return;
    const { error } = await db(env)
      .from('users')
      .upsert({ id: ctx.from.id, first_name: ctx.from.first_name.slice(0, 64), can_message: true }, { onConflict: 'id' });
    if (error) console.error(`bot: touch user: ${error.message}`);
  }

  async function settingsKeyboard(userId: number, l: Lang) {
    const { data } = await db(env).from('users').select(PREFS.join(', ')).eq('id', userId).maybeSingle();
    const s = (data ?? {}) as unknown as Record<Pref, boolean>;
    const kb = new InlineKeyboard();
    for (const p of PREFS) kb.text(`${s[p] !== false ? '🔔' : '🔕'} ${TEXT[l][LABEL[p]]}`, `pref:${p}`).row();
    return kb;
  }

  bot.command('start', async (ctx) => {
    await touchUser(ctx);
    const l = lang(ctx.from?.language_code);
    const t = TEXT[l];
    const payload = ctx.match?.trim();
    if (payload && ctx.from) {
      const r = await acceptInvite(db(env), { id: ctx.from.id, first_name: ctx.from.first_name }, payload);
      if (r) {
        await ctx.reply(t.invite[r.status](r.name ?? '?'));
        if (r.notifyIds?.length) await flush(env, db(env), r.notifyIds);
      }
    }
    await ctx.reply(t.start, { reply_markup: appButton(env, l) });
  });

  bot.command('settings', async (ctx) => {
    await touchUser(ctx);
    const l = lang(ctx.from?.language_code);
    await ctx.reply(TEXT[l].settingsTitle, { reply_markup: await settingsKeyboard(ctx.from!.id, l) });
  });

  bot.callbackQuery(/^pref:(notify|notify_hunger|notify_social|notify_game)$/, async (ctx) => {
    const p = ctx.match[1] as Pref;
    const sb = db(env);
    const { data } = await sb.from('users').select(p).eq('id', ctx.from.id).maybeSingle();
    const current = (data as Record<string, boolean> | null)?.[p] !== false;
    await sb.from('users').update({ [p]: !current }).eq('id', ctx.from.id);
    const l = lang(ctx.from.language_code);
    await ctx.editMessageReplyMarkup({ reply_markup: await settingsKeyboard(ctx.from.id, l) });
    await ctx.answerCallbackQuery();
  });

  // Пользователь заблокировал или разблокировал бота — запоминаем, можно ли ему писать.
  bot.on('my_chat_member', async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    const can = status === 'member';
    const { error } = await db(env).from('users').update({ can_message: can }).eq('id', ctx.myChatMember.from.id);
    if (error) console.error(`bot: chat member: ${error.message}`);
  });

  bot.on('message', touchUser);

  bot.catch((err) => console.error(`bot: ${err.message.replaceAll(env.BOT_TOKEN, '***')}`));
  return webhookCallback(bot, 'cloudflare-mod');
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Разовая настройка бота с телефона: форма просит WEBHOOK_SECRET (в теле POST, не в URL),
 * затем регистрирует webhook, команды и кнопку меню и показывает состояние webhook.
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

  const api = new Api(env.BOT_TOKEN, tgClient(env));
  const results: string[] = [];
  const hide = (s: string) => esc(s.replaceAll(env.BOT_TOKEN, '***').replaceAll(env.WEBHOOK_SECRET, '***'));
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      results.push(`✅ ${name}${typeof r === 'string' ? `: ${hide(r)}` : ''}`);
    } catch (e) {
      results.push(`❌ ${name}: ${hide((e as Error).message)}`);
    }
  };
  await step('webhook', () =>
    api.setWebhook(`${origin}/bot/webhook`, {
      secret_token: env.WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query', 'my_chat_member', 'pre_checkout_query'],
      drop_pending_updates: true,
    }),
  );
  await step('commands', () =>
    api.setMyCommands([
      { command: 'start', description: 'Открыть игру / Open the game' },
      { command: 'settings', description: 'Уведомления / Notifications' },
    ]),
  );
  await step('menu button', () =>
    api.setChatMenuButton({ menu_button: { type: 'web_app', text: '🎮', web_app: { url: env.WEB_ORIGIN } } }),
  );
  await step('webhook info', async () => {
    const i = await api.getWebhookInfo();
    return `pending=${i.pending_update_count}${i.last_error_message ? `, last error: ${i.last_error_message}` : ''}`;
  });
  return page(`<h2>Готово</h2><p>${results.join('<br>')}</p>`);
}

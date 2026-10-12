# Деплой с Claude Code на своём компьютере

Инструкция для Claude Code, запущенного **локально** в папке этого репозитория.
Человек говорит: «Выполни DEPLOY_WITH_CLAUDE.md». Claude ведёт его по шагам и сам запускает команды.

## Правила для Claude (обязательно)

- **Никогда не выводи и не проси в чат значения секретов** (токен бота, ключ Supabase, WEBHOOK_SECRET).
  Секреты попадают в Cloudflare только так:
  - пользователь сам вводит их в скрытый запрос `npx wrangler secret put ...` (в Claude Code CLI он может запустить команду с префиксом `!`);
  - или Claude генерирует их и передаёт через конвейер, не печатая.
- Локальные копии секретов храни только в `apps/worker/.dev.vars` (он в `.gitignore`). Не коммить их.
- Не читай вслух `.dev.vars` и не делай `cat` по нему.
- Перед каждым шагом коротко объясни, что сейчас будет. Если что-то пошло не так, разберись и предложи исправление.
- Не создавай аккаунты и не принимай соглашения за человека.

## Что может сделать только человек

1. Создать бота в Telegram: @BotFather → `/newbot` (Claude не может писать в Telegram от имени человека).
2. Войти в Cloudflare и Supabase в браузере, когда откроется окно входа.
3. Ввести токен бота и ключ Supabase в скрытые запросы.
4. Создать Mini App в @BotFather (`/newapp`) по адресу, который выдаст Claude.

## Шаги

Все команды запускай из корня репозитория.

### 0. Подготовка
```bash
git fetch origin claude/gracious-johnson-7b684j
git checkout claude/gracious-johnson-7b684j
node -v            # нужен 20+ (лучше 22)
npm ci
npm test && npm run typecheck
```

### 1. Бот
Попроси человека создать бота в @BotFather (`/newbot`) и сообщить **только username** (без @), без токена.
Запомни его как `BOT_USERNAME`. Short name для Mini App будет `play`.

### 2. Supabase
1. Человек создаёт проект на https://supabase.com/dashboard (Free, регион ближе к нему, пароль БД сохраняет у себя).
   Альтернатива: `npx supabase login` и `npx supabase projects create`.
2. Узнай `project ref` (он есть в URL панели) и `SUPABASE_URL` = `https://<ref>.supabase.co`.
3. Примени миграции:
   ```bash
   npx supabase login
   npx supabase init          # только если link попросит config.toml; на вопросы отвечай «нет»
   npx supabase link --project-ref <ref>
   npx supabase db push       # применит все файлы из supabase/migrations по порядку
   ```
   Если `db push` не подходит, человек может вставить файлы из `supabase/migrations` по порядку в SQL Editor.
4. Проверь в выводе, что все 3 миграции применились.

### 3. Cloudflare Worker (API + бот)
```bash
npx wrangler login
npx wrangler deploy --config apps/worker/wrangler.toml
```
Из вывода возьми URL Worker (`https://kaplya-api.<subdomain>.workers.dev`), это `WORKER_URL`.

Секреты (`--config apps/worker/wrangler.toml` в каждой команде):
- `BOT_TOKEN`: человек вводит сам: `npx wrangler secret put BOT_TOKEN --config apps/worker/wrangler.toml`
- `SUPABASE_SERVICE_ROLE_KEY`: человек копирует из Supabase → Project Settings → API Keys (service_role или secret key) и вводит так же.
- `WEBHOOK_SECRET`: сгенерируй и передай без вывода на экран, сохранив копию в `.dev.vars`:
  ```bash
  node -e "const s=require('crypto').randomBytes(32).toString('base64url');require('fs').appendFileSync('apps/worker/.dev.vars','WEBHOOK_SECRET='+s+'\n');process.stdout.write(s)" | npx wrangler secret put WEBHOOK_SECRET --config apps/worker/wrangler.toml
  ```
- Несекретные значения тоже передай через `secret put` (так их не сотрёт следующий деплой):
  `SUPABASE_URL`, `BOT_USERNAME`, `MINIAPP_SHORT_NAME` (= `play`), `WEB_ORIGIN` (временно `https://example.com`).
  Пример: `echo https://<ref>.supabase.co | npx wrangler secret put SUPABASE_URL --config apps/worker/wrangler.toml`
  (в PowerShell используй `Write-Output ... |`).

Проверка: открой `WORKER_URL/health`, ожидается `"supabase":"ok"`.

### 4. Фронтенд (Cloudflare Pages)
```bash
# macOS/Linux:
VITE_API_URL=<WORKER_URL> npm run build
# Windows PowerShell:
#   $env:VITE_API_URL="<WORKER_URL>"; npm run build
npx wrangler pages project create kaplya --production-branch main
npx wrangler pages deploy apps/web/dist --project-name kaplya --branch main
```
Если имя `kaplya` занято, выбери другое. Из вывода возьми production URL (`https://<project>.pages.dev`), это `WEB_ORIGIN`.

Обнови секрет: `echo <WEB_ORIGIN> | npx wrangler secret put WEB_ORIGIN --config apps/worker/wrangler.toml`.

### 5. Подключить бота к Worker
Отправь POST на `/bot/setup` с секретом из `.dev.vars`, не печатая его:
```bash
node -e "const s=require('fs').readFileSync('apps/worker/.dev.vars','utf8').match(/^WEBHOOK_SECRET=(.*)$/m)[1];fetch(process.argv[1]+'/bot/setup',{method:'POST',body:new URLSearchParams({secret:s})}).then(r=>r.text()).then(t=>console.log(t.replace(/<[^>]+>/g,' ')))" <WORKER_URL>
```
Ожидается: `✅ webhook`, `✅ commands`, `✅ menu button`, `pending=0`.

### 6. Mini App в @BotFather (человек)
`/newapp` → выбрать бота → название, описание, картинка 640×360 → URL = `WEB_ORIGIN` → short name `play`.
Ссылка на игру: `https://t.me/<BOT_USERNAME>/play`.

### 7. Финальная проверка
- В Telegram боту `/start`: приходит кнопка «Играть».
- Игра открывается, видны монеты и питомец.
- ⚙️ → «Проверить уведомления»: в чат с ботом приходит тестовое сообщение.
- «Друзья» → ссылка приглашения начинается с `https://t.me/<BOT_USERNAME>/play?startapp=invite_`.
- Cloudflare → Worker → Settings → Trigger Events: два cron-расписания.
- `WORKER_URL/health` → `"supabase":"ok"`.

### Потом (необязательно)
Автодеплой из GitHub при каждом пуше: смерджить ветку в `main` и подключить репозиторий в Cloudflare (раздел «Пошаговая настройка» в README). Для Pages при этом задать переменную `VITE_API_URL`.

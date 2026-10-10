export interface Env {
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** URL фронтенда на Pages, например https://kaplya.pages.dev — для CORS и кнопки в боте. */
  WEB_ORIGIN: string;
  BOT_USERNAME?: string;
  MINIAPP_SHORT_NAME?: string;
}

const REQUIRED: (keyof Env)[] = ['BOT_TOKEN', 'WEBHOOK_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WEB_ORIGIN'];

/** Имена отсутствующих переменных (сами значения не выводим никогда). */
export function missingEnv(env: Env): string[] {
  return REQUIRED.filter((k) => !env[k]);
}

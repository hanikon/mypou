import { db } from './db';
import type { Env } from './env';

/** Расписание «будильника» (должно совпадать с wrangler.toml). */
export const HEARTBEAT_CRON = '17 6 */2 * *';

/**
 * Лёгкий запрос, чтобы бесплатный проект Supabase не уснул от бездействия:
 * обновляем единственную строку heartbeat и пишем результат в лог.
 */
export async function heartbeat(env: Env, source: string): Promise<{ ok: boolean; beatAt?: string; error?: string }> {
  const sb = db(env);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await sb
      .from('heartbeat')
      .update({ beat_at: new Date().toISOString(), note: source })
      .eq('id', 1)
      .select('beat_at')
      .single();
    if (!error && data) {
      console.log(`heartbeat: ok (${source}) beat_at=${(data as { beat_at: string }).beat_at}`);
      return { ok: true, beatAt: (data as { beat_at: string }).beat_at };
    }
    console.error(`heartbeat: attempt ${attempt} failed: ${error?.message ?? 'no row'}`);
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return { ok: false, error: 'supabase_unreachable' };
}

/** Состояние «будильника» для страницы /health (без секретов). */
export async function health(env: Env) {
  const { data, error } = await db(env).from('heartbeat').select('beat_at, note').eq('id', 1).maybeSingle();
  if (error || !data) return { ok: false, supabase: 'unreachable' };
  const b = data as { beat_at: string; note: string | null };
  const hours = Math.round((Date.now() - Date.parse(b.beat_at)) / 3_600_000);
  return { ok: true, supabase: 'ok', lastHeartbeat: b.beat_at, hoursAgo: hours, source: b.note };
}

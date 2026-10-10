import { isHungryReminderDue, hungryKey, tick, sanitize, getItem } from '@kaplya/shared';
import { db } from './db';
import type { Env } from './env';
import { enqueue, flush } from './notify';

/** Cron: дослать уведомления, напомнить о голоде, почистить старое. */
export async function runScheduled(env: Env) {
  const sb = db(env);
  const now = Date.now();

  // 1. Напоминания о голоде (только тем, кто их хочет и кому бот может писать).
  const { data: users, error } = await sb
    .from('users')
    .select('id, last_seen_at, pets(state, ts_ms, inventory(item_id, qty))')
    .eq('notify', true)
    .eq('notify_hunger', true)
    .eq('can_message', true);
  if (error) console.error(`cron: users: ${error.message}`);
  const due: { userId: number; kind: 'hungry'; dedupe: string }[] = [];
  type PetJoin = { state: Record<string, unknown>; ts_ms: number; inventory: { item_id: string; qty: number }[] };
  for (const u of (users ?? []) as unknown as { id: number; last_seen_at: string; pets: PetJoin | PetJoin[] | null }[]) {
    // Связь один-к-одному: PostgREST отдаёт объект, но на всякий случай понимаем и массив.
    const p = Array.isArray(u.pets) ? u.pets[0] : u.pets;
    if (!p) continue;
    const food: Record<string, number> = {};
    for (const i of p.inventory ?? []) if (getItem(i.item_id)?.food) food[i.item_id] = i.qty;
    const pet = tick(sanitize({ ...p.state, ts: p.ts_ms, food }, now), now);
    if (isHungryReminderDue(pet.stats, Date.parse(u.last_seen_at), now)) {
      due.push({ userId: u.id, kind: 'hungry', dedupe: hungryKey(u.id, now) });
    }
  }
  await enqueue(sb, due);

  // 2. Отправка всего, что ждёт (новое, отложенное после 429/сбоя, «зависшее»).
  let sent = 0;
  for (let i = 0; i < 4; i++) {
    const r = await flush(env, sb, undefined, 50);
    sent += r.length;
    if (r.length < 50) break;
  }

  // 3. Храним минимум: отправленные и отменённые старше 30 дней удаляем.
  const monthAgo = new Date(now - 30 * 86_400_000).toISOString();
  await sb.from('notifications').delete().in('status', ['sent', 'skipped', 'dead']).lt('created_at', monthAgo);
  await sb.from('rate_limits').delete().lt('window_start', new Date(now - 86_400_000).toISOString());

  console.log(`cron: hungry=${due.length} processed=${sent}`);
}

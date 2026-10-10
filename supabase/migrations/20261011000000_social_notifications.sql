-- Этап 3: друзья, подарки и надёжные уведомления (outbox).

alter table public.users
  add column can_message    boolean not null default false,  -- бот может писать (start / разрешение)
  add column notify_hunger  boolean not null default true,
  add column notify_social  boolean not null default true,   -- гости, кормление, подарки, новые друзья
  add column notify_game    boolean not null default true;   -- «твой ход»

-- Очередь уведомлений. Событие сначала записывается сюда, потом отправляется.
-- Если отправка не удалась (сеть, 429, падение Worker) — cron досылает.
create table public.notifications (
  id               bigint generated always as identity primary key,
  user_id          bigint not null references public.users (id) on delete cascade,
  kind             text not null,
  payload          jsonb not null default '{}',
  dedupe_key       text unique,                                  -- защита от дублей
  status           text not null default 'pending'
                   check (status in ('pending', 'sending', 'sent', 'dead', 'skipped')),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  locked_until     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index notifications_due_idx on public.notifications (status, next_attempt_at);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, insert, update, delete on public.notifications to service_role;

-- Берёт порцию уведомлений к отправке. «Зависшие» (Worker упал во время отправки)
-- возвращаются в работу, когда истечёт locked_until. skip locked — параллельные
-- вызовы не получат одну и ту же запись.
create function public.claim_notifications(p_limit integer, p_ids bigint[] default null)
returns setof public.notifications
language sql
set search_path = ''
as $$
  update public.notifications n
     set status = 'sending', attempts = n.attempts + 1, locked_until = now() + interval '2 minutes'
   where n.id in (
     select id from public.notifications
      where ((status = 'pending' and next_attempt_at <= now())
          or (status = 'sending' and locked_until < now()))
        and (p_ids is null or id = any (p_ids))
      order by id
      limit p_limit
      for update skip locked)
  returning n.*;
$$;

-- Подарок одной транзакцией: проверки, списание монет, вещь получателю, запись подарка
-- и уведомление в очередь. Либо всё, либо ничего.
create function public.give_gift(
  p_from bigint, p_to bigint, p_item text, p_price integer, p_stack boolean, p_daily integer, p_payload jsonb
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.friendships
                  where user_a = least(p_from, p_to) and user_b = greatest(p_from, p_to)) then
    return 'not_friends';
  end if;
  if not exists (select 1 from public.pets where user_id = p_to) then
    return 'no_pet';
  end if;
  -- Блокируем строку дарителя: параллельные подарки считаются по очереди.
  perform 1 from public.pets where user_id = p_from for update;
  select count(*) into v_count from public.gifts
   where from_user = p_from and created_at > now() - interval '24 hours';
  if v_count >= p_daily then
    return 'gift_limit';
  end if;
  if not p_stack and exists (select 1 from public.inventory where user_id = p_to and item_id = p_item) then
    return 'already_owned';
  end if;

  update public.pets set coins = coins - p_price, version = version + 1, updated_at = now()
   where user_id = p_from and coins >= p_price;
  if not found then
    return 'not_enough_coins';
  end if;

  insert into public.inventory as i (user_id, item_id, qty) values (p_to, p_item, 1)
  on conflict (user_id, item_id) do update set qty = i.qty + 1;
  -- Версия получателя меняется, чтобы его параллельное сохранение перечитало инвентарь.
  update public.pets set version = version + 1, updated_at = now() where user_id = p_to;

  insert into public.gifts (from_user, to_user, item_id) values (p_from, p_to, p_item);
  insert into public.notifications (user_id, kind, payload) values (p_to, 'gift', p_payload);
  return 'ok';
end;
$$;

revoke execute on function public.claim_notifications(integer, bigint[]) from public, anon, authenticated;
revoke execute on function public.give_gift(bigint, bigint, text, integer, boolean, integer, jsonb) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer, bigint[]) to service_role;
grant execute on function public.give_gift(bigint, bigint, text, integer, boolean, integer, jsonb) to service_role;

-- Схема «Капли». Доступ только с сервера (Worker) через service_role.
-- RLS включён везде и политик нет: anon/authenticated не видят ничего,
-- service_role обходит RLS по определению.

-- Пользователи: храним минимум — Telegram ID и имя.
create table public.users (
  id            bigint primary key,                 -- Telegram user id
  first_name    text not null default '',
  lang          text not null default 'ru' check (lang in ('ru', 'en')),
  notify        boolean not null default true,      -- уведомления от бота
  invite_code   text unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- Питомец: показатели, сон и надетые вещи — в state (jsonb), монеты — отдельно.
create table public.pets (
  user_id              bigint primary key references public.users (id) on delete cascade,
  state                jsonb not null,               -- {stats, sleeping, wear}
  coins                integer not null default 0 check (coins >= 0),
  ts_ms                bigint not null,              -- момент, на который посчитаны stats
  version              integer not null default 0,   -- оптимистичная блокировка
  minigame_started_at  bigint,                       -- мс, null — игры нет
  coins_day            date,
  coins_today          integer not null default 0,
  updated_at           timestamptz not null default now()
);

-- Купленные вещи (qty = 1) и еда (qty = количество).
create table public.inventory (
  user_id  bigint not null references public.pets (user_id) on delete cascade,
  item_id  text not null,
  qty      integer not null check (qty > 0),
  primary key (user_id, item_id)
);

-- Дружба хранится одной строкой на пару: user_a < user_b.
create table public.friendships (
  user_a      bigint not null references public.users (id) on delete cascade,
  user_b      bigint not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

-- Партии в крестики-нолики (используются на этапе 4).
create table public.games (
  id          uuid primary key default gen_random_uuid(),
  player_x    bigint not null references public.users (id) on delete cascade,
  player_o    bigint references public.users (id) on delete cascade,
  board       text not null default '.........' check (board ~ '^[.XO]{9}$'),
  turn        char(1) not null default 'X' check (turn in ('X', 'O')),
  status      text not null default 'waiting' check (status in ('waiting', 'playing', 'finished', 'cancelled')),
  winner      char(1) check (winner in ('X', 'O', 'D')),   -- D = ничья
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index games_player_x_idx on public.games (player_x, updated_at desc);
create index games_player_o_idx on public.games (player_o, updated_at desc);

-- Подарки (этап 3).
create table public.gifts (
  id          bigint generated always as identity primary key,
  from_user   bigint not null references public.users (id) on delete cascade,
  to_user     bigint not null references public.users (id) on delete cascade,
  item_id     text not null,
  created_at  timestamptz not null default now()
);
create index gifts_from_day_idx on public.gifts (from_user, created_at desc);

-- «Будильник» против автопаузы (этап 5): одна строка.
create table public.heartbeat (
  id       smallint primary key default 1 check (id = 1),
  beat_at  timestamptz not null default now(),
  note     text
);
insert into public.heartbeat (id, note) values (1, 'init');

-- Простые лимиты запросов: счётчик в окне фиксированной длины.
create table public.rate_limits (
  user_id       bigint not null,
  bucket        text not null,
  window_start  timestamptz not null,
  hits          integer not null,
  primary key (user_id, bucket)
);

-- RLS во всех таблицах, без политик.
alter table public.users        enable row level security;
alter table public.pets         enable row level security;
alter table public.inventory    enable row level security;
alter table public.friendships  enable row level security;
alter table public.games        enable row level security;
alter table public.gifts        enable row level security;
alter table public.heartbeat    enable row level security;
alter table public.rate_limits  enable row level security;

-- Дополнительно: у публичных ролей нет прав на таблицы вовсе.
revoke all on all tables in schema public from anon, authenticated;
-- Серверной роли права выдаём явно (на случай, если в проекте их нет по умолчанию).
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

-- Атомарно сохраняет питомца и инвентарь, если версия не изменилась.
-- Возвращает новую версию или null при конфликте (тогда сервер перечитывает и повторяет).
create function public.save_pet(
  p_user bigint,
  p_version integer,
  p_state jsonb,
  p_coins integer,
  p_ts_ms bigint,
  p_inventory jsonb,               -- {"item_id": qty, ...}
  p_minigame_started_at bigint,
  p_coins_day date,
  p_coins_today integer
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_new integer;
begin
  update public.pets
     set state = p_state,
         coins = p_coins,
         ts_ms = p_ts_ms,
         minigame_started_at = p_minigame_started_at,
         coins_day = p_coins_day,
         coins_today = p_coins_today,
         version = version + 1,
         updated_at = now()
   where user_id = p_user and version = p_version
  returning version into v_new;

  if v_new is null then
    return null;
  end if;

  delete from public.inventory where user_id = p_user;
  insert into public.inventory (user_id, item_id, qty)
  select p_user, key, value::integer
    from jsonb_each_text(p_inventory)
   where value::integer > 0;

  return v_new;
end;
$$;

-- Засчитывает запрос; true — можно, false — лимит исчерпан.
create function public.rate_hit(p_user bigint, p_bucket text, p_limit integer, p_window_sec integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as r (user_id, bucket, window_start, hits)
  values (p_user, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update
     set hits = case when r.window_start < now() - make_interval(secs => p_window_sec) then 1 else r.hits + 1 end,
         window_start = case when r.window_start < now() - make_interval(secs => p_window_sec) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

revoke execute on function public.save_pet(bigint, integer, jsonb, integer, bigint, jsonb, bigint, date, integer) from public, anon, authenticated;
revoke execute on function public.rate_hit(bigint, text, integer, integer) from public, anon, authenticated;
grant execute on function public.save_pet(bigint, integer, jsonb, integer, bigint, jsonb, bigint, date, integer) to service_role;
grant execute on function public.rate_hit(bigint, text, integer, integer) to service_role;

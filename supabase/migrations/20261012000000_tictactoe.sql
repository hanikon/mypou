-- Этап 4: онлайн-партии в крестики-нолики.

alter table public.games
  add column move_no      integer not null default 0,   -- номер хода, защита от гонок
  add column x_seen_at    timestamptz,                   -- когда игрок смотрел партию
  add column o_seen_at    timestamptz,                   --   (не шлём «твой ход», если он и так в игре)
  add column finished_at  timestamptz;

-- Одна активная партия на пару игроков.
create unique index games_active_pair_idx
  on public.games (least(player_x, player_o), greatest(player_x, player_o))
  where status in ('waiting', 'playing');

-- Записывает ход (или сдачу) одной транзакцией: проверка номера хода, награда победителю
-- (не больше p_reward_daily побед в сутки) и уведомление сопернику в очередь.
-- Возвращает 'conflict' или 'ok' / 'ok:<id уведомления>'.
create function public.game_commit(
  p_game uuid,
  p_expected_move integer,
  p_board text,
  p_turn char(1),
  p_status text,
  p_winner char(1),
  p_reward_user bigint,
  p_reward_coins integer,
  p_reward_daily integer,
  p_notify_user bigint,
  p_notify_kind text,
  p_notify_payload jsonb,
  p_notify_key text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_wins integer;
  v_nid bigint;
begin
  update public.games
     set board = p_board,
         turn = p_turn,
         status = p_status,
         winner = p_winner,
         move_no = move_no + 1,
         updated_at = now(),
         finished_at = case when p_status = 'finished' then now() else null end
   where id = p_game and move_no = p_expected_move and status = 'playing';
  if not found then
    return 'conflict';
  end if;

  if p_reward_user is not null and p_reward_coins > 0 then
    select count(*) into v_wins from public.games
     where status = 'finished'
       and finished_at >= date_trunc('day', now())
       and ((winner = 'X' and player_x = p_reward_user) or (winner = 'O' and player_o = p_reward_user));
    if v_wins <= p_reward_daily then
      update public.pets set coins = coins + p_reward_coins, version = version + 1, updated_at = now()
       where user_id = p_reward_user;
    end if;
  end if;

  if p_notify_user is not null then
    insert into public.notifications (user_id, kind, payload, dedupe_key)
    values (p_notify_user, p_notify_kind, p_notify_payload, p_notify_key)
    on conflict (dedupe_key) do nothing
    returning id into v_nid;
  end if;

  return 'ok' || coalesce(':' || v_nid::text, '');
end;
$$;

revoke execute on function public.game_commit(uuid, integer, text, char, text, char, bigint, integer, integer, bigint, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.game_commit(uuid, integer, text, char, text, char, bigint, integer, integer, bigint, text, jsonb, text) to service_role;

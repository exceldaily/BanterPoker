-- =============================================================================
-- Banter Poker - per-game photo avatars, show-hand only after END HAND
-- =============================================================================
-- Avatars are tiny JPEG data URLs (<= 16 KB) stored on the player row for the
-- life of ONE game. No storage bucket, no CDN, nothing permanent: end_game and
-- leave/remove wipe them, and they are never copied anywhere else.
--
-- Showing a hand is now only possible once the dealer has ended the hand, so a
-- player can never accidentally expose cards while the hand is still live.
-- =============================================================================

alter table banterpoker.players add column if not exists avatar_data text;

alter table banterpoker.players
  add constraint players_avatar_size check (avatar_data is null or (char_length(avatar_data) <= 16384 and avatar_data like 'data:image/jpeg;base64,%'));

create or replace function banterpoker.set_avatar(p_device_id uuid, p_secret text, p_game_id uuid, p_avatar text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m banterpoker.game_devices;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  perform banterpoker.check_rate('avatar:' || p_device_id::text, 30, 600);
  perform banterpoker.lock_game(p_game_id);
  m := banterpoker.require_member(p_game_id, p_device_id);
  if m.player_id is null then
    perform banterpoker.fail('NOT_A_PLAYER');
  end if;
  if p_avatar is not null and (char_length(p_avatar) > 16384 or p_avatar not like 'data:image/jpeg;base64,%') then
    perform banterpoker.fail('AVATAR_INVALID');
  end if;
  update banterpoker.players set avatar_data = p_avatar where id = m.player_id;
  perform banterpoker.log_event(p_game_id, case when p_avatar is null then 'AVATAR_REMOVED' else 'AVATAR_SET' end, p_device_id, null, jsonb_build_object('playerId', m.player_id));
  perform banterpoker.touch_game(p_game_id, 'avatar');
end;
$$;

revoke execute on function banterpoker.set_avatar(uuid, text, uuid, text) from public;
grant execute on function banterpoker.set_avatar(uuid, text, uuid, text) to anon, authenticated;

-- public_snapshot: include the avatar per player.
create or replace function banterpoker.public_snapshot(p_game_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  g    banterpoker.games;
  h    banterpoker.hands;
  out_json jsonb;
  players_json jsonb;
  levels_json jsonb;
  hand_json jsonb;
  remaining int;
  folded int;
begin
  select * into g from banterpoker.games where id = p_game_id;
  if g.id is null then
    return null;
  end if;

  if g.current_hand_id is not null then
    select * into h from banterpoker.hands where id = g.current_hand_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.display_name,
      'seat', p.seat_number,
      'status', p.status,
      'isHost', exists (select 1 from banterpoker.game_devices gd where gd.player_id = p.id and gd.is_host and gd.revoked_at is null),
      'hasDevice', p.device_id is not null,
      'lastSeenAt', (select max(gd.last_seen_at) from banterpoker.game_devices gd where gd.player_id = p.id and gd.revoked_at is null),
      'handStatus', hp.status,
      'shownCards', case when hp.status = 'shown' then jsonb_build_array(hp.card_1, hp.card_2) else null end,
      'avatar', p.avatar_data
    ) order by p.seat_number nulls last, p.joined_at), '[]'::jsonb)
    into players_json
    from banterpoker.players p
    left join banterpoker.hand_players hp on hp.player_id = p.id and hp.hand_id = g.current_hand_id
   where p.game_id = g.id and p.status <> 'removed';

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'sortOrder', l.sort_order,
      'type', l.level_type,
      'smallBlind', l.small_blind,
      'bigBlind', l.big_blind,
      'ante', l.ante,
      'anteType', l.ante_type,
      'durationSeconds', l.duration_seconds
    ) order by l.sort_order), '[]'::jsonb)
    into levels_json
    from banterpoker.tournament_levels l where l.game_id = g.id;

  if h.id is not null then
    select count(*) filter (where hp.status in ('in_hand', 'shown', 'mucked')),
           count(*) filter (where hp.status = 'folded')
      into remaining, folded
      from banterpoker.hand_players hp where hp.hand_id = h.id;
    hand_json := jsonb_build_object(
      'id', h.id,
      'number', h.hand_number,
      'state', h.state,
      'dealerSeat', h.dealer_seat,
      'smallBlindSeat', h.small_blind_seat,
      'bigBlindSeat', h.big_blind_seat,
      'board', to_jsonb(h.board),
      'playersDealtIn', h.players_dealt_in,
      'playersRemaining', remaining,
      'playersFolded', folded,
      'createdAt', h.created_at,
      'completedAt', h.completed_at
    );
  else
    hand_json := null;
  end if;

  out_json := jsonb_build_object(
    'game', jsonb_build_object(
      'id', g.id,
      'tableName', g.table_name,
      'status', g.status,
      'maxSeats', g.max_seats,
      'seatingLocked', g.seating_locked,
      'allowLateEntry', g.allow_late_entry,
      'autoAdvanceLevels', g.auto_advance_levels,
      'advanceAfterHand', g.advance_after_hand,
      'allowStructureEdits', g.allow_structure_edits,
      'soundsEnabled', g.sounds_enabled,
      'hapticsEnabled', g.haptics_enabled,
      'timerAlertsEnabled', g.timer_alerts_enabled,
      'timerMode', g.timer_mode,
      'casual', jsonb_build_object(
        'smallBlind', g.casual_small_blind, 'bigBlind', g.casual_big_blind,
        'ante', g.casual_ante, 'anteType', g.casual_ante_type),
      'handCount', g.hand_count,
      'dealerSeat', g.dealer_seat,
      'winnerPlayerId', g.winner_player_id,
      'startedAt', g.started_at,
      'endedAt', g.ended_at,
      'version', g.version
    ),
    'players', players_json,
    'hand', hand_json,
    'tournament', jsonb_build_object(
      'levels', levels_json,
      'currentLevelId', g.current_level_id,
      'timerStatus', g.timer_status,
      'levelStartedAt', g.level_started_at,
      'pausedAt', g.level_paused_at,
      'remainingAtPause', g.level_remaining_at_pause,
      'remainingSeconds', floor(banterpoker.remaining_seconds(g)),
      'pendingAdvance', g.level_pending_advance,
      'serverNow', clock_timestamp()
    )
  );
  return out_json;
end;
$$;

-- show_hand: only after the dealer has ended the hand.
create or replace function banterpoker.show_hand(p_device_id uuid, p_secret text, p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g  banterpoker.games;
  m  banterpoker.game_devices;
  hp banterpoker.hand_players;
  h  banterpoker.hands;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  m := banterpoker.require_member(p_game_id, p_device_id);
  if m.player_id is null then
    perform banterpoker.fail('NOT_A_PLAYER');
  end if;
  select * into h from banterpoker.hands where id = g.current_hand_id;
  if h.id is null then
    perform banterpoker.fail('NO_HAND');
  end if;
  if h.state <> 'complete' then
    perform banterpoker.fail('HAND_IN_PROGRESS');
  end if;
  select * into hp from banterpoker.hand_players where hand_id = h.id and player_id = m.player_id for update;
  if hp.id is null then
    perform banterpoker.fail('NOT_IN_HAND');
  end if;
  if hp.status = 'folded' then
    perform banterpoker.fail('ALREADY_FOLDED');
  end if;
  if hp.status = 'shown' then
    return;
  end if;
  update banterpoker.hand_players set status = 'shown', shown_at = now() where id = hp.id;
  perform banterpoker.log_event(p_game_id, 'HAND_SHOWN', p_device_id, h.id, jsonb_build_object('playerId', m.player_id, 'seat', hp.seat_number));
  perform banterpoker.touch_game(p_game_id, 'shown');
end;
$$;

-- end_game: wipe every avatar for the game.
create or replace function banterpoker.end_game(p_device_id uuid, p_secret text, p_game_id uuid, p_winner_player_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  perform banterpoker.require_host(p_game_id, p_device_id);
  if g.status = 'complete' then
    return jsonb_build_object('alreadyEnded', true);
  end if;
  if p_winner_player_id is not null and not exists (select 1 from banterpoker.players where id = p_winner_player_id and game_id = p_game_id) then
    perform banterpoker.fail('PLAYER_NOT_FOUND');
  end if;
  update banterpoker.hands set state = 'complete', completed_at = now() where id = g.current_hand_id and state <> 'complete';
  update banterpoker.players set avatar_data = null where game_id = p_game_id;
  update banterpoker.games
     set status = 'complete', ended_at = now(), winner_player_id = p_winner_player_id,
         timer_status = case when timer_status = 'running' then 'paused' else timer_status end,
         level_remaining_at_pause = case when timer_status = 'running' then ceil(banterpoker.remaining_seconds(g)) else level_remaining_at_pause end
   where id = p_game_id;
  perform banterpoker.log_event(p_game_id, 'GAME_ENDED', p_device_id, null, jsonb_build_object('winnerPlayerId', p_winner_player_id, 'hands', g.hand_count));
  perform banterpoker.touch_game(p_game_id, 'game_ended');
  return jsonb_build_object('ended', true);
end;
$$;

-- Removed / departed players lose their photo immediately.
create or replace function banterpoker.leave_game(p_device_id uuid, p_secret text, p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g banterpoker.games;
  m banterpoker.game_devices;
begin
  perform banterpoker.auth_device(p_device_id, p_secret);
  g := banterpoker.lock_game(p_game_id);
  m := banterpoker.membership(p_game_id, p_device_id);
  if m.id is null then
    return;
  end if;
  if m.is_host then
    perform banterpoker.fail('HOST_CANNOT_LEAVE');
  end if;
  update banterpoker.game_devices set revoked_at = now() where id = m.id;
  if m.player_id is not null then
    update banterpoker.players set status = 'removed', seat_number = null, avatar_data = null where id = m.player_id;
  end if;
  perform banterpoker.log_event(p_game_id, 'PLAYER_LEFT', p_device_id, null, jsonb_build_object('playerId', m.player_id));
  perform banterpoker.touch_game(p_game_id, 'left');
end;
$$;

-- A player removed by the host loses their photo too.
create or replace function banterpoker.clear_avatar_on_remove()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'removed' then
    new.avatar_data := null;
  end if;
  return new;
end;
$$;

drop trigger if exists players_clear_avatar_on_remove on banterpoker.players;
create trigger players_clear_avatar_on_remove before update of status on banterpoker.players
  for each row execute function banterpoker.clear_avatar_on_remove();

-- Safety net: any avatar older than a day on an unfinished game is dropped
-- the next time that game is touched (touch_game runs on every mutation).
create or replace function banterpoker.touch_game(p_game_id uuid, p_reason text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  snap jsonb;
begin
  update banterpoker.players set avatar_data = null
   where game_id = p_game_id and avatar_data is not null and joined_at < now() - interval '36 hours';
  update banterpoker.games set version = version + 1 where id = p_game_id;
  snap := banterpoker.public_snapshot(p_game_id);
  perform realtime.send(
    snap || jsonb_build_object('reason', p_reason),
    'snapshot',
    'game:' || p_game_id::text,
    false
  );
end;
$$;

-- =============================================================================
-- Banter Poker - avatar safety net keyed on the GAME's age, not the player's
-- =============================================================================
-- 0009 dropped photos when a player had joined more than 36 hours earlier,
-- which also wiped a photo the moment it was set on any long-lived table.
-- Photos now survive for the life of the game and are only swept once a game
-- is more than three days old (no home game runs that long); end_game, leave
-- and remove still wipe them immediately.
-- =============================================================================

create or replace function banterpoker.touch_game(p_game_id uuid, p_reason text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  snap jsonb;
begin
  update banterpoker.players p set avatar_data = null
    from banterpoker.games g
   where g.id = p_game_id and p.game_id = g.id and p.avatar_data is not null
     and (g.status = 'complete' or g.created_at < now() - interval '3 days');
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

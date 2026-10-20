-- Existing installations: run this file ONLY; never re-run 001_lamma.sql.
-- Additive, transactional and safe to re-run. No player/round data is deleted.
begin;
alter table private.rooms add column if not exists timer_enabled boolean not null default true;
alter table private.rooms add column if not exists timer_paused boolean not null default false;
alter table private.rooms add column if not exists timer_remaining integer;
alter table private.rooms add column if not exists vote_seconds integer not null default 60;

-- Retain the original audited game rules behind private wrappers.
do $$ begin
  if to_regprocedure('private.game_action_v1(text,text,text,uuid,integer,integer)') is null then
    alter function public.game_action(text,text,text,uuid,integer,integer) set schema private;
    alter function private.game_action(text,text,text,uuid,integer,integer) rename to game_action_v1;
  end if;
  if to_regprocedure('private.room_state_v1(uuid,uuid)') is null then
    alter function private.room_state(uuid,uuid) rename to room_state_v1;
  end if;
end $$;
revoke all on function private.game_action_v1(text,text,text,uuid,integer,integer) from public,anon,authenticated;
revoke all on function private.room_state_v1(uuid,uuid) from public,anon,authenticated;

create or replace function private.room_state(p_room uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; base jsonb;
begin
  base := private.room_state_v1(p_room,p_user);
  select * into r from private.rooms where id=p_room;
  return base || jsonb_build_object('timer_version',2,'timer',jsonb_build_object(
    'enabled',r.timer_enabled,'paused',r.timer_paused,
    'remaining_seconds',r.timer_remaining,
    'duration_seconds',case when r.phase='vote' then r.vote_seconds else r.discussion_seconds end));
end $$;
revoke all on function private.room_state(uuid,uuid) from public,anon,authenticated;

create or replace function public.game_action(
  p_action text, p_code text default '', p_name text default null,
  p_target uuid default null, p_round integer default null, p_seconds integer default 120
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r private.rooms; updated private.rooms; me private.players;
  answer jsonb; seconds_left integer; active boolean;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action='create' then
    return private.game_action_v1(p_action,p_code,p_name,p_target,p_round,p_seconds);
  end if;
  select * into r from private.rooms where code=upper(trim(p_code)) and expires_at>now() for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;

  if p_action like 'timer_%' then
    select * into me from private.players where room_id=r.id and user_id=uid;
    if me.id is null then raise exception 'NOT_MEMBER'; end if;
    if me.id<>r.host_id then raise exception 'HOST_ONLY'; end if;
    if p_round is distinct from r.round_no then raise exception 'STALE_ROUND'; end if;
    -- A delayed discussion control must not alter the voting clock.
    if p_name is distinct from r.phase then raise exception 'STALE_PHASE'; end if;
    if p_action not in ('timer_enable','timer_disable','timer_pause','timer_resume','timer_reset','timer_set') then
      raise exception 'ACTION_INVALID';
    end if;
    -- Once a voting deadline has elapsed, it cannot be extended or disabled.
    if r.phase='vote' and r.deadline<=now() then
      return public.game_action('state',p_code,null,null,null,120);
    end if;
    active := r.phase in ('discuss','vote');
    seconds_left := case when r.phase='vote' then r.vote_seconds else r.discussion_seconds end;
    case p_action
    when 'timer_disable' then
      update private.rooms set timer_enabled=false,timer_paused=false,timer_remaining=null,deadline=null where id=r.id;
    when 'timer_enable' then
      if r.timer_enabled then return private.room_state(r.id,uid); end if;
      update private.rooms set timer_enabled=true,timer_paused=false,timer_remaining=null,
        deadline=case when active then now()+make_interval(secs=>seconds_left) else null end where id=r.id;
    when 'timer_pause' then
      if not active or not r.timer_enabled then raise exception 'WRONG_PHASE'; end if;
      if r.timer_paused then return private.room_state(r.id,uid); end if;
      seconds_left := greatest(0,ceil(extract(epoch from r.deadline-now()))::integer);
      if seconds_left=0 then raise exception 'TIMER_FINISHED'; end if;
      update private.rooms set timer_paused=true,timer_remaining=seconds_left,deadline=null where id=r.id;
    when 'timer_resume' then
      if not active or not r.timer_enabled then raise exception 'WRONG_PHASE'; end if;
      if not r.timer_paused then return private.room_state(r.id,uid); end if;
      update private.rooms set timer_paused=false,timer_remaining=null,
        deadline=now()+make_interval(secs=>r.timer_remaining) where id=r.id;
    when 'timer_reset' then
      if not active then raise exception 'WRONG_PHASE'; end if;
      update private.rooms set timer_enabled=true,timer_paused=false,timer_remaining=null,
        deadline=now()+make_interval(secs=>seconds_left) where id=r.id;
    when 'timer_set' then
      if p_seconds is null or p_seconds<15 or p_seconds>900 then raise exception 'INVALID_SECONDS'; end if;
      update private.rooms set
        discussion_seconds=case when r.phase<>'vote' then p_seconds else discussion_seconds end,
        vote_seconds=case when r.phase='vote' then p_seconds else vote_seconds end,
        timer_remaining=case when active and r.timer_paused then p_seconds else null end,
        deadline=case when active and r.timer_enabled and not r.timer_paused then now()+make_interval(secs=>p_seconds) else null end
        where id=r.id;
    end case;
    update private.players set last_seen=now() where id=me.id;
    perform private.touch(r.id);
    return private.room_state(r.id,uid);
  end if;

  -- The original function still performs all membership, host and round checks.
  answer := private.game_action_v1(p_action,p_code,p_name,p_target,p_round,p_seconds);
  if p_action in ('role','leave') then return answer; end if;
  select * into updated from private.rooms where id=r.id;
  if updated.phase is distinct from r.phase or updated.round_no<>r.round_no then
    update private.rooms set timer_paused=false,timer_remaining=null,
      deadline=case
        when timer_enabled and phase='discuss' then now()+make_interval(secs=>discussion_seconds)
        when timer_enabled and phase='vote' then now()+make_interval(secs=>vote_seconds)
        else null end
      where id=r.id;
  end if;
  return private.room_state(r.id,uid);
end $$;
revoke all on function public.game_action(text,text,text,uuid,integer,integer) from public,anon;
grant execute on function public.game_action(text,text,text,uuid,integer,integer) to authenticated;
notify pgrst, 'reload schema';
commit;

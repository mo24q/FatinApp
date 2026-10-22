-- Apply after 006. Repeatable; no player/room records are deleted.
begin;
create or replace function private.mafia_state(p_room uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; me private.players; g jsonb; members jsonb; participants jsonb;
begin
  select * into r from private.rooms where id=p_room and game_key='mafia' and expires_at>now();
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into me from private.players where room_id=r.id and user_id=p_user;
  if me.id is null then raise exception 'NOT_MEMBER'; end if;
  select data into g from private.mafia_sessions where room_id=r.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'online',last_seen>now()-interval '60 seconds','alive',true,'done',false,'role',null) order by joined_at,id),'[]') into members from private.players where room_id=r.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p->>'id','name',p->>'name','alive',(p->>'alive')::boolean,
    'online',exists(select 1 from private.players where id=(p->>'id')::uuid and room_id=r.id and last_seen>now()-interval '60 seconds'),
    'done',case g->>'phase' when 'reveal' then g->'ready' ? (p->>'id') when 'night' then coalesce(g->'night_ready','[]'::jsonb) ? (p->>'id') when 'vote' then g->'votes' ? (p->>'id') else false end,
    'role',case when g->>'phase'='result' or p->>'id'=g->>'narrator_id' or coalesce((g->'config'->>'reveal')::boolean,false) and not (p->>'alive')::boolean then g->'roles'->>(p->>'id') else null end
  ) order by ord),'[]') into participants from jsonb_array_elements(g->'players') with ordinality as a(p,ord);
  return jsonb_build_object('game','mafia','id',r.id,'code',r.code,'round',r.round_no,
    'revision',(select revision from public.room_events where room_id=r.id),'step',coalesce((g->>'step')::integer,0),
    'cycle',coalesce((g->>'cycle')::integer,1),'phase',coalesce(g->>'phase','lobby'),
    'me',me.id,'is_host',me.id=r.host_id,'host_offline',not exists(select 1 from private.players where id=r.host_id and last_seen>now()-interval '60 seconds'),
    'narrator_id',g->>'narrator_id','members',members,'players',case when g is null then members else participants end,
    'config',coalesce(g->'config',jsonb_build_object('moderator',false,'mafia',1,'doctor',true,'detective',true,'reveal',false)),
    'log',coalesce(g->'log','[]'),'winner',g->>'winner','server_time',now(),'deadline',g->>'deadline',
    'timer',coalesce(g->'timer',jsonb_build_object('enabled',false,'paused',false,'remaining_seconds',null,'duration_seconds',180)));
end $$;
revoke all on function private.mafia_state(uuid,uuid) from public,anon,authenticated;

create or replace function public.mafia_action(p_action text,p_code text default '',p_round integer default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r private.rooms; me private.players; g jsonb; answer jsonb;
  actor text; target text; narrator text; role_name text; old_phase text; item record;
  config jsonb; roles jsonb:='{}'; roster jsonb:='[]'; deck text[]:='{}'; idx integer:=1;
  total integer; mafias integer; doctor boolean; detective boolean; reveal_roles boolean; moderator boolean; complete boolean;
  victim text; saved text; inspected text; detective_id text; doctor_id text;
  highest integer; tied integer; tally jsonb; alive_count integer; mafia_count integer;
  timer jsonb; duration integer; remaining integer; deadline timestamptz;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4096 then raise exception 'INVALID_PAYLOAD'; end if;
  if p_action='create' then
    answer:=private.game_action_v1('create','',p_payload->>'name',null,null,180);
    update private.rooms set game_key='mafia',timer_enabled=false where id=(answer->>'id')::uuid returning * into r;
    return private.mafia_state(r.id,uid);
  end if;
  if p_action='join' then perform pg_advisory_xact_lock(hashtextextended(uid::text,0)); end if;
  select * into r from private.rooms where code=upper(trim(p_code)) and expires_at>now() for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.game_key<>'mafia' then raise exception 'WRONG_GAME'; end if;
  if p_action='join' then
    perform private.game_action_v1('join',r.code,p_payload->>'name',null,null,180);
    return private.mafia_state(r.id,uid);
  end if;
  select * into me from private.players where room_id=r.id and user_id=uid;
  if me.id is null then raise exception 'NOT_MEMBER'; end if;
  actor:=me.id::text;
  update private.players set last_seen=now() where id=me.id;
  select data into g from private.mafia_sessions where room_id=r.id;
  if p_action='state' then
    if g->>'narrator_id' is null and g->>'phase'='day' and (g->>'deadline')::timestamptz<=now() then
      return public.mafia_action('open_vote',r.code,r.round_no,jsonb_build_object('step',g->'step'));
    end if;
    return private.mafia_state(r.id,uid);
  end if;
  if p_round is distinct from r.round_no then raise exception 'STALE_ROUND'; end if;
  if (p_payload->>'step')::integer is distinct from coalesce((g->>'step')::integer,0) then raise exception 'STALE_PHASE'; end if;
  role_name:=g->'roles'->>actor;old_phase:=g->>'phase';narrator:=g->>'narrator_id';
  if p_action='role' then
    if g is null or role_name is null then raise exception 'NOT_MEMBER'; end if;
    return jsonb_build_object('role',role_name,
      'allies',case when role_name='mafia' then (select coalesce(jsonb_agg(key),'[]') from jsonb_each_text(g->'roles') where value='mafia' and key<>actor) else '[]'::jsonb end,
      'roles',case when role_name='narrator' then g->'roles' else null end,
      'actions',case when role_name='narrator' then g->'actions' when role_name='mafia' then (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each_text(g->'actions') where g->'roles'->>key='mafia') else null end,
      'scans',case when role_name='detective' then g->'scans' else '[]'::jsonb end,
      'last_save',case when role_name='doctor' then g->>'last_save' else null end,
      'choice',case when old_phase='vote' then g->'votes'->>actor else g->'actions'->>actor end);
  end if;
  if p_action in ('claim_host','remove','leave') then
    if p_action='remove' and me.id<>r.host_id then raise exception 'HOST_ONLY'; end if;
    answer:=private.game_action_v1(p_action,r.code,null,(p_payload->>'target')::uuid,r.round_no,180);
    if p_action='leave' then return answer; end if;
    return private.mafia_state(r.id,uid);
  end if;
  if p_action in ('start','cancel') and me.id<>r.host_id then raise exception 'HOST_ONLY'; end if;
  if p_action='cancel' then
    delete from private.mafia_sessions where room_id=r.id;
    update private.rooms set phase='lobby',deadline=null where id=r.id;
    perform private.touch(r.id);return private.mafia_state(r.id,uid);
  end if;
  if p_action='start' then
    if r.phase not in ('lobby','result') then raise exception 'WRONG_PHASE'; end if;
    select count(*) into total from private.players where room_id=r.id;
    if exists(select 1 from private.players where room_id=r.id and last_seen<=now()-interval '60 seconds') then raise exception 'PLAYER_OFFLINE'; end if;
    config:=p_payload->'config';
    if config is null or jsonb_typeof(config)<>'object' or jsonb_typeof(config->'moderator') is distinct from 'boolean' or jsonb_typeof(config->'mafia') is distinct from 'number' or jsonb_typeof(config->'doctor') is distinct from 'boolean' or jsonb_typeof(config->'detective') is distinct from 'boolean' or jsonb_typeof(config->'reveal') is distinct from 'boolean' then raise exception 'MAFIA_CONFIG'; end if;
    moderator:=(config->>'moderator')::boolean;
    if total<(case when moderator then 6 else 5 end) or total>12 then raise exception 'MAFIA_NEED_PLAYERS'; end if;
    narrator:=case when moderator then p_payload->>'narrator' else null end;
    if moderator and (narrator is null or not exists(select 1 from private.players where room_id=r.id and id::text=narrator)) then raise exception 'INVALID_NARRATOR'; end if;
    if (config->>'mafia')::numeric<>trunc((config->>'mafia')::numeric) then raise exception 'MAFIA_CONFIG'; end if;
    mafias:=(config->>'mafia')::integer;doctor:=(config->>'doctor')::boolean;detective:=(config->>'detective')::boolean;reveal_roles:=(config->>'reveal')::boolean;
    if mafias<1 or mafias>(total-(case when moderator then 1 else 0 end))/3 then raise exception 'MAFIA_CONFIG'; end if;
    for idx in 1..mafias loop deck:=array_append(deck,'mafia');end loop;
    if doctor then deck:=array_append(deck,'doctor');end if;
    if detective then deck:=array_append(deck,'detective');end if;
    while cardinality(deck)<total-(case when moderator then 1 else 0 end) loop deck:=array_append(deck,'citizen');end loop;
    idx:=1;
    for item in select id from private.players where room_id=r.id and (narrator is null or id::text<>narrator) order by gen_random_uuid() loop
      roles:=roles||jsonb_build_object(item.id::text,deck[idx]);idx:=idx+1;
    end loop;
    if narrator is not null then roles:=roles||jsonb_build_object(narrator,'narrator');end if;
    select jsonb_agg(jsonb_build_object('id',id,'name',name,'alive',narrator is null or id::text<>narrator) order by joined_at,id) into roster from private.players where room_id=r.id;
    timer:=coalesce(g->'timer',jsonb_build_object('enabled',true,'paused',false,'remaining_seconds',null,'duration_seconds',180));
    g:=jsonb_build_object('phase','reveal','step',1,'cycle',1,'narrator_id',narrator,'players',roster,'roles',roles,'config',config,
      'ready','[]'::jsonb,'night_ready','[]'::jsonb,'actions','{}'::jsonb,'votes','{}'::jsonb,'scans','[]'::jsonb,'last_save',null,'winner',null,'log','[]'::jsonb,
      'timer',timer||jsonb_build_object('paused',false,'remaining_seconds',null),'deadline',null);
    update private.rooms set round_no=round_no+1,phase='reveal',deadline=null where id=r.id;
    insert into private.mafia_sessions values(r.id,g) on conflict(room_id) do update set data=excluded.data;
    perform private.touch(r.id);return private.mafia_state(r.id,uid);
  end if;
  if g is null or role_name is null then raise exception 'WRONG_PHASE'; end if;
  if p_action in ('begin','resolve_night','open_vote','resolve_vote') then
    if narrator is not null then
      if actor<>narrator then raise exception 'NARRATOR_ONLY';end if;
    else
      complete:=case p_action
        when 'begin' then jsonb_array_length(g->'ready')=jsonb_array_length(g->'players')
        when 'resolve_night' then not exists(select 1 from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and not(coalesce(g->'night_ready','[]'::jsonb) ? (p->>'id')))
        when 'resolve_vote' then not exists(select 1 from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and not(g->'votes' ? (p->>'id')))
        when 'open_vote' then coalesce((g->>'deadline')::timestamptz<=now(),false) else false end;
      if not complete and me.id<>r.host_id then raise exception 'HOST_ONLY';end if;
      if coalesce((p_payload->>'force')::boolean,false) and me.id<>r.host_id then raise exception 'HOST_ONLY';end if;
    end if;
  end if;
  target:=coalesce(p_payload->>'target','skip');
  case p_action
  when 'ready' then
    if old_phase<>'reveal' then raise exception 'WRONG_PHASE'; end if;
    if not (g->'ready' ? actor) then g:=jsonb_set(g,'{ready}',g->'ready'||to_jsonb(actor));end if;
  when 'begin' then
    if old_phase<>'reveal' then raise exception 'WRONG_PHASE'; end if;
    if jsonb_array_length(g->'ready')<>jsonb_array_length(g->'players') then raise exception 'NOT_READY';end if;
    g:=g||jsonb_build_object('phase','night');
  when 'night_action' then
    if old_phase<>'night' then raise exception 'WRONG_PHASE'; end if;
    if not exists(select 1 from jsonb_array_elements(g->'players') p where p->>'id'=actor and (p->>'alive')::boolean) then raise exception 'ELIMINATED';end if;
    if target<>'skip' then
      if not exists(select 1 from jsonb_array_elements(g->'players') p where p->>'id'=target and (p->>'alive')::boolean) then raise exception 'INVALID_TARGET';end if;
      if role_name in ('narrator','citizen') or role_name='mafia' and g->'roles'->>target='mafia' or role_name='detective' and target=actor or role_name='doctor' and target=g->>'last_save' then raise exception 'INVALID_TARGET';end if;
    end if;
    if g->'actions' ? actor then
      if g->'actions'->>actor=target then return private.mafia_state(r.id,uid);end if;
      raise exception 'ACTION_LOCKED';
    end if;
    g:=jsonb_set(g,array['actions',actor],to_jsonb(target));
    if role_name='detective' and target<>'skip' then
      g:=jsonb_set(g,'{scans}',g->'scans'||jsonb_build_array(jsonb_build_object('cycle',g->'cycle','target',target,'mafia',g->'roles'->>target='mafia')));
    end if;
  when 'night_ready' then
    if old_phase<>'night' then raise exception 'WRONG_PHASE';end if;
    if not exists(select 1 from jsonb_array_elements(g->'players') p where p->>'id'=actor and (p->>'alive')::boolean) then raise exception 'ELIMINATED';end if;
    if not(g->'actions' ? actor) then raise exception 'NOT_READY';end if;
    if not(coalesce(g->'night_ready','[]'::jsonb) ? actor) then
      g:=jsonb_set(g,'{night_ready}',coalesce(g->'night_ready','[]'::jsonb)||jsonb_build_array(actor));
    end if;
  when 'resolve_night' then
    if old_phase<>'night' then raise exception 'WRONG_PHASE'; end if;
    if not coalesce((p_payload->>'force')::boolean,false) and exists(select 1 from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and not(coalesce(g->'night_ready','[]'::jsonb) ? (p->>'id'))) then raise exception 'WAIT_ACTIONS';end if;
    select jsonb_object_agg(choice,n) into tally from (select coalesce(g->'actions'->>(p->>'id'),'skip') choice,count(*) n from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and g->'roles'->>(p->>'id')='mafia' group by 1) q;
    select max(value::integer) into highest from jsonb_each_text(tally) where key<>'skip';
    select key into victim from jsonb_each_text(tally) where key<>'skip' and value::integer=highest order by gen_random_uuid() limit 1;
    select p->>'id' into doctor_id from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and g->'roles'->>(p->>'id')='doctor';
    saved:=nullif(g->'actions'->>doctor_id,'skip');
    if victim=saved then victim:=null;end if;
    g:=g||jsonb_build_object('last_save',saved);
    g:=g||jsonb_build_object('phase','day','actions','{}'::jsonb,'night_ready','[]'::jsonb,'log',g->'log'||jsonb_build_array(jsonb_build_object('cycle',g->'cycle','kind','night','eliminated',victim)));
  when 'open_vote' then
    if old_phase<>'day' then raise exception 'WRONG_PHASE'; end if;
    g:=g||jsonb_build_object('phase','vote','votes','{}'::jsonb);
  when 'vote' then
    if old_phase<>'vote' then raise exception 'WRONG_PHASE'; end if;
    if not exists(select 1 from jsonb_array_elements(g->'players') p where p->>'id'=actor and (p->>'alive')::boolean) then raise exception 'ELIMINATED';end if;
    if g->'votes' ? actor then
      if g->'votes'->>actor=target then return private.mafia_state(r.id,uid);end if;
      raise exception 'ALREADY_VOTED';
    end if;
    if target<>'skip' and (target=actor or not exists(select 1 from jsonb_array_elements(g->'players') p where p->>'id'=target and (p->>'alive')::boolean)) then raise exception 'INVALID_TARGET';end if;
    g:=jsonb_set(g,array['votes',actor],to_jsonb(target));
  when 'resolve_vote' then
    if old_phase<>'vote' then raise exception 'WRONG_PHASE'; end if;
    if not coalesce((p_payload->>'force')::boolean,false) and exists(select 1 from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and not(g->'votes' ? (p->>'id'))) then raise exception 'WAIT_ACTIONS';end if;
    select jsonb_object_agg(choice,n) into tally from (select coalesce(g->'votes'->>(p->>'id'),'skip') choice,count(*) n from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean group by 1) q;
    select max(value::integer) into highest from jsonb_each_text(tally);
    select count(*),min(key) into tied,victim from jsonb_each_text(tally) where value::integer=highest;
    if tied<>1 or victim='skip' then victim:=null;end if;
    g:=g||jsonb_build_object('phase','night','cycle',(g->>'cycle')::integer+1,'actions','{}'::jsonb,'night_ready','[]'::jsonb,'votes','{}'::jsonb,
      'log',g->'log'||jsonb_build_array(jsonb_build_object('cycle',g->'cycle','kind','vote','eliminated',victim,'tally',tally)));
  else
    if p_action not in ('timer_enable','timer_disable','timer_pause','timer_resume','timer_reset','timer_set') then raise exception 'ACTION_INVALID';end if;
    if me.id<>r.host_id and actor is distinct from narrator then raise exception 'HOST_ONLY';end if;
    if old_phase<>'day' then raise exception 'WRONG_PHASE';end if;
    timer:=g->'timer';duration:=(timer->>'duration_seconds')::integer;deadline:=(g->>'deadline')::timestamptz;
    remaining:=case when (timer->>'paused')::boolean then (timer->>'remaining_seconds')::integer when deadline is not null then greatest(0,ceil(extract(epoch from deadline-now()))::integer) else duration end;
    case p_action
    when 'timer_disable' then timer:=timer||jsonb_build_object('enabled',false,'paused',false,'remaining_seconds',null);deadline:=null;
    when 'timer_pause' then if (timer->>'enabled')::boolean and not (timer->>'paused')::boolean then timer:=timer||jsonb_build_object('paused',true,'remaining_seconds',remaining);deadline:=null;end if;
    when 'timer_resume' then if (timer->>'enabled')::boolean and (timer->>'paused')::boolean then timer:=timer||jsonb_build_object('paused',false,'remaining_seconds',null);deadline:=now()+make_interval(secs=>remaining);end if;
    when 'timer_set' then
      duration:=(p_payload->>'seconds')::integer;if duration is null or duration not between 15 and 900 then raise exception 'INVALID_SECONDS';end if;
      timer:=timer||jsonb_build_object('duration_seconds',duration);
      if (timer->>'paused')::boolean then timer:=timer||jsonb_build_object('remaining_seconds',duration);elsif (timer->>'enabled')::boolean then deadline:=now()+make_interval(secs=>duration);end if;
    else timer:=timer||jsonb_build_object('enabled',true,'paused',false,'remaining_seconds',null);deadline:=now()+make_interval(secs=>duration);
    end case;
    g:=g||jsonb_build_object('timer',timer,'deadline',deadline);
  end case;
  if p_action in ('resolve_night','resolve_vote') then
    if victim is not null then
      select jsonb_agg(case when p->>'id'=victim then p||jsonb_build_object('alive',false) else p end order by ord) into roster from jsonb_array_elements(g->'players') with ordinality as a(p,ord);
      g:=jsonb_set(g,'{players}',roster);
    end if;
    select count(*),count(*) filter(where g->'roles'->>(p->>'id')='mafia') into alive_count,mafia_count from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean;
    if mafia_count=0 then g:=g||jsonb_build_object('winner','town','phase','result');elsif mafia_count>=alive_count-mafia_count then g:=g||jsonb_build_object('winner','mafia','phase','result');end if;
  end if;
  if g->>'phase'<>old_phase then
    g:=g||jsonb_build_object('step',(g->>'step')::integer+1,
      'timer',g->'timer'||jsonb_build_object('paused',false,'remaining_seconds',null),
      'deadline',case when (g->'timer'->>'enabled')::boolean and g->>'phase'='day' then now()+make_interval(secs=>(g->'timer'->>'duration_seconds')::integer) else null end);
  end if;
  update private.mafia_sessions set data=g where room_id=r.id;
  -- Legacy room deadlines stay null; Mafia owns its discussion timer.
  update private.rooms set phase=case when g->>'phase'='result' then 'result' when g->>'phase'='reveal' then 'reveal' else 'discuss' end,deadline=null where id=r.id;
  perform private.touch(r.id);
  if narrator is null then
    if g->>'phase'='reveal' and jsonb_array_length(g->'ready')=jsonb_array_length(g->'players') then
      return public.mafia_action('begin',r.code,r.round_no,jsonb_build_object('step',g->'step'));
    elsif g->>'phase'='night' and not exists(select 1 from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and not(coalesce(g->'night_ready','[]'::jsonb) ? (p->>'id'))) then
      return public.mafia_action('resolve_night',r.code,r.round_no,jsonb_build_object('step',g->'step'));
    elsif g->>'phase'='vote' and not exists(select 1 from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and not(g->'votes' ? (p->>'id'))) then
      return public.mafia_action('resolve_vote',r.code,r.round_no,jsonb_build_object('step',g->'step'));
    end if;
  end if;
  return private.mafia_state(r.id,uid);
end $$;
revoke all on function public.mafia_action(text,text,integer,jsonb) from public,anon;
grant execute on function public.mafia_action(text,text,integer,jsonb) to authenticated;


-- Called only after room membership and result-phase checks. No public score writes.
create or replace function private.round_scores(roster jsonb, odd text, votes jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'imposter',id=odd,
    'correct',correct,'received',received,'score',(case when id=odd then 3 else correct end)-received) order by ord),'[]'::jsonb)
  from (
    select p->>'id' id,p->>'name' name,ord,
      case when p->>'id'<>odd and votes->>(p->>'id')=odd then 1 else 0 end correct,
      (select count(*)::integer from jsonb_each_text(coalesce(votes,'{}'::jsonb)) v where v.value=p->>'id') received
    from jsonb_array_elements(roster) with ordinality as x(p,ord)
  ) q;
$$;
revoke all on function private.round_scores(jsonb,text,jsonb) from public,anon,authenticated;

create or replace function private.room_state(p_room uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; base jsonb; roster jsonb; ballots jsonb;
begin
  base:=private.room_state_v1(p_room,p_user);
  select * into r from private.rooms where id=p_room;
  if r.phase='result' and r.game_key='outsider' then
    select jsonb_agg(jsonb_build_object('id',player_id,'name',name) order by player_id) into roster
      from private.round_players where room_id=r.id and round_no=r.round_no;
    select coalesce(jsonb_object_agg(voter_id::text,target_id::text),'{}'::jsonb) into ballots
      from private.votes where room_id=r.id and round_no=r.round_no;
    base:=jsonb_set(base,'{result,scores}',private.round_scores(roster,base->'result'->>'outsider_id',ballots));
  end if;
  return base||jsonb_build_object('timer_version',2,'timer',jsonb_build_object(
    'enabled',r.timer_enabled,'paused',r.timer_paused,'remaining_seconds',r.timer_remaining,
    'duration_seconds',case when r.phase='vote' then r.vote_seconds else r.discussion_seconds end));
end $$;
revoke all on function private.room_state(uuid,uuid) from public,anon,authenticated;
create or replace function private.party_state(p_room uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; me private.players; g jsonb; members jsonb; players jsonb; solution jsonb:=null; bank private.party_bank; tally jsonb; top_count integer; leaders integer; suspect text;
begin
  select * into r from private.rooms where id=p_room and game_key in ('wrong','letters') and expires_at>now();if r.id is null then raise exception 'ROOM_NOT_FOUND';end if;
  select * into me from private.players where room_id=r.id and user_id=p_user;if me.id is null then raise exception 'NOT_MEMBER';end if;
  select data into g from private.party_sessions where room_id=r.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'online',last_seen>now()-interval '60 seconds','done',false,'voted',false) order by joined_at,id),'[]') into members from private.players where room_id=r.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name','done',g->'answers' ? (p->>'id'),'voted',g->'votes' ? (p->>'id'),
    'online',exists(select 1 from private.players where room_id=r.id and id::text=p->>'id' and last_seen>now()-interval '60 seconds')) order by ord),'[]') into players from jsonb_array_elements(g->'players') with ordinality as a(p,ord);
  if r.game_key='wrong' and g->>'phase' in ('discuss','vote','result') then
    select * into bank from private.party_bank where game='wrong' and id=(g->>'bank_id')::integer;
  end if;
  if r.game_key='wrong' and g->>'phase'='result' then
    select coalesce(jsonb_object_agg(target,n),'{}') into tally from(select value target,count(*) n from jsonb_each_text(g->'votes') group by value) v;
    select max(value::integer) into top_count from jsonb_each_text(tally);
    select count(*),min(key) into leaders,suspect from jsonb_each_text(tally) where value::integer=top_count;
    solution:=jsonb_build_object('odd',g->>'odd','common',case when (g->>'flip')::boolean then bank.b else bank.a end,'different',case when (g->>'flip')::boolean then bank.a else bank.b end,
      'scores',private.round_scores(g->'players',g->>'odd',g->'votes'),'tally',tally,'tied',leaders>1,'caught',leaders=1 and suspect=g->>'odd');
  end if;
  return jsonb_build_object('game',r.game_key,'id',r.id,'code',r.code,'round',r.round_no,'step',coalesce((g->>'step')::integer,0),
    'revision',(select revision from public.room_events where room_id=r.id),'server_time',now(),'phase',coalesce(g->>'phase','lobby'),'me',me.id,'is_host',me.id=r.host_id,
    'host_offline',not exists(select 1 from private.players where id=r.host_id and last_seen>now()-interval '60 seconds'),
    'members',members,'players',case when g is null or r.game_key='letters' then members else players end,
    'answers',case when r.game_key='wrong' and g->>'phase' in ('discuss','vote','result') then g->'answers' else null end,'my_answer',g->'answers'->>(me.id::text),'my_vote',g->'votes'->>(me.id::text),
    'question',case when r.game_key='letters' then g->>'question' when g->>'phase' in ('discuss','vote','result') then case when (g->>'flip')::boolean then bank.b else bank.a end else null end,'used',coalesce(g->'used','[]'),'result',solution);
end $$;
revoke all on function private.party_state(uuid,uuid) from public,anon,authenticated;


notify pgrst,'reload schema';
commit;

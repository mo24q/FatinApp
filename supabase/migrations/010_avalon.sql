-- Fatin Avalon. Apply after 009. Repeatable; no existing game or content is reset.
begin;
do $$ begin
  if to_regprocedure('private.game_action_v1(text,text,text,uuid,integer,integer)') is null or to_regprocedure('private.outsider_action_v2(text,text,text,uuid,integer,integer)') is null or to_regprocedure('public.party_action(text,text,integer,jsonb)') is null then
    raise exception 'FATIN_RUN_009_FIRST';
  end if;
end $$;
create table if not exists private.avalon_sessions(room_id uuid primary key references private.rooms(id) on delete cascade,data jsonb not null);
alter table private.avalon_sessions enable row level security;
revoke all on private.avalon_sessions from public,anon,authenticated;

create or replace function private.avalon_evil(role text) returns boolean
language sql immutable set search_path='' as $$ select role in ('assassin','morgana','mordred','oberon','minion'); $$;
revoke all on function private.avalon_evil(text) from public,anon,authenticated;
create or replace function private.avalon_size(n integer,mission integer) returns integer
language sql immutable set search_path='' as $$ select (case n when 5 then array[2,3,2,3,3] when 6 then array[2,3,4,3,4] when 7 then array[2,3,3,4,4] else array[3,4,4,5,5] end)[mission]; $$;
revoke all on function private.avalon_size(integer,integer) from public,anon,authenticated;

create or replace function private.avalon_new(roster jsonb,config jsonb,round_no integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n integer:=jsonb_array_length(roster); bad integer; deck text[]:=array['assassin']; roles jsonb:='{}'; role text; p jsonb; i integer:=1;
begin
  if n<5 or n>10 then raise exception 'AVALON_PLAYERS';end if;
  if jsonb_typeof(config) is distinct from 'object' then raise exception 'AVALON_CONFIG';end if;
  if (select count(*) from jsonb_object_keys(config))<>4 or exists(select 1 from jsonb_each(config) where key not in ('percival','morgana','mordred','oberon') or jsonb_typeof(value)<>'boolean') then raise exception 'AVALON_CONFIG';end if;
  bad:=case when n=10 then 4 when n>=7 then 3 else 2 end;
  foreach role in array array['morgana','mordred','oberon'] loop if (config->>role)::boolean then deck:=array_append(deck,role);end if;end loop;
  if cardinality(deck)>bad then raise exception 'AVALON_CONFIG';end if;
  while cardinality(deck)<bad loop deck:=array_append(deck,'minion');end loop;
  deck:=array_append(deck,'merlin');if (config->>'percival')::boolean then deck:=array_append(deck,'percival');end if;
  while cardinality(deck)<n loop deck:=array_append(deck,'loyal');end loop;
  select array_agg(v order by gen_random_uuid()) into deck from unnest(deck) v;
  for p in select value from jsonb_array_elements(roster) loop roles:=roles||jsonb_build_object(p->>'id',deck[i]);i:=i+1;end loop;
  return jsonb_build_object('version',1,'created_at',floor(extract(epoch from now())*1000),'round',round_no,'step',1,'phase','reveal','players',roster,'roles',roles,'config',config,
    'leader',(('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint%n)::integer,'mission',1,'rejects',0,'team','[]'::jsonb,'ready','[]'::jsonb,'ballots','{}'::jsonb,'cards','{}'::jsonb,'final_ready','[]'::jsonb,'target',null,'history','[]'::jsonb,'vote_history','[]'::jsonb,'winner',null,'reason',null);
end $$;
revoke all on function private.avalon_new(jsonb,jsonb,integer) from public,anon,authenticated;

create or replace function private.avalon_secret(g jsonb,actor text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare role text:=g->'roles'->>actor; known jsonb; candidates jsonb;
begin
  if role is null then raise exception 'NOT_MEMBER';end if;
  select coalesce(jsonb_agg(p->>'id'),'[]') into known from jsonb_array_elements(g->'players') p where p->>'id'<>actor and
    case when role='merlin' then private.avalon_evil(g->'roles'->>(p->>'id')) and g->'roles'->>(p->>'id')<>'mordred'
      when private.avalon_evil(role) and role<>'oberon' then private.avalon_evil(g->'roles'->>(p->>'id')) and g->'roles'->>(p->>'id')<>'oberon' else false end;
  select coalesce(jsonb_agg(p->>'id'),'[]') into candidates from jsonb_array_elements(g->'players') p where role='percival' and g->'roles'->>(p->>'id') in ('merlin','morgana');
  return jsonb_build_object('role',role,'known',known,'candidates',candidates);
end $$;
revoke all on function private.avalon_secret(jsonb,text) from public,anon,authenticated;

create or replace function private.avalon_apply(g jsonb,actor text,action text,p jsonb,host text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n integer:=jsonb_array_length(g->'players'); phase text:=g->>'phase'; mission integer:=(g->>'mission')::integer; leader integer:=(g->>'leader')::integer;
  next_phase text:=phase; rejected integer; approved boolean; fails integer; won integer; lost integer; target text; key text; choices jsonb;
begin
  if not exists(select 1 from jsonb_array_elements(g->'players') v where v->>'id'=actor) then raise exception 'NOT_MEMBER';end if;
  case action
  when 'ready' then
    if phase<>'reveal' then raise exception 'WRONG_PHASE';end if;
    if not(g->'ready' ? actor) then g:=jsonb_set(g,'{ready}',g->'ready'||to_jsonb(actor));end if;
    if jsonb_array_length(g->'ready')=n then next_phase:='propose';end if;
  when 'propose' then
    if phase<>'propose' then raise exception 'WRONG_PHASE';end if;
    if actor is distinct from g->'players'->leader->>'id' then raise exception 'LEADER_ONLY';end if;
    if jsonb_typeof(p->'team') is distinct from 'array' then raise exception 'INVALID_TEAM';end if;
    if jsonb_array_length(p->'team')<>private.avalon_size(n,mission) or (select count(distinct value) from jsonb_array_elements(p->'team'))<>jsonb_array_length(p->'team') or exists(select 1 from jsonb_array_elements(p->'team') t where jsonb_typeof(t)<>'string' or not exists(select 1 from jsonb_array_elements(g->'players') v where v->'id'=t)) then raise exception 'INVALID_TEAM';end if;
    g:=g||jsonb_build_object('team',p->'team','ballots','{}'::jsonb);next_phase:='ballot';
  when 'vote','quest' then
    if phase<>(case action when 'vote' then 'ballot' else 'quest' end) then raise exception 'WRONG_PHASE';end if;
    key:=case action when 'vote' then 'ballots' else 'cards' end;
    if action='quest' then
      if not(g->'team' ? actor) then raise exception 'TEAM_ONLY';end if;
      if p->'success'='false'::jsonb and not private.avalon_evil(g->'roles'->>actor) then raise exception 'GOOD_MUST_SUCCEED';end if;
    end if;
    approved:=(p->>case action when 'vote' then 'approve' else 'success' end)::boolean;
    if jsonb_typeof(p->case action when 'vote' then 'approve' else 'success' end) is distinct from 'boolean' then raise exception 'INVALID_CHOICE';end if;
    choices:=g->key;
    if choices ? actor and choices->actor is distinct from to_jsonb(approved) then raise exception 'ACTION_LOCKED';end if;
    choices:=choices||jsonb_build_object(actor,approved);g:=jsonb_set(g,array[key],choices);
    if action='vote' and (select count(*) from jsonb_each(choices))=n then
      approved:=(select count(*) from jsonb_each(choices) where value='true'::jsonb)>n/2.0;
      g:=jsonb_set(g,'{vote_history}',g->'vote_history'||jsonb_build_array(jsonb_build_object('mission',mission,'leader',g->'players'->leader->>'id','team',g->'team','votes',choices,'approved',approved)));
      g:=jsonb_set(g,'{ballots}','{}');
      if approved then g:=g||jsonb_build_object('rejects',0,'cards','{}'::jsonb);next_phase:='quest';
      else
        rejected:=(g->>'rejects')::integer+1;g:=g||jsonb_build_object('rejects',rejected,'leader',(leader+1)%n,'team','[]'::jsonb);next_phase:='propose';
        if rejected=5 then g:=g||jsonb_build_object('winner','evil','reason','rejections');next_phase:='result';end if;
      end if;
    elsif action='quest' and (select count(*) from jsonb_each(choices))=jsonb_array_length(g->'team') then
      select count(*) into fails from jsonb_each(choices) where value='false'::jsonb;
      g:=jsonb_set(g,'{history}',g->'history'||jsonb_build_array(jsonb_build_object('mission',mission,'team',g->'team','fails',fails,'success',fails<case when n>=7 and mission=4 then 2 else 1 end)));
      g:=jsonb_set(g,'{cards}','{}');next_phase:='review';
    end if;
  when 'next' then
    if phase<>'review' then raise exception 'WRONG_PHASE';end if;if actor<>host then raise exception 'HOST_ONLY';end if;
    select count(*) filter(where (v->>'success')::boolean),count(*) filter(where not (v->>'success')::boolean) into won,lost from jsonb_array_elements(g->'history') v;
    if lost>=3 then g:=g||jsonb_build_object('winner','evil','reason','quests');next_phase:='result';
    elsif won>=3 then g:=jsonb_set(g,'{final_ready}','[]');next_phase:='assassinate';
    else g:=g||jsonb_build_object('mission',mission+1,'leader',(leader+1)%n,'team','[]'::jsonb);next_phase:='propose';end if;
  when 'final' then
    if phase<>'assassinate' then raise exception 'WRONG_PHASE';end if;
    if g->'roles'->>actor='assassin' then
      target:=p->>'target';
      -- Do not validate hidden allegiance: that would expose Oberon through error responses.
      if target is null or target=actor or not exists(select 1 from jsonb_array_elements(g->'players') v where v->>'id'=target) then raise exception 'INVALID_TARGET';end if;
      if g->>'target' is not null and g->>'target'<>target then raise exception 'ACTION_LOCKED';end if;
      g:=jsonb_set(g,'{target}',to_jsonb(target));
    elsif p ? 'target' then raise exception 'ASSASSIN_ONLY';end if;
    if not(g->'final_ready' ? actor) then g:=jsonb_set(g,'{final_ready}',g->'final_ready'||to_jsonb(actor));end if;
    if jsonb_array_length(g->'final_ready')=n then
      if g->>'target' is null then raise exception 'NOT_READY';end if;
      approved:=g->'roles'->>(g->>'target')='merlin';g:=g||jsonb_build_object('winner',case when approved then 'evil' else 'good' end,'reason',case when approved then 'assassination' else 'protected' end);next_phase:='result';
    end if;
  else raise exception 'ACTION_INVALID';
  end case;
  if next_phase<>phase then g:=g||jsonb_build_object('phase',next_phase,'step',(g->>'step')::integer+1);end if;
  return g;
end $$;
revoke all on function private.avalon_apply(jsonb,text,text,jsonb,text) from public,anon,authenticated;

create or replace function private.avalon_state(p_room uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; me private.players; g jsonb; members jsonb; roster jsonb; pending jsonb; phase text;
begin
  select * into r from private.rooms where id=p_room;select * into me from private.players where room_id=p_room and user_id=p_user;
  if me.id is null then raise exception 'NOT_MEMBER';end if;
  select data into g from private.avalon_sessions where room_id=p_room;phase:=coalesce(g->>'phase','lobby');
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'online',last_seen>now()-interval '60 seconds') order by joined_at,id),'[]') into members from private.players where room_id=p_room;
  select coalesce(jsonb_agg(v||jsonb_build_object('online',exists(select 1 from private.players where id=(v->>'id')::uuid and last_seen>now()-interval '60 seconds')) order by ord),'[]') into roster from jsonb_array_elements(coalesce(g->'players',members)) with ordinality a(v,ord);
  select coalesce(jsonb_agg(v->>'id' order by ord),'[]') into pending from jsonb_array_elements(roster) with ordinality a(v,ord) where case phase
    when 'reveal' then not(g->'ready' ? (v->>'id')) when 'ballot' then not(g->'ballots' ? (v->>'id'))
    when 'quest' then g->'team' ? (v->>'id') and not(g->'cards' ? (v->>'id')) when 'assassinate' then not(g->'final_ready' ? (v->>'id')) else false end;
  return jsonb_build_object('game','avalon','id',r.id,'code',r.code,'round',r.round_no,'revision',(select revision from public.room_events where room_id=r.id),'server_time',now(),
    'step',coalesce((g->>'step')::integer,0),'phase',phase,'players',roster,'members',members,'me',me.id,'is_host',me.id=r.host_id,
    'host_offline',not exists(select 1 from private.players where id=r.host_id and last_seen>now()-interval '60 seconds'),
    'config',coalesce(g->'config','{"percival":false,"morgana":false,"mordred":false,"oberon":false}'::jsonb),
    'leader',coalesce((g->>'leader')::integer,0),'mission',coalesce((g->>'mission')::integer,1),'rejects',coalesce((g->>'rejects')::integer,0),
    'team',coalesce(g->'team','[]'),'pending',pending,'history',coalesce(g->'history','[]'),'vote_history',coalesce(g->'vote_history','[]'),
    'winner',g->'winner','reason',g->'reason','roles',case when phase='result' then g->'roles' else null end,'target',case when phase='result' then g->'target' else null end);
end $$;
revoke all on function private.avalon_state(uuid,uuid) from public,anon,authenticated;

create or replace function public.avalon_action(p_action text,p_code text default '',p_round integer default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();r private.rooms;me private.players;g jsonb;answer jsonb;roster jsonb;config jsonb;n integer;
begin
  if uid is null then raise exception 'AUTH_REQUIRED';end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4096 then raise exception 'INVALID_PAYLOAD';end if;
  if p_action='create' then
    answer:=private.game_action_v1('create','',p_payload->>'name',null,null,120);
    update private.rooms set game_key='avalon',timer_enabled=false where id=(answer->>'id')::uuid returning * into r;return private.avalon_state(r.id,uid);
  end if;
  if p_action='join' then perform pg_advisory_xact_lock(hashtextextended(uid::text,0));end if;
  select * into r from private.rooms where code=upper(trim(p_code)) and expires_at>now() for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND';end if;if r.game_key<>'avalon' then raise exception 'WRONG_GAME';end if;
  if p_action='join' then
    if not exists(select 1 from private.players where room_id=r.id and user_id=uid) and (select count(*) from private.players where room_id=r.id)>=10 then raise exception 'AVALON_FULL';end if;
    perform private.game_action_v1('join',r.code,p_payload->>'name',null,null,120);return private.avalon_state(r.id,uid);
  end if;
  select * into me from private.players where room_id=r.id and user_id=uid;if me.id is null then raise exception 'NOT_MEMBER';end if;
  update private.players set last_seen=now() where id=me.id;select data into g from private.avalon_sessions where room_id=r.id;
  if p_action='state' then return private.avalon_state(r.id,uid);end if;
  if p_round is distinct from r.round_no then raise exception 'STALE_ROUND';end if;
  if (p_payload->>'step')::integer is distinct from coalesce((g->>'step')::integer,0) then raise exception 'STALE_PHASE';end if;
  if p_action='secret' then if g is null then raise exception 'WRONG_PHASE';end if;return private.avalon_secret(g,me.id::text);end if;
  if p_action in ('claim_host','remove','leave') then
    answer:=private.game_action_v1(p_action,r.code,null,(p_payload->>'target')::uuid,r.round_no,120);if p_action='leave' then return answer;end if;return private.avalon_state(r.id,uid);
  end if;
  if p_action in ('start','cancel') and me.id<>r.host_id then raise exception 'HOST_ONLY';end if;
  if p_action='cancel' then
    delete from private.avalon_sessions where room_id=r.id;update private.rooms set phase='lobby',deadline=null where id=r.id;perform private.touch(r.id);return private.avalon_state(r.id,uid);
  elsif p_action='start' then
    if r.phase not in ('lobby','result') then raise exception 'WRONG_PHASE';end if;
    select count(*),jsonb_agg(jsonb_build_object('id',id,'name',name) order by joined_at,id) into n,roster from private.players where room_id=r.id;
    if exists(select 1 from private.players where room_id=r.id and last_seen<=now()-interval '60 seconds') then raise exception 'PLAYER_OFFLINE';end if;
    config:=coalesce(p_payload->'config','{"percival":false,"morgana":false,"mordred":false,"oberon":false}'::jsonb);
    g:=private.avalon_new(roster,config,r.round_no+1);update private.rooms set round_no=round_no+1 where id=r.id;
  else
    if g is null then raise exception 'WRONG_PHASE';end if;g:=private.avalon_apply(g,me.id::text,p_action,p_payload,r.host_id::text);
  end if;
  insert into private.avalon_sessions(room_id,data) values(r.id,g) on conflict(room_id) do update set data=excluded.data;
  update private.rooms set phase=case when g->>'phase'='result' then 'result' else 'discuss' end,deadline=null where id=r.id;
  perform private.touch(r.id);return private.avalon_state(r.id,uid);
end $$;
revoke all on function public.avalon_action(text,text,integer,jsonb) from public,anon;
grant execute on function public.avalon_action(text,text,integer,jsonb) to authenticated;

create or replace function public.game_action(p_action text,p_code text default '',p_name text default null,p_target uuid default null,p_round integer default null,p_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare game text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
  if p_action<>'create' then
    select game_key into game from private.rooms where code=upper(trim(p_code));
    if game in ('wrong','letters','wave','mafia','crime','avalon') then
      if p_action<>'join' then raise exception 'WRONG_GAME';end if;
      if game in ('wrong','letters') then return public.party_action('join',p_code,p_round,jsonb_build_object('name',p_name,'game',game));
      elsif game='wave' then return public.wave_action('join',p_code,p_round,jsonb_build_object('name',p_name));
      elsif game='mafia' then return public.mafia_action('join',p_code,p_round,jsonb_build_object('name',p_name));
      elsif game='avalon' then return public.avalon_action('join',p_code,p_round,jsonb_build_object('name',p_name));
      else return public.crime_action('join',p_code,p_round,jsonb_build_object('name',p_name));end if;
    end if;
  end if;
  return private.outsider_action_v2(p_action,p_code,p_name,p_target,p_round,p_seconds);
end $$;
revoke all on function public.game_action(text,text,text,uuid,integer,integer) from public,anon;
grant execute on function public.game_action(text,text,text,uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;

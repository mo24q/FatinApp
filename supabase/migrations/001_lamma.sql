-- Run once in a fresh Supabase project's SQL editor (or `supabase db push`).
-- Secrets never enter an exposed table or a Realtime payload.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null,
  phase text not null default 'lobby' check (phase in ('lobby','reveal','discuss','vote','result')),
  round_no integer not null default 0,
  discussion_seconds integer not null default 120,
  deadline timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create table private.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references private.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 20),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique(room_id,user_id), unique(room_id,name)
);
create index players_user_idx on private.players(user_id);
create table private.guest_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  created_count integer not null default 0
);
create table private.words (
  id integer generated always as identity primary key,
  category text not null,
  word text not null unique
);
create table private.rounds (
  room_id uuid not null references private.rooms(id) on delete cascade,
  number integer not null,
  word_id integer not null references private.words(id),
  outsider_id uuid not null,
  primary key(room_id,number)
);
create table private.round_players (
  room_id uuid not null,
  round_no integer not null,
  player_id uuid not null,
  name text not null,
  ready boolean not null default false,
  primary key(room_id,round_no,player_id),
  foreign key(room_id,round_no) references private.rounds(room_id,number) on delete cascade
);
create table private.votes (
  room_id uuid not null,
  round_no integer not null,
  voter_id uuid not null,
  target_id uuid not null,
  primary key(room_id,round_no,voter_id),
  foreign key(room_id,round_no,voter_id) references private.round_players(room_id,round_no,player_id) on delete cascade,
  foreign key(room_id,round_no,target_id) references private.round_players(room_id,round_no,player_id) on delete cascade,
  check(voter_id <> target_id)
);

-- This is the ONLY table exposed to Realtime. No names, words, roles or votes.
create table public.room_events (
  room_id uuid primary key references private.rooms(id) on delete cascade,
  revision bigint not null default 0
);
alter table public.room_events enable row level security;
revoke all on public.room_events from public, anon, authenticated;
grant select on public.room_events to authenticated;

create function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.players p join private.rooms r on r.id=p.room_id
    where p.room_id=p_room and p.user_id=auth.uid() and r.expires_at>now());
$$;
revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;
create policy member_event_read on public.room_events for select to authenticated
  using (public.is_room_member(room_id));

create function private.touch(p_room uuid) returns void
language sql security definer set search_path = '' as $$
  update public.room_events set revision=revision+1 where room_id=p_room;
$$;

create function private.room_state(p_room uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r private.rooms; me private.players; result_json jsonb; tally jsonb;
  winner uuid; top_count integer; leaders integer; secret private.rounds; w private.words;
begin
  select * into r from private.rooms where id=p_room;
  select * into me from private.players where room_id=p_room and user_id=p_user;
  if me.id is null then raise exception 'NOT_MEMBER'; end if;
  if r.phase='result' then
    select * into secret from private.rounds where room_id=r.id and number=r.round_no;
    select * into w from private.words where id=secret.word_id;
    select jsonb_agg(jsonb_build_object('id',id,'name',name,'count',n) order by n desc,name)
    into tally from (
      select rp.player_id as id,rp.name,count(v.voter_id)::integer as n
      from private.round_players rp left join private.votes v on v.room_id=rp.room_id and v.round_no=rp.round_no and v.target_id=rp.player_id
      where rp.room_id=r.id and rp.round_no=r.round_no group by rp.player_id,rp.name
    ) counts;
    select max((value->>'count')::integer) into top_count from jsonb_array_elements(tally);
    select count(*), min(value->>'id')::uuid into leaders,winner from jsonb_array_elements(tally)
      where (value->>'count')::integer=top_count;
    result_json := jsonb_build_object('word',w.word,'category',w.category,'outsider_id',secret.outsider_id,
      'caught',leaders=1 and top_count>0 and winner=secret.outsider_id,'tied',leaders>1,'votes',tally);
  end if;
  return jsonb_build_object(
    'id',r.id,'code',r.code,'phase',r.phase,'round',r.round_no,'me',me.id,'is_host',r.host_id=me.id,
    'host_offline',not exists(select 1 from private.players where id=r.host_id and last_seen>now()-interval '60 seconds'),
    'discussion_seconds',r.discussion_seconds,'deadline',r.deadline,'server_time',now(),
    'revision',(select revision from public.room_events where room_id=r.id),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
      'online',p.last_seen>now()-interval '60 seconds','is_host',p.id=r.host_id,'ready',coalesce(rp.ready,false)) order by p.joined_at,p.id),'[]'::jsonb)
      from private.players p left join private.round_players rp on rp.room_id=p.room_id and rp.player_id=p.id and rp.round_no=r.round_no where p.room_id=r.id),
    'voted',exists(select 1 from private.votes where room_id=r.id and round_no=r.round_no and voter_id=me.id),
    'my_vote',(select target_id from private.votes where room_id=r.id and round_no=r.round_no and voter_id=me.id),
    'votes_count',(select count(*) from private.votes where room_id=r.id and round_no=r.round_no),
    'result',result_json
  );
end;
$$;

-- All state transitions are atomic and serialized by the room row lock.
-- p_round guards delayed/replayed requests from affecting a later round.
create function public.game_action(
  p_action text, p_code text default '', p_name text default null,
  p_target uuid default null, p_round integer default null, p_seconds integer default 120
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); r private.rooms; me private.players; n integer; new_code text;
  next_word integer; next_outsider uuid; old_word integer; old_outsider uuid;
  secret private.rounds; w private.words; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  p_code := upper(trim(p_code));
  if p_action in ('create','join') then
    p_name := trim(regexp_replace(coalesce(p_name,''),'\s+',' ','g'));
    if char_length(p_name) not between 2 and 20 or p_name ~ '[[:cntrl:]]' or p_name ~ '[‎‏‪-‮⁦-⁩]' then raise exception 'NAME_INVALID'; end if;
    -- Serialize a guest's concurrent create/join requests as well as room writes.
    perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  end if;
  if p_action='create' then
    if p_seconds is null or p_seconds not in (60,120,180,300) then raise exception 'INVALID_SECONDS'; end if;
    insert into private.guest_limits(user_id) values(uid) on conflict do nothing;
    update private.guest_limits set window_start=now(),created_count=0 where user_id=uid and window_start<=now()-interval '1 hour';
    if (select created_count from private.guest_limits where user_id=uid)>=5 then raise exception 'CREATE_LIMIT'; end if;
    if (select count(*) from private.players pp join private.rooms rr on rr.id=pp.room_id where pp.user_id=uid and rr.expires_at>now())>=10 then raise exception 'ROOM_LIMIT'; end if;
    loop
      select string_agg(substr(alphabet,1+(get_byte(uuid_send(gen_random_uuid()),0)%length(alphabet)),1),'') into new_code from generate_series(1,6);
      begin
        insert into private.rooms(code,host_id,discussion_seconds) values(new_code,gen_random_uuid(),p_seconds) returning * into r;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
    insert into private.players(room_id,user_id,name) values(r.id,uid,p_name) returning * into me;
    update private.rooms set host_id=me.id where id=r.id;
    insert into public.room_events(room_id) values(r.id);
    update private.guest_limits set created_count=created_count+1 where user_id=uid;
    return private.room_state(r.id,uid);
  end if;

  select * into r from private.rooms where code=p_code and expires_at>now() for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into me from private.players where room_id=r.id and user_id=uid;
  if p_action='join' then
    if me.id is not null then
      update private.players set last_seen=now() where id=me.id;
      return private.room_state(r.id,uid);
    end if;
    if r.phase not in ('lobby','result') then raise exception 'ROUND_IN_PROGRESS'; end if;
    if (select count(*) from private.players where room_id=r.id)>=12 then raise exception 'ROOM_FULL'; end if;
    if (select count(*) from private.players pp join private.rooms rr on rr.id=pp.room_id where pp.user_id=uid and rr.expires_at>now())>=10 then raise exception 'ROOM_LIMIT'; end if;
    if exists(select 1 from private.players where room_id=r.id and lower(name)=lower(p_name)) then raise exception 'NAME_TAKEN'; end if;
    insert into private.players(room_id,user_id,name) values(r.id,uid,p_name);
    perform private.touch(r.id);
    return private.room_state(r.id,uid);
  end if;
  if me.id is null then raise exception 'NOT_MEMBER'; end if;
  update private.players set last_seen=now() where id=me.id;

  if p_action in ('ready','discuss','open_vote','vote','finish_vote','cancel','start','remove','leave')
    and p_round is distinct from r.round_no then raise exception 'STALE_ROUND'; end if;

  -- Any member can settle an expired vote. No scheduled server is required.
  if r.phase='vote' and r.deadline<=now() then
    update private.rooms set phase='result',deadline=null where id=r.id;
    perform private.touch(r.id);
    if p_action in ('state','vote','finish_vote') then return private.room_state(r.id,uid); end if;
    r.phase := 'result';
  end if;

  if p_action='state' then return private.room_state(r.id,uid); end if;
  if p_action='role' then
    if r.phase not in ('reveal','discuss','vote') then raise exception 'WRONG_PHASE'; end if;
    if p_round is distinct from r.round_no then raise exception 'STALE_ROUND'; end if;
    if not exists(select 1 from private.round_players where room_id=r.id and round_no=r.round_no and player_id=me.id) then raise exception 'NOT_MEMBER'; end if;
    select * into secret from private.rounds where room_id=r.id and number=r.round_no;
    select * into w from private.words where id=secret.word_id;
    return jsonb_build_object('round',r.round_no,'outsider',secret.outsider_id=me.id,'category',w.category,
      'word',case when secret.outsider_id=me.id then null else w.word end);
  end if;

  if p_action in ('start','discuss','open_vote','finish_vote','cancel','remove') and me.id<>r.host_id then raise exception 'HOST_ONLY'; end if;
  case p_action
  when 'start' then
    if r.phase not in ('lobby','result') then raise exception 'WRONG_PHASE'; end if;
    select count(*) into n from private.players where room_id=r.id;
    if n<3 then raise exception 'NEED_PLAYERS'; end if;
    if exists(select 1 from private.players where room_id=r.id and last_seen<=now()-interval '60 seconds') then raise exception 'PLAYER_OFFLINE'; end if;
    select word_id,outsider_id into old_word,old_outsider from private.rounds where room_id=r.id and number=r.round_no;
    select id into next_word from private.words where id is distinct from old_word order by gen_random_uuid() limit 1;
    select id into next_outsider from private.players where room_id=r.id and id is distinct from old_outsider order by gen_random_uuid() limit 1;
    insert into private.rounds(room_id,number,word_id,outsider_id) values(r.id,r.round_no+1,next_word,next_outsider);
    insert into private.round_players(room_id,round_no,player_id,name) select r.id,r.round_no+1,id,name from private.players where room_id=r.id;
    update private.rooms set phase='reveal',round_no=round_no+1,deadline=null where id=r.id;
  when 'ready' then
    if r.phase<>'reveal' then raise exception 'WRONG_PHASE'; end if;
    update private.round_players set ready=true where room_id=r.id and round_no=r.round_no and player_id=me.id;
  when 'discuss' then
    if r.phase<>'reveal' then raise exception 'WRONG_PHASE'; end if;
    if exists(select 1 from private.round_players where room_id=r.id and round_no=r.round_no and not ready) then raise exception 'NOT_READY'; end if;
    update private.rooms set phase='discuss',deadline=now()+make_interval(secs=>r.discussion_seconds) where id=r.id;
  when 'open_vote' then
    if r.phase<>'discuss' then raise exception 'WRONG_PHASE'; end if;
    update private.rooms set phase='vote',deadline=now()+interval '60 seconds' where id=r.id;
  when 'vote' then
    if r.phase<>'vote' then raise exception 'WRONG_PHASE'; end if;
    if p_target=me.id or p_target is null or not exists(select 1 from private.round_players where room_id=r.id and round_no=r.round_no and player_id=p_target) then raise exception 'INVALID_VOTE'; end if;
    if exists(select 1 from private.votes where room_id=r.id and round_no=r.round_no and voter_id=me.id) then raise exception 'ALREADY_VOTED'; end if;
    insert into private.votes(room_id,round_no,voter_id,target_id) values(r.id,r.round_no,me.id,p_target);
    if (select count(*) from private.votes where room_id=r.id and round_no=r.round_no)=(select count(*) from private.round_players where room_id=r.id and round_no=r.round_no) then
      update private.rooms set phase='result',deadline=null where id=r.id;
    end if;
  when 'finish_vote' then
    if r.phase='result' then return private.room_state(r.id,uid); end if;
    raise exception 'VOTING_OPEN';
  when 'cancel' then
    if r.phase not in ('reveal','discuss','vote') then raise exception 'WRONG_PHASE'; end if;
    update private.rooms set phase='lobby',deadline=null where id=r.id;
  when 'remove' then
    if r.phase not in ('lobby','result') or p_target is null or p_target=me.id then raise exception 'CANNOT_REMOVE'; end if;
    delete from private.players where room_id=r.id and id=p_target;
  when 'leave' then
    if r.phase not in ('lobby','result') then raise exception 'ROUND_IN_PROGRESS'; end if;
    delete from private.players where id=me.id;
    if r.host_id=me.id then
      select id into next_outsider from private.players where room_id=r.id order by last_seen desc,joined_at limit 1;
      if next_outsider is null then delete from private.rooms where id=r.id; return jsonb_build_object('left',true); end if;
      update private.rooms set host_id=next_outsider where id=r.id;
    end if;
    perform private.touch(r.id);
    return jsonb_build_object('left',true);
  when 'claim_host' then
    if exists(select 1 from private.players where id=r.host_id and last_seen>now()-interval '60 seconds') then raise exception 'HOST_ONLINE'; end if;
    update private.rooms set host_id=me.id where id=r.id;
  else raise exception 'ACTION_INVALID';
  end case;
  perform private.touch(r.id);
  return private.room_state(r.id,uid);
end;
$$;

-- Defense in depth for direct REST, GraphQL, and custom PostgREST schema requests.
alter table private.rooms enable row level security;
alter table private.players enable row level security;
alter table private.rounds enable row level security;
alter table private.words enable row level security;
alter table private.round_players enable row level security;
alter table private.votes enable row level security;
alter table private.guest_limits enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.game_action(text,text,text,uuid,integer,integer) from public,anon;
grant execute on function public.game_action(text,text,text,uuid,integer,integer) to authenticated;

-- Run daily from Supabase Cron using a privileged database role.
create function private.cleanup_expired_rooms() returns void language sql security definer set search_path='' as $$
  delete from private.rooms where expires_at<now();
$$;
revoke all on function private.cleanup_expired_rooms() from public,anon,authenticated;

-- Deliberately short, original everyday-word bank; no commercial assets/questions.
insert into private.words(category,word) values
('أكل وشرب','كبسة'),('أكل وشرب','بيتزا'),('أكل وشرب','فلافل'),('أكل وشرب','قهوة'),
('أكل وشرب','شاي'),('أكل وشرب','آيس كريم'),('أكل وشرب','بطيخ'),('أكل وشرب','تمر'),
('أماكن','مطار'),('أماكن','مكتبة'),('أماكن','شاطئ'),('أماكن','مستشفى'),
('أماكن','مدرسة'),('أماكن','ملعب'),('أماكن','متحف'),('أماكن','مزرعة'),
('أشياء حولنا','مظلة'),('أشياء حولنا','مفتاح'),('أشياء حولنا','مرآة'),('أشياء حولنا','سماعة'),
('أشياء حولنا','ساعة'),('أشياء حولنا','وسادة'),('أشياء حولنا','حقيبة'),('أشياء حولنا','دراجة'),
('حيوانات','بطريق'),('حيوانات','جمل'),('حيوانات','دلفين'),('حيوانات','أرنب'),
('حيوانات','بومة'),('حيوانات','سلحفاة'),('حيوانات','أسد'),('حيوانات','فراشة'),
('طلعات وهوايات','تخييم'),('طلعات وهوايات','رسم'),('طلعات وهوايات','سباحة'),('طلعات وهوايات','تصوير'),
('طلعات وهوايات','صيد'),('طلعات وهوايات','تسلق'),('طلعات وهوايات','طبخ'),('طلعات وهوايات','زراعة');

-- Supabase has this publication; the local PGlite test harness intentionally does not.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.room_events;
  end if;
end $$;
commit;

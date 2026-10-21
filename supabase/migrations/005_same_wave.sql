-- Fatin: same wave. Apply after 001, 002, 003 and 004. Repeatable additive migration.
begin;
create table if not exists private.wave_pairs(id integer primary key, low_label text not null, high_label text not null);
create table if not exists private.wave_sessions(room_id uuid primary key references private.rooms(id) on delete cascade,data jsonb not null);
alter table private.wave_pairs enable row level security;
alter table private.wave_sessions enable row level security;
revoke all on private.wave_pairs,private.wave_sessions from public,anon,authenticated;
insert into private.wave_pairs(id,low_label,high_label) values
(0,'بارد','حار'),
(1,'هادئ','صاخب'),
(2,'خفيف','ثقيل'),
(3,'سهل','صعب'),
(4,'قريب','بعيد'),
(5,'بطيء','سريع'),
(6,'قديم','حديث'),
(7,'رخيص','غالي'),
(8,'يومي','نادر'),
(9,'صغير','ضخم'),
(10,'ناعم','خشن'),
(11,'مرتب','فوضوي'),
(12,'بسيط','معقد'),
(13,'مألوف','غريب'),
(14,'عملي','للزينة'),
(15,'قصير','طويل'),
(16,'فردي','جماعي'),
(17,'عفوي','مخطط له'),
(18,'مريح','متعب'),
(19,'خفيف على المعدة','وجبة دسمة'),
(20,'فطور','عشاء'),
(21,'للبيت','للطلعات'),
(22,'للشتاء','للصيف'),
(23,'مالح','حلو'),
(24,'يبغى صبر','يخلص بسرعة'),
(25,'للمبتدئ','للمحترف'),
(26,'واقعي','خيالي'),
(27,'رسمي','عفوي'),
(28,'مغامرة','استرخاء'),
(29,'يحتاج هدوء','يحتاج حماس'),
(30,'سهل حمله','صعب نقله'),
(31,'ذكرى قديمة','خطة للمستقبل'),
(32,'شخصي','يصلح هدية'),
(33,'يدوي','آلي'),
(34,'غامض','واضح'),
(35,'يؤكل بالملعقة','يؤكل باليد'),
(36,'في الداخل','في الهواء الطلق'),
(37,'نشتريه مرة','نشتريه دائمًا'),
(38,'يستاهل الانتظار','أفضله فورًا'),
(39,'خطوة صغيرة','قرار كبير')
on conflict(id) do update set low_label=excluded.low_label,high_label=excluded.high_label;

create or replace function private.wave_state(p_room uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; me private.players; g jsonb; members jsonb; participants jsonb;
begin
  select * into r from private.rooms where id=p_room and game_key='wave' and expires_at>now();
  if r.id is null then raise exception 'ROOM_NOT_FOUND';end if;
  select * into me from private.players where room_id=r.id and user_id=p_user;
  if me.id is null then raise exception 'NOT_MEMBER';end if;
  select data into g from private.wave_sessions where room_id=r.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'online',last_seen>now()-interval '60 seconds','done',false) order by joined_at,id),'[]') into members from private.players where room_id=r.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name','done',g->'guesses' ? (p->>'id'),
    'online',exists(select 1 from private.players where room_id=r.id and id::text=p->>'id' and last_seen>now()-interval '60 seconds')) order by ord),'[]') into participants from jsonb_array_elements(g->'players') with ordinality as a(p,ord);
  return jsonb_build_object('game','wave','id',r.id,'code',r.code,'round',r.round_no,'step',coalesce((g->>'step')::integer,0),
    'revision',(select revision from public.room_events where room_id=r.id),'server_time',now(),'phase',coalesce(g->>'phase','lobby'),'me',me.id,'is_host',r.host_id=me.id,
    'host_offline',not exists(select 1 from private.players where id=r.host_id and last_seen>now()-interval '60 seconds'),
    'members',members,'players',case when g is null then members else participants end,'giver',g->>'giver','pair',g->'pair','clue',coalesce(g->>'clue',''),
    'turn',coalesce((g->>'turn')::integer,0),'total',coalesce((g->>'total')::integer,6),'score',coalesce((g->>'score')::integer,0),'my_guess',g->'guesses'->(me.id::text),
    'result',case when g->>'phase' in ('result','complete') then g->'history' -> -1 else null end,'history',coalesce(g->'history','[]'),
    'timer',coalesce(g->'timer',jsonb_build_object('enabled',false,'paused',false,'remaining_seconds',null,'duration_seconds',120)),'deadline',g->>'deadline');
end $$;
revoke all on function private.wave_state(uuid,uuid) from public,anon,authenticated;

-- Caller already holds the room lock. Only confirmed guesses contribute to the mean.
create or replace function private.wave_resolve(p_room uuid) returns void
language plpgsql security definer set search_path='' as $$
declare g jsonb; mean integer; points integer; distance integer; result jsonb;
begin
  select data into g from private.wave_sessions where room_id=p_room;
  if g->>'phase' is distinct from 'guess' then raise exception 'WRONG_PHASE';end if;
  select round(avg(value::numeric))::integer into mean from jsonb_each_text(g->'guesses');
  if mean is null then raise exception 'WAVE_NO_GUESSES';end if;
  distance:=abs(mean-(g->>'target')::integer);
  points:=case when distance<=4 then 4 when distance<=9 then 3 when distance<=16 then 2 when distance<=24 then 1 else 0 end;
  result:=jsonb_build_object('turn',g->'turn','pair',g->'pair','clue',g->'clue','target',g->'target','average',mean,'points',points,'guesses',g->'guesses','giver',g->'giver');
  g:=g||jsonb_build_object('history',g->'history'||jsonb_build_array(result),'score',(g->>'score')::integer+points,'step',(g->>'step')::integer+1,
    'phase',case when g->'turn'=g->'total' then 'complete' else 'result' end,'deadline',null,'timer',g->'timer'||jsonb_build_object('paused',false,'remaining_seconds',null));
  update private.wave_sessions set data=g where room_id=p_room;
  update private.rooms set phase=case when g->>'phase'='complete' then 'result' else 'discuss' end,deadline=null where id=p_room;
  perform private.touch(p_room);
end $$;
revoke all on function private.wave_resolve(uuid) from public,anon,authenticated;

create or replace function public.wave_action(p_action text,p_code text default '',p_round integer default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r private.rooms; me private.players; g jsonb; answer jsonb; actor text; roster jsonb; total integer; n integer; giver_index integer; pair private.wave_pairs;
  clue text; value integer; timer jsonb; duration integer; remaining integer; deadline timestamptz;
begin
  if uid is null then raise exception 'AUTH_REQUIRED';end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4096 then raise exception 'INVALID_PAYLOAD';end if;
  if p_action='create' then
    answer:=private.game_action_v1('create','',p_payload->>'name',null,null,120);
    update private.rooms set game_key='wave',timer_enabled=false where id=(answer->>'id')::uuid returning * into r;
    return private.wave_state(r.id,uid);
  end if;
  if p_action='join' then perform pg_advisory_xact_lock(hashtextextended(uid::text,0));end if;
  select * into r from private.rooms where code=upper(trim(p_code)) and expires_at>now() for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND';end if;
  if r.game_key<>'wave' then raise exception 'WRONG_GAME';end if;
  if p_action='join' then perform private.game_action_v1('join',r.code,p_payload->>'name',null,null,120);return private.wave_state(r.id,uid);end if;
  select * into me from private.players where room_id=r.id and user_id=uid;
  if me.id is null then raise exception 'NOT_MEMBER';end if;
  actor:=me.id::text;update private.players set last_seen=now() where id=me.id;
  select data into g from private.wave_sessions where room_id=r.id;
  if p_action='state' then
    if g->>'phase'='guess' and (g->>'deadline')::timestamptz<=now() and g->'guesses'<>'{}'::jsonb then perform private.wave_resolve(r.id);end if;
    return private.wave_state(r.id,uid);
  end if;
  if p_round is distinct from r.round_no then raise exception 'STALE_ROUND';end if;
  if (p_payload->>'step')::integer is distinct from coalesce((g->>'step')::integer,0) then raise exception 'STALE_PHASE';end if;
  if p_action='secret' then
    if g->>'phase' is distinct from 'clue' then raise exception 'WRONG_PHASE';end if;
    if actor is distinct from g->>'giver' then raise exception 'WAVE_GIVER_ONLY';end if;
    return jsonb_build_object('target',g->'target');
  end if;
  if p_action in ('claim_host','remove','leave') then
    answer:=private.game_action_v1(p_action,r.code,null,(p_payload->>'target')::uuid,r.round_no,120);
    if p_action='leave' then return answer;end if;return private.wave_state(r.id,uid);
  end if;
  if p_action in ('start','next','cancel','resolve','timer_enable','timer_disable','timer_pause','timer_resume','timer_reset','timer_set') and me.id<>r.host_id then
    -- Anyone can settle completed guesses, or the expired clock once a guess exists.
    if p_action<>'resolve' or g->>'phase' is distinct from 'guess' or not (
      (select count(*) from jsonb_each(g->'guesses'))=jsonb_array_length(g->'players')-1 or
      (coalesce((g->>'deadline')::timestamptz<=now(),false) and g->'guesses'<>'{}'::jsonb)
    ) then raise exception 'HOST_ONLY';end if;
  end if;
  if p_action='cancel' then
    delete from private.wave_sessions where room_id=r.id;update private.rooms set phase='lobby',deadline=null where id=r.id;perform private.touch(r.id);return private.wave_state(r.id,uid);
  end if;
  if p_action in ('start','next') then
    if p_action='start' then
      if r.phase not in ('lobby','result') then raise exception 'WRONG_PHASE';end if;
      select count(*),jsonb_agg(jsonb_build_object('id',id,'name',name) order by joined_at,id) into n,roster from private.players where room_id=r.id;
      if n<2 or n>12 then raise exception 'WAVE_PLAYERS';end if;
      if exists(select 1 from private.players where room_id=r.id and last_seen<=now()-interval '60 seconds') then raise exception 'PLAYER_OFFLINE';end if;
      if jsonb_typeof(p_payload->'total') is distinct from 'number' then raise exception 'WAVE_ROUNDS';end if;
      total:=(p_payload->>'total')::integer;if total not in (4,6,8,12) then raise exception 'WAVE_ROUNDS';end if;
      timer:=coalesce(g->'timer',jsonb_build_object('enabled',false,'paused',false,'remaining_seconds',null,'duration_seconds',120));
      giver_index:=((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)%n)::integer;
      g:=jsonb_build_object('turn',1,'total',total,'score',0,'players',roster,'giver_index',giver_index,'step',1,'used','[]'::jsonb,'history','[]'::jsonb,'timer',timer||jsonb_build_object('paused',false,'remaining_seconds',null));
    else
      if g->>'phase' is distinct from 'result' then raise exception 'WRONG_PHASE';end if;
      giver_index:=((g->>'giver_index')::integer+1)%jsonb_array_length(g->'players');
      g:=g||jsonb_build_object('turn',(g->>'turn')::integer+1,'step',(g->>'step')::integer+1,'giver_index',giver_index);
    end if;
    select * into pair from private.wave_pairs where not(g->'used' @> jsonb_build_array(id)) order by gen_random_uuid() limit 1;
    if pair.id is null then raise exception 'WAVE_BANK_EMPTY';end if;
    g:=g||jsonb_build_object('phase','clue','giver',g->'players'->giver_index->>'id','pair',jsonb_build_object('id',pair.id,'left',pair.low_label,'right',pair.high_label),
      'used',g->'used'||jsonb_build_array(pair.id),'target',((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)%101)::integer,'clue','','guesses','{}'::jsonb,'deadline',null);
    insert into private.wave_sessions values(r.id,g) on conflict(room_id) do update set data=excluded.data;
    update private.rooms set round_no=round_no+1,phase='reveal',deadline=null where id=r.id;perform private.touch(r.id);return private.wave_state(r.id,uid);
  end if;
  if g is null then raise exception 'WRONG_PHASE';end if;
  case p_action
  when 'clue' then
    if g->>'phase'<>'clue' then raise exception 'WRONG_PHASE';end if;
    if actor<>g->>'giver' then raise exception 'WAVE_GIVER_ONLY';end if;
    if jsonb_typeof(p_payload->'clue') is distinct from 'string' then raise exception 'WAVE_CLUE';end if;
    clue:=trim(p_payload->>'clue');
    if char_length(clue) not between 2 and 80 or clue~'[0-9٠-٩۰-۹[:cntrl:]]' or clue~U&'[\200E\200F\202A-\202E\2066-\2069]' then raise exception 'WAVE_CLUE';end if;
    g:=g||jsonb_build_object('clue',clue,'phase','guess','step',(g->>'step')::integer+1,'deadline',case when (g->'timer'->>'enabled')::boolean then now()+make_interval(secs=>(g->'timer'->>'duration_seconds')::integer) else null end);
  when 'guess' then
    if g->>'phase'<>'guess' then raise exception 'WRONG_PHASE';end if;
    if actor=g->>'giver' then raise exception 'WAVE_GIVER_GUESS';end if;
    if not exists(select 1 from jsonb_array_elements(g->'players') p where p->>'id'=actor) then raise exception 'NOT_MEMBER';end if;
    if jsonb_typeof(p_payload->'value') is distinct from 'number' then raise exception 'WAVE_GUESS';end if;
    if (p_payload->>'value')::numeric<>trunc((p_payload->>'value')::numeric) then raise exception 'WAVE_GUESS';end if;
    value:=(p_payload->>'value')::integer;if value not between 0 and 100 then raise exception 'WAVE_GUESS';end if;
    if g->'guesses' ? actor then
      if (g->'guesses'->>actor)::integer=value then return private.wave_state(r.id,uid);end if;raise exception 'WAVE_LOCKED';
    end if;
    g:=jsonb_set(g,array['guesses',actor],to_jsonb(value));
  when 'resolve' then
    if g->>'phase'<>'guess' then raise exception 'WRONG_PHASE';end if;
    if not coalesce((p_payload->>'force')::boolean,false) and (select count(*) from jsonb_each(g->'guesses'))<jsonb_array_length(g->'players')-1 and not coalesce((g->>'deadline')::timestamptz<=now(),false) then raise exception 'WAVE_WAIT';end if;
    perform private.wave_resolve(r.id);return private.wave_state(r.id,uid);
  else
    if p_action not in ('timer_enable','timer_disable','timer_pause','timer_resume','timer_reset','timer_set') then raise exception 'ACTION_INVALID';end if;
    if g->>'phase'<>'guess' then raise exception 'WRONG_PHASE';end if;
    timer:=g->'timer';duration:=(timer->>'duration_seconds')::integer;deadline:=(g->>'deadline')::timestamptz;
    remaining:=case when (timer->>'paused')::boolean then (timer->>'remaining_seconds')::integer when deadline is not null then greatest(0,ceil(extract(epoch from deadline-now()))::integer) else duration end;
    case p_action
    when 'timer_disable' then timer:=timer||jsonb_build_object('enabled',false,'paused',false,'remaining_seconds',null);deadline:=null;
    when 'timer_pause' then if (timer->>'enabled')::boolean and not (timer->>'paused')::boolean then timer:=timer||jsonb_build_object('paused',true,'remaining_seconds',remaining);deadline:=null;end if;
    when 'timer_resume' then if (timer->>'enabled')::boolean and (timer->>'paused')::boolean then timer:=timer||jsonb_build_object('paused',false,'remaining_seconds',null);deadline:=now()+make_interval(secs=>remaining);end if;
    when 'timer_set' then duration:=(p_payload->>'seconds')::integer;if duration is null or duration not between 15 and 900 then raise exception 'INVALID_SECONDS';end if;timer:=timer||jsonb_build_object('duration_seconds',duration);if (timer->>'paused')::boolean then timer:=timer||jsonb_build_object('remaining_seconds',duration);elsif (timer->>'enabled')::boolean then deadline:=now()+make_interval(secs=>duration);end if;
    else timer:=timer||jsonb_build_object('enabled',true,'paused',false,'remaining_seconds',null);deadline:=now()+make_interval(secs=>duration);
    end case;
    g:=g||jsonb_build_object('timer',timer,'deadline',deadline);
  end case;
  update private.wave_sessions set data=g where room_id=r.id;
  update private.rooms set phase=case when g->>'phase'='clue' then 'reveal' else 'discuss' end,deadline=null where id=r.id;
  if g->>'phase'='guess' and (select count(*) from jsonb_each(g->'guesses'))=jsonb_array_length(g->'players')-1 then perform private.wave_resolve(r.id);else perform private.touch(r.id);end if;
  return private.wave_state(r.id,uid);
end $$;
revoke all on function public.wave_action(text,text,integer,jsonb) from public,anon;
grant execute on function public.wave_action(text,text,integer,jsonb) to authenticated;

-- Preserve all existing games while routing generic joins by room type.
create or replace function public.game_action(p_action text,p_code text default '',p_name text default null,p_target uuid default null,p_round integer default null,p_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare game text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
  if p_action<>'create' then
    select game_key into game from private.rooms where code=upper(trim(p_code));
    if game in ('wave','mafia','crime') then
      if p_action<>'join' then raise exception 'WRONG_GAME';end if;
      if game='wave' then return public.wave_action('join',p_code,p_round,jsonb_build_object('name',p_name));
      elsif game='mafia' then return public.mafia_action('join',p_code,p_round,jsonb_build_object('name',p_name));
      else return public.crime_action('join',p_code,p_round,jsonb_build_object('name',p_name));end if;
    end if;
  end if;
  return private.outsider_action_v2(p_action,p_code,p_name,p_target,p_round,p_seconds);
end $$;
revoke all on function public.game_action(text,text,text,uuid,integer,integer) from public,anon;
grant execute on function public.game_action(text,text,text,uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;

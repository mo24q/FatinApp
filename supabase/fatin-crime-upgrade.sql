-- Fatin existing database upgrade: requires 001 already installed.
-- Includes 002 and 003 atomically; do not run 001 again.
begin;
-- 002_host_timer.sql
-- Existing installations: run this file ONLY; never re-run 001_lamma.sql.
-- Additive, transactional and safe to re-run. No player/round data is deleted.
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

-- 003_closed_case.sql
-- Fatin: الجريمة المغلقة. Apply AFTER 001 and 002. Safe to re-run.
-- Existing outsider rooms/players stay intact. Secrets remain in private schema.
alter table private.rooms add column if not exists game_key text not null default 'outsider';
create table if not exists private.crime_cards (
  id text primary key, kind text not null check(kind in ('weapon','evidence')), name text not null
);
create table if not exists private.crime_clues (
  id text primary key, options jsonb not null check(jsonb_typeof(options)='array')
);
create table if not exists private.crime_rounds (
  room_id uuid not null references private.rooms(id) on delete cascade,
  number integer not null,
  narrator_id uuid not null, killer_id uuid not null,
  hands jsonb not null, solution jsonb,
  clues jsonb not null default '{}', accusations jsonb not null default '[]',
  ready uuid[] not null default '{}', caught boolean not null default false,
  primary key(room_id,number), check(narrator_id<>killer_id)
);
alter table private.crime_cards enable row level security;
alter table private.crime_clues enable row level security;
alter table private.crime_rounds enable row level security;
revoke all on private.crime_cards,private.crime_clues,private.crime_rounds from public,anon,authenticated;

insert into private.crime_cards(id,kind,name) values
('w01','weapon','مطرقة'),
('w02','weapon','سكين مطبخ'),
('w03','weapon','مقص'),
('w04','weapon','فأس'),
('w05','weapon','مفتاح ربط'),
('w06','weapon','مفك'),
('w07','weapon','منشار'),
('w08','weapon','مجرفة'),
('w09','weapon','حبل'),
('w10','weapon','سلسلة'),
('w11','weapon','سلك كهرباء'),
('w12','weapon','حزام'),
('w13','weapon','حجر'),
('w14','weapon','قالب طوب'),
('w15','weapon','عصا خشبية'),
('w16','weapon','مضرب بيسبول'),
('w17','weapon','مقلاة'),
('w18','weapon','قدر'),
('w19','weapon','زجاجة'),
('w20','weapon','قطعة زجاج'),
('w21','weapon','مزهرية'),
('w22','weapon','تمثال صغير'),
('w23','weapon','كأس بطولة'),
('w24','weapon','ثقل رياضي'),
('w25','weapon','مظلة'),
('w26','weapon','عكاز'),
('w27','weapon','مصباح يدوي'),
('w28','weapon','شمعدان'),
('w29','weapon','مفتاح أنابيب'),
('w30','weapon','كماشة'),
('w31','weapon','مثقاب'),
('w32','weapon','مبرد معدني'),
('w33','weapon','خطاف'),
('w34','weapon','مسمار كبير'),
('w35','weapon','شوكة كبيرة'),
('w36','weapon','سيخ معدني'),
('w37','weapon','لوح خشب'),
('w38','weapon','ساق كرسي'),
('w39','weapon','عصا بلياردو'),
('w40','weapon','مضرب تنس'),
('w41','weapon','قوس وسهم'),
('w42','weapon','مطرقة مطاطية'),
('w43','weapon','جرس معدني'),
('w44','weapon','مكواة'),
('w45','weapon','إبريق'),
('w46','weapon','حجر زينة'),
('w47','weapon','قفل ثقيل'),
('w48','weapon','ميزان معدني'),
('w49','weapon','حامل كتب'),
('w50','weapon','أنبوب معدني'),
('w51','weapon','قطعة سيراميك'),
('w52','weapon','حبل قفز'),
('w53','weapon','عود مشي'),
('w54','weapon','ثقالة ورق'),
('w55','weapon','زجاجة عطر'),
('w56','weapon','عود طبلة'),
('w57','weapon','رافعة صغيرة'),
('w58','weapon','دباسة معدنية'),
('w59','weapon','صندوق أدوات'),
('w60','weapon','ساطور'),
('w61','weapon','ملقط فحم'),
('w62','weapon','بلطة تخييم'),
('w63','weapon','مفتاح عجلات'),
('w64','weapon','دلو معدني'),
('e01','evidence','مفتاح'),
('e02','evidence','ساعة يد'),
('e03','evidence','خاتم'),
('e04','evidence','نظارة'),
('e05','evidence','هاتف'),
('e06','evidence','محفظة'),
('e07','evidence','تذكرة سفر'),
('e08','evidence','إيصال شراء'),
('e09','evidence','صورة قديمة'),
('e10','evidence','زر قميص'),
('e11','evidence','قفاز'),
('e12','evidence','منديل'),
('e13','evidence','ريشة'),
('e14','evidence','ورقة شجر'),
('e15','evidence','زهرة جافة'),
('e16','evidence','ظرف'),
('e17','evidence','خريطة'),
('e18','evidence','كوب قهوة'),
('e19','evidence','قلم'),
('e20','evidence','دفتر'),
('e21','evidence','عملة'),
('e22','evidence','حجر نرد'),
('e23','evidence','بطاقة لعب'),
('e24','evidence','جهاز تحكم'),
('e25','evidence','سماعة'),
('e26','evidence','شاحن'),
('e27','evidence','كمامة'),
('e28','evidence','علبة كبريت'),
('e29','evidence','حذاء'),
('e30','evidence','قبعة'),
('e31','evidence','وشاح'),
('e32','evidence','ربطة عنق'),
('e33','evidence','مشبك شعر'),
('e34','evidence','قلادة'),
('e35','evidence','سوار'),
('e36','evidence','بروش'),
('e37','evidence','مفتاح سيارة'),
('e38','evidence','بطاقة دخول'),
('e39','evidence','تذكرة سينما'),
('e40','evidence','بطاقة بريدية'),
('e41','evidence','فاتورة مطعم'),
('e42','evidence','قائمة مشتريات'),
('e43','evidence','كتاب'),
('e44','evidence','جريدة'),
('e45','evidence','حقيبة صغيرة'),
('e46','evidence','مظروف نقدي'),
('e47','evidence','علبة حلوى'),
('e48','evidence','غلاف شوكولاتة'),
('e49','evidence','قنينة ماء'),
('e50','evidence','غطاء زجاجة'),
('e51','evidence','فرشاة'),
('e52','evidence','مرآة جيب'),
('e53','evidence','مفتاح غرفة'),
('e54','evidence','فلاش ذاكرة'),
('e55','evidence','كاميرا'),
('e56','evidence','قرص موسيقى'),
('e57','evidence','تذكرة موقف'),
('e58','evidence','كرة صغيرة'),
('e59','evidence','قطعة قماش'),
('e60','evidence','بكرة خيط'),
('e61','evidence','صدفة'),
('e62','evidence','قطعة أحجية'),
('e63','evidence','مشبك ورق'),
('e64','evidence','ختم')
on conflict(id) do update set name=excluded.name,kind=excluded.kind;

insert into private.crime_clues(id,options) values
('place','["منزل","مكان عمل","مكان مفتوح","وسيلة نقل","مكان عام","غير واضح"]'::jsonb),
('trace','["كسر","فوضى","خدش","شيء مفقود","شيء متروك","أثر خفيف"]'::jsonb),
('material','["معدن","خشب","قماش","زجاج","ورق","بلاستيك"]'::jsonb),
('mood','["روتين يومي","رحلة","مناسبة","خلاف","عمل مستعجل","مفاجأة"]'::jsonb),
('object','["صغير","ثقيل","قابل للطي","لامع","قديم","شخصي"]'::jsonb),
('link','["هواية","مهنة","ذكرى","شراء","تنقّل","مظهر"]'::jsonb)
on conflict(id) do update set options=excluded.options;

create or replace function private.crime_state(p_room uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.rooms; me private.players; g private.crime_rounds;
begin
  select * into r from private.rooms where id=p_room and expires_at>now() and game_key='crime';
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into me from private.players where room_id=r.id and user_id=p_user;
  if me.id is null then raise exception 'NOT_MEMBER'; end if;
  select * into g from private.crime_rounds where room_id=r.id and number=r.round_no;
  return jsonb_build_object(
    'game','crime','id',r.id,'code',r.code,'phase',case when r.phase='discuss' then 'investigate' else r.phase end,
    'round',r.round_no,'revision',(select revision from public.room_events where room_id=r.id),
    'me',me.id,'is_host',me.id=r.host_id,'host_offline',not exists(select 1 from private.players where id=r.host_id and last_seen>now()-interval '60 seconds'),
    'narrator_id',case when r.phase='lobby' then null else g.narrator_id end,
    'players',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'online',p.last_seen>now()-interval '60 seconds',
      'ready',coalesce(p.id=any(g.ready),false)) order by p.joined_at,p.id),'[]') from private.players p where room_id=r.id),
    'hands',case when r.phase='lobby' then '[]'::jsonb else coalesce(g.hands,'[]') end,
    'clues',case when r.phase='lobby' then '{}'::jsonb else coalesce(g.clues,'{}') end,
    'accusations',case when r.phase='lobby' then '[]'::jsonb else coalesce(g.accusations,'[]') end,
    'solution_ready',g.solution is not null and r.phase<>'lobby',
    'result',case when r.phase='result' then g.solution||jsonb_build_object('caught',g.caught) else null end,
    'server_time',now(),'deadline',r.deadline,
    'timer',jsonb_build_object('enabled',r.timer_enabled,'paused',r.timer_paused,'remaining_seconds',r.timer_remaining,'duration_seconds',r.discussion_seconds)
  );
end $$;
revoke all on function private.crime_state(uuid,uuid) from public,anon,authenticated;

create or replace function public.crime_action(
  p_action text,p_code text default '',p_round integer default null,p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r private.rooms; me private.players; g private.crime_rounds;
  answer jsonb; target uuid; narrator uuid; killer uuid; old_killer uuid; hand jsonb; new_hands jsonb:='[]';
  weapons text[]; evidence text[]; item record; idx integer:=1; weapon text; clue text; correct boolean;
  duration integer; remaining integer; board text; choice text;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4096 then raise exception 'INVALID_PAYLOAD'; end if;
  if p_action='create' then
    answer:=private.game_action_v1('create','',p_payload->>'name',null,null,300);
    update private.rooms set game_key='crime',timer_enabled=false where id=(answer->>'id')::uuid returning * into r;
    return private.crime_state(r.id,uid);
  end if;
  -- Match the shared guest-lock -> room-lock ordering used by the original join.
  if p_action='join' then perform pg_advisory_xact_lock(hashtextextended(uid::text,0)); end if;
  select * into r from private.rooms where code=upper(trim(p_code)) and expires_at>now() for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.game_key<>'crime' then raise exception 'WRONG_GAME'; end if;
  if p_action='join' then
    perform private.game_action_v1('join',r.code,p_payload->>'name',null,null,120);
    return private.crime_state(r.id,uid);
  end if;
  select * into me from private.players where room_id=r.id and user_id=uid;
  if me.id is null then raise exception 'NOT_MEMBER'; end if;
  update private.players set last_seen=now() where id=me.id;
  if p_action='state' then return private.crime_state(r.id,uid); end if;
  if p_round is distinct from r.round_no then raise exception 'STALE_ROUND'; end if;
  select * into g from private.crime_rounds where room_id=r.id and number=r.round_no;
  if p_action='role' then
    if r.phase not in ('reveal','discuss') then raise exception 'WRONG_PHASE'; end if;
    return jsonb_build_object('round',r.round_no,'role',case when me.id=g.narrator_id then 'narrator' when me.id=g.killer_id then 'killer' else 'investigator' end,
      'solution',case when me.id in (g.narrator_id,g.killer_id) then g.solution else null end);
  end if;
  if p_action in ('claim_host','remove','leave') then
    if p_action='remove' and me.id<>r.host_id then raise exception 'HOST_ONLY'; end if;
    answer:=private.game_action_v1(p_action,r.code,null,(p_payload->>'target')::uuid,r.round_no,120);
    if p_action='leave' then return answer; end if;
    return private.crime_state(r.id,uid);
  end if;
  if p_action in ('start','cancel','investigate') or p_action like 'timer_%' then
    if me.id<>r.host_id then raise exception 'HOST_ONLY'; end if;
  end if;
  case p_action
  when 'start' then
    if r.phase not in ('lobby','result') then raise exception 'WRONG_PHASE'; end if;
    if (select count(*) from private.players where room_id=r.id)<4 then raise exception 'CRIME_NEED_PLAYERS'; end if;
    if exists(select 1 from private.players where room_id=r.id and last_seen<=now()-interval '60 seconds') then raise exception 'PLAYER_OFFLINE'; end if;
    narrator:=(p_payload->>'narrator')::uuid;
    if narrator is null or not exists(select 1 from private.players where room_id=r.id and id=narrator) then raise exception 'INVALID_NARRATOR'; end if;
    old_killer:=g.killer_id;
    select id into killer from private.players where room_id=r.id and id<>narrator and id is distinct from old_killer order by gen_random_uuid() limit 1;
    select array_agg(id order by gen_random_uuid()) into weapons from private.crime_cards where kind='weapon';
    select array_agg(id order by gen_random_uuid()) into evidence from private.crime_cards where kind='evidence';
    if least(cardinality(weapons),cardinality(evidence))<(select (count(*)-1)*4 from private.players where room_id=r.id) then raise exception 'DECK_TOO_SMALL'; end if;
    for item in select id from private.players where room_id=r.id and id<>narrator order by joined_at,id loop
      new_hands:=new_hands||jsonb_build_array(jsonb_build_object('player_id',item.id,'weapons',to_jsonb(weapons[idx:idx+3]),'evidence',to_jsonb(evidence[idx:idx+3])));
      idx:=idx+4;
    end loop;
    insert into private.crime_rounds(room_id,number,narrator_id,killer_id,hands) values(r.id,r.round_no+1,narrator,killer,new_hands);
    update private.rooms set phase='reveal',round_no=round_no+1,deadline=null,timer_paused=false,timer_remaining=null where id=r.id;
  when 'choose' then
    if r.phase<>'reveal' then raise exception 'WRONG_PHASE'; end if;
    if me.id<>g.killer_id then raise exception 'KILLER_ONLY'; end if;
    weapon:=p_payload->>'weapon';clue:=p_payload->>'evidence';
    select value into hand from jsonb_array_elements(g.hands) where value->>'player_id'=me.id::text;
    if weapon is null or clue is null or not(hand->'weapons' ? weapon) or not(hand->'evidence' ? clue) then raise exception 'INVALID_CARDS'; end if;
    if g.solution is not null then
      if g.solution->>'weapon'=weapon and g.solution->>'evidence'=clue then return private.crime_state(r.id,uid); end if;
      raise exception 'SOLUTION_LOCKED';
    end if;
    update private.crime_rounds set solution=jsonb_build_object('killer_id',me.id,'weapon',weapon,'evidence',clue) where room_id=r.id and number=r.round_no;
  when 'ready' then
    if r.phase<>'reveal' then raise exception 'WRONG_PHASE'; end if;
    if me.id=g.killer_id and g.solution is null then raise exception 'SOLUTION_REQUIRED'; end if;
    if not(me.id=any(g.ready)) then update private.crime_rounds set ready=array_append(ready,me.id) where room_id=r.id and number=r.round_no; end if;
  when 'investigate' then
    if r.phase<>'reveal' then raise exception 'WRONG_PHASE'; end if;
    if g.solution is null then raise exception 'SOLUTION_REQUIRED'; end if;
    if cardinality(g.ready)<>(select count(*) from private.players where room_id=r.id) then raise exception 'NOT_READY'; end if;
    update private.rooms set phase='discuss',deadline=case when timer_enabled then now()+make_interval(secs=>discussion_seconds) else null end where id=r.id;
  when 'clue' then
    if r.phase<>'discuss' then raise exception 'WRONG_PHASE'; end if;
    if me.id<>g.narrator_id then raise exception 'NARRATOR_ONLY'; end if;
    board:=p_payload->>'board';choice:=p_payload->>'choice';
    if choice is null or not exists(select 1 from private.crime_clues where id=board and options ? choice) then raise exception 'INVALID_CLUE'; end if;
    update private.crime_rounds set clues=jsonb_set(clues,array[board],to_jsonb(choice)) where room_id=r.id and number=r.round_no;
  when 'accuse' then
    if r.phase<>'discuss' then raise exception 'WRONG_PHASE'; end if;
    target:=(p_payload->>'target')::uuid;weapon:=p_payload->>'weapon';clue:=p_payload->>'evidence';
    if me.id=g.narrator_id or target is null or target in (me.id,g.narrator_id) then raise exception 'INVALID_ACCUSATION'; end if;
    if exists(select 1 from jsonb_array_elements(g.accusations) where value->>'actor'=me.id::text) then
      -- Exact retries are idempotent. A different choice must never spend another attempt.
      if exists(select 1 from jsonb_array_elements(g.accusations) where value->>'actor'=me.id::text and value->>'target'=target::text and value->>'weapon'=weapon and value->>'evidence'=clue) then return private.crime_state(r.id,uid); end if;
      raise exception 'ALREADY_ACCUSED';
    end if;
    select value into hand from jsonb_array_elements(g.hands) where value->>'player_id'=target::text;
    if hand is null or weapon is null or clue is null or not(hand->'weapons' ? weapon) or not(hand->'evidence' ? clue) then raise exception 'INVALID_CARDS'; end if;
    correct:=target=g.killer_id and weapon=g.solution->>'weapon' and clue=g.solution->>'evidence';
    update private.crime_rounds set accusations=accusations||jsonb_build_array(jsonb_build_object('actor',me.id,'target',target,'weapon',weapon,'evidence',clue,'correct',correct)),caught=correct where room_id=r.id and number=r.round_no;
    if correct or jsonb_array_length(g.accusations)+1=jsonb_array_length(g.hands) then
      update private.rooms set phase='result',deadline=null where id=r.id;
    end if;
  when 'close' then
    if r.phase<>'discuss' then raise exception 'WRONG_PHASE'; end if;
    if me.id<>g.narrator_id then raise exception 'NARRATOR_ONLY'; end if;
    update private.rooms set phase='result',deadline=null where id=r.id;
  when 'cancel' then
    if r.phase not in ('reveal','discuss') then raise exception 'WRONG_PHASE'; end if;
    update private.rooms set phase='lobby',deadline=null,timer_paused=false,timer_remaining=null where id=r.id;
  else
    if p_action not in ('timer_enable','timer_disable','timer_pause','timer_resume','timer_reset','timer_set') then raise exception 'ACTION_INVALID'; end if;
    if r.phase<>'discuss' or p_payload->>'phase' is distinct from 'investigate' then raise exception 'STALE_PHASE'; end if;
    remaining:=case when r.timer_paused then coalesce(r.timer_remaining,0) when r.deadline is null then r.discussion_seconds else greatest(0,ceil(extract(epoch from r.deadline-now()))::integer) end;
    case p_action
    when 'timer_disable' then
      update private.rooms set timer_enabled=false,timer_paused=false,timer_remaining=null,deadline=null where id=r.id;
    when 'timer_pause' then
      if r.timer_enabled and not r.timer_paused then update private.rooms set timer_paused=true,timer_remaining=remaining,deadline=null where id=r.id; end if;
    when 'timer_resume' then
      if r.timer_enabled and r.timer_paused then update private.rooms set timer_paused=false,timer_remaining=null,deadline=now()+make_interval(secs=>remaining) where id=r.id; end if;
    when 'timer_set' then
      duration:=(p_payload->>'seconds')::integer;
      if duration is null or duration not between 15 and 900 then raise exception 'INVALID_SECONDS'; end if;
      update private.rooms set discussion_seconds=duration,timer_remaining=case when timer_paused then duration else null end,
        deadline=case when timer_enabled and not timer_paused then now()+make_interval(secs=>duration) else null end where id=r.id;
    else
      if p_action='timer_reset' or not r.timer_enabled then
        update private.rooms set timer_enabled=true,timer_paused=false,timer_remaining=null,deadline=now()+make_interval(secs=>discussion_seconds) where id=r.id;
      end if;
    end case;
  end case;
  perform private.touch(r.id);
  return private.crime_state(r.id,uid);
end $$;
revoke all on function public.crime_action(text,text,integer,jsonb) from public,anon;
grant execute on function public.crime_action(text,text,integer,jsonb) to authenticated;

-- A dispatcher protects game boundaries and makes the main join form universal.
do $$ begin
  if to_regprocedure('private.outsider_action_v2(text,text,text,uuid,integer,integer)') is null then
    alter function public.game_action(text,text,text,uuid,integer,integer) set schema private;
    alter function private.game_action(text,text,text,uuid,integer,integer) rename to outsider_action_v2;
  end if;
end $$;
revoke all on function private.outsider_action_v2(text,text,text,uuid,integer,integer) from public,anon,authenticated;
create or replace function public.game_action(
  p_action text,p_code text default '',p_name text default null,p_target uuid default null,p_round integer default null,p_seconds integer default 120
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action<>'create' and exists(select 1 from private.rooms where code=upper(trim(p_code)) and game_key='crime') then
    if p_action='join' then return public.crime_action('join',p_code,p_round,jsonb_build_object('name',p_name)); end if;
    raise exception 'WRONG_GAME';
  end if;
  return private.outsider_action_v2(p_action,p_code,p_name,p_target,p_round,p_seconds);
end $$;
revoke all on function public.game_action(text,text,text,uuid,integer,integer) from public,anon;
grant execute on function public.game_action(text,text,text,uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;

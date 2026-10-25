-- Fatin 009: repair missing foundations after an incomplete upgrade.
-- Requires 001 only. Also safe after 002-008 and safe to repeat.
-- Preserves active rooms and existing content. Run this entire file once.
begin;
do $$ declare name text; begin
  foreach name in array array['private.rooms','private.players','private.guest_limits',
    'private.words','private.rounds','private.round_players','private.votes','public.room_events'] loop
    if to_regclass(name) is null then
      raise exception 'FATIN_BASE_MISSING: %. Use 001 only for a new empty database.',name;
    end if;
  end loop;
end $$;
alter table private.rooms add column if not exists timer_enabled boolean not null default true;
alter table private.rooms add column if not exists timer_paused boolean not null default false;
alter table private.rooms add column if not exists timer_remaining integer;
alter table private.rooms add column if not exists vote_seconds integer not null default 60;
create or replace function private.touch(p_room uuid) returns void
language sql security definer set search_path = '' as $$
  update public.room_events set revision=revision+1 where room_id=p_room;
$$;
revoke all on function private.touch(uuid) from public,anon,authenticated;
create or replace function private.room_state_v1(p_room uuid, p_user uuid) returns jsonb
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
revoke all on function private.room_state_v1(uuid,uuid) from public,anon,authenticated;
create or replace function private.game_action_v1(
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
revoke all on function private.game_action_v1(text,text,text,uuid,integer,integer) from public,anon,authenticated;
create or replace function private.outsider_action_v2(
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
revoke all on function private.outsider_action_v2(text,text,text,uuid,integer,integer) from public,anon,authenticated;

-- Restore crime tables and functions without replacing existing cards.
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
on conflict(id) do nothing;

insert into private.crime_clues(id,options) values
('place','["منزل","مكان عمل","مكان مفتوح","وسيلة نقل","مكان عام","غير واضح"]'::jsonb),
('trace','["كسر","فوضى","خدش","شيء مفقود","شيء متروك","أثر خفيف"]'::jsonb),
('material','["معدن","خشب","قماش","زجاج","ورق","بلاستيك"]'::jsonb),
('mood','["روتين يومي","رحلة","مناسبة","خلاف","عمل مستعجل","مفاجأة"]'::jsonb),
('object','["صغير","ثقيل","قابل للطي","لامع","قديم","شخصي"]'::jsonb),
('link','["هواية","مهنة","ذكرى","شراء","تنقّل","مظهر"]'::jsonb)
on conflict(id) do nothing;

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


-- Restore the latest rules and public dispatchers for all six games.
-- Fatin readiness recovery. Requires migrations 001, 002 and 003.
-- Safe to repeat; preserves active rooms and existing content.

-- Source: 004_mafia.sql
-- Fatin Mafia. Apply after 001, 002 and 003. Additive and repeatable.

create table if not exists private.mafia_sessions (
  room_id uuid primary key references private.rooms(id) on delete cascade,
  data jsonb not null
);
alter table private.mafia_sessions enable row level security;
revoke all on private.mafia_sessions from public,anon,authenticated;

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
    'done',case g->>'phase' when 'reveal' then g->'ready' ? (p->>'id') when 'night' then g->'actions' ? (p->>'id') when 'vote' then g->'votes' ? (p->>'id') else false end,
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
      'ready','[]'::jsonb,'actions','{}'::jsonb,'votes','{}'::jsonb,'scans','[]'::jsonb,'last_save',null,'winner',null,'log','[]'::jsonb,
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
        when 'resolve_night' then not exists(select 1 from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and not(g->'actions' ? (p->>'id')))
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
    g:=jsonb_set(g,array['actions',actor],to_jsonb(target));
  when 'resolve_night' then
    if old_phase<>'night' then raise exception 'WRONG_PHASE'; end if;
    if not coalesce((p_payload->>'force')::boolean,false) and exists(select 1 from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and not(g->'actions' ? (p->>'id'))) then raise exception 'WAIT_ACTIONS';end if;
    select jsonb_object_agg(choice,n) into tally from (select coalesce(g->'actions'->>(p->>'id'),'skip') choice,count(*) n from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and g->'roles'->>(p->>'id')='mafia' group by 1) q;
    select max(value::integer) into highest from jsonb_each_text(tally);
    select count(*),min(key) into tied,victim from jsonb_each_text(tally) where value::integer=highest;
    if tied<>1 or victim='skip' then victim:=null;end if;
    select p->>'id' into doctor_id from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and g->'roles'->>(p->>'id')='doctor';
    saved:=nullif(g->'actions'->>doctor_id,'skip');
    if victim=saved then victim:=null;end if;
    g:=g||jsonb_build_object('last_save',saved);
    select p->>'id' into detective_id from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and g->'roles'->>(p->>'id')='detective';
    inspected:=nullif(g->'actions'->>detective_id,'skip');
    if inspected is not null then g:=jsonb_set(g,'{scans}',g->'scans'||jsonb_build_array(jsonb_build_object('cycle',g->'cycle','target',inspected,'mafia',g->'roles'->>inspected='mafia')));end if;
    g:=g||jsonb_build_object('phase','day','actions','{}'::jsonb,'log',g->'log'||jsonb_build_array(jsonb_build_object('cycle',g->'cycle','kind','night','eliminated',victim)));
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
    g:=g||jsonb_build_object('phase','night','cycle',(g->>'cycle')::integer+1,'actions','{}'::jsonb,'votes','{}'::jsonb,
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
    elsif g->>'phase'='night' and not exists(select 1 from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and not(g->'actions' ? (p->>'id'))) then
      return public.mafia_action('resolve_night',r.code,r.round_no,jsonb_build_object('step',g->'step'));
    elsif g->>'phase'='vote' and not exists(select 1 from jsonb_array_elements(g->'players') p where (p->>'alive')::boolean and not(g->'votes' ? (p->>'id'))) then
      return public.mafia_action('resolve_vote',r.code,r.round_no,jsonb_build_object('step',g->'step'));
    end if;
  end if;
  return private.mafia_state(r.id,uid);
end $$;
revoke all on function public.mafia_action(text,text,integer,jsonb) from public,anon;
grant execute on function public.mafia_action(text,text,integer,jsonb) to authenticated;

-- Central join dispatcher. Other games cannot mutate Mafia rooms.
create or replace function public.game_action(p_action text,p_code text default '',p_name text default null,p_target uuid default null,p_round integer default null,p_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare game text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
  if p_action<>'create' then
    select game_key into game from private.rooms where code=upper(trim(p_code));
    if game='mafia' then
      if p_action='join' then return public.mafia_action('join',p_code,p_round,jsonb_build_object('name',p_name));end if;
      raise exception 'WRONG_GAME';
    elsif game='crime' then
      if p_action='join' then return public.crime_action('join',p_code,p_round,jsonb_build_object('name',p_name));end if;
      raise exception 'WRONG_GAME';
    end if;
  end if;
  return private.outsider_action_v2(p_action,p_code,p_name,p_target,p_round,p_seconds);
end $$;
revoke all on function public.game_action(text,text,text,uuid,integer,integer) from public,anon;
grant execute on function public.game_action(text,text,text,uuid,integer,integer) to authenticated;


-- Source: 005_same_wave.sql
-- Fatin: same wave. Apply after 001, 002, 003 and 004. Repeatable additive migration.

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
on conflict(id) do nothing;

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
    if (g->>'deadline')::timestamptz<=now() and g->'guesses'<>'{}'::jsonb then
      perform private.wave_resolve(r.id);return private.wave_state(r.id,uid);
    end if;
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


-- Source: 006_questions_letters.sql
-- Fatin: wrong question + Arabic letters. Apply after migrations 001 through 005.

create table if not exists private.party_bank(game text not null check(game in ('wrong','letters')),id integer not null,a text not null,b text,input text not null default 'text' check(input in ('text','number')),primary key(game,id));
create table if not exists private.party_sessions(room_id uuid primary key references private.rooms(id) on delete cascade,data jsonb not null);
alter table private.party_bank enable row level security;
alter table private.party_sessions enable row level security;
revoke all on private.party_bank,private.party_sessions from public,anon,authenticated;
insert into private.party_bank(game,id,a,b,input) values
('wrong',0,'وش المشروب اللي تحبه؟','وش المشروب اللي ما تحبه؟','text'),
('wrong',1,'وش الأكلة اللي تطلبها دائمًا؟','وش الأكلة اللي تتجنب تطلبها؟','text'),
('wrong',2,'وش لون تحب تلبسه؟','وش لون ما تحب تلبسه؟','text'),
('wrong',3,'وش المادة اللي كنت تحبها بالمدرسة؟','وش المادة اللي كانت تتعبك بالمدرسة؟','text'),
('wrong',4,'وش مدينة ودك تسكن فيها؟','وش مدينة تفضل تزورها فقط؟','text'),
('wrong',5,'وش حيوان تتمنى تربيه؟','وش حيوان ما تبي تلقاه في بيتك؟','text'),
('wrong',6,'وش تطبيق تستخدمه كثير؟','وش تطبيق ودك تقلل استخدامه؟','text'),
('wrong',7,'وش أكلة تصلح للفطور؟','وش أكلة تصلح للعشاء؟','text'),
('wrong',8,'وش شيء تشتريه لنفسك؟','وش شيء تشتريه هدية لغيرك؟','text'),
('wrong',9,'وش مكان تروح له عشان ترتاح؟','وش مكان تروح له عشان تتحمس؟','text'),
('wrong',10,'وش وظيفة كنت تتمناها وأنت صغير؟','وش وظيفة ما تتخيل نفسك تشتغلها؟','text'),
('wrong',11,'وش رياضة تحب تلعبها؟','وش رياضة تفضل تتفرج عليها؟','text'),
('wrong',12,'وش فيلم ودك تشوفه مرة ثانية؟','وش فيلم ما ودك تعيد مشاهدته؟','text'),
('wrong',13,'وش لعبة تشوف نفسك شاطر فيها؟','وش لعبة تشوف نفسك ضعيف فيها؟','text'),
('wrong',14,'وش رائحة تحبها؟','وش رائحة ما تحبها؟','text'),
('wrong',15,'وش شيء تحب تسويه بدري؟','وش شيء غالبًا تأجله؟','text'),
('wrong',16,'وش شيء تاخذه معك للبحر؟','وش شيء تاخذه معك للبر؟','text'),
('wrong',17,'وش شيء يخليك تصحصح؟','وش شيء يخليك تنعس؟','text'),
('wrong',18,'وش شيء يعجبك في السفر؟','وش شيء يتعبك في السفر؟','text'),
('wrong',19,'وش شيء تحب تسويه لحالك؟','وش شيء تحب تسويه مع أصحابك؟','text'),
('wrong',20,'وش تحب تضيف على البيتزا؟','وش ما تحب يكون على البيتزا؟','text'),
('wrong',21,'وش فاكهة تحبها كعصير؟','وش فاكهة تحب تاكلها كما هي؟','text'),
('wrong',22,'وش شيء يضحكك؟','وش شيء يستفزك؟','text'),
('wrong',23,'وش شيء يستاهل تدفع عليه؟','وش شيء تحس سعره مبالغ فيه؟','text'),
('wrong',24,'وش شيء تحب تشتريه جديد؟','وش شيء عادي تشتريه مستعمل؟','text'),
('wrong',25,'وش حلى تحبه؟','وش حلى ما يعجبك؟','text'),
('wrong',26,'وش شيء يذكرك بالصيف؟','وش شيء يذكرك بالشتاء؟','text'),
('wrong',27,'وش شيء تأخذه معك لو انتقلت لبيت جديد؟','وش شيء تتخلص منه لو انتقلت لبيت جديد؟','text'),
('wrong',28,'كم تشوف العمر المناسب للزواج؟','عند كم بالمئة عادة تشحن جوالك؟','number'),
('wrong',29,'كم دقيقة تحتاج عشان تتجهز لطلعة؟','كم دقيقة تقدر تنتظر طلبك في مطعم؟','number'),
('wrong',30,'كم ساعة نوم تشوفها كافية؟','كم ساعة تقدر تتحمل رحلة بالسيارة؟','number'),
('wrong',31,'كم يوم تشوفه مناسب لإجازة؟','كم يوم تقدر تقعد بدون جوالك؟','number'),
('wrong',32,'كم ريال مناسب لكوب قهوة؟','كم ريال مناسب لوجبة فطور؟','number'),
('wrong',33,'كم شخص مناسب لجلسة هادئة؟','كم شخص مناسب لطلعة حماسية؟','number'),
('wrong',34,'كم دقيقة تشوفها مناسبة للمشي يوميًا؟','كم دقيقة تتحمل تنتظر في طابور؟','number'),
('wrong',35,'كم مرة تطلب أكل في الأسبوع؟','كم مرة تطبخ في الأسبوع؟','number'),
('wrong',36,'كم سنة تشوفها مناسبة لتغيير الجوال؟','كم سنة تشوفها مناسبة لتغيير السيارة؟','number'),
('wrong',37,'كم ريال تشوفه مناسب لهدية بسيطة؟','كم ريال تشوفه مناسب لعشاء في مطعم؟','number'),
('wrong',38,'كم دقيقة مناسبة لحلقة مسلسل؟','كم دقيقة مناسبة لاستراحة؟','number'),
('wrong',39,'كم درجة حرارة تشوفها مريحة للجو؟','كم درجة عادة تضبط عليها المكيف؟','number'),
('letters',0,'شيء تحبه',null,'text'),
('letters',1,'شيء تلقاه في البيت',null,'text'),
('letters',2,'شيء تشتريه',null,'text'),
('letters',3,'شيء يفرحك',null,'text'),
('letters',4,'شيء تاخذه معك في السفر',null,'text'),
('letters',5,'شيء تلقاه في السوق',null,'text'),
('letters',6,'شيء له لون',null,'text'),
('letters',7,'شيء تستخدمه كل يوم',null,'text'),
('letters',8,'شيء يصلح هدية',null,'text'),
('letters',9,'شيء تشوفه في الشارع',null,'text'),
('letters',10,'شيء تقدر تمسكه',null,'text'),
('letters',11,'شيء له رائحة',null,'text'),
('letters',12,'شيء له صوت',null,'text'),
('letters',13,'شيء يذكرك بالطفولة',null,'text'),
('letters',14,'شيء تحتاجه في طلعة',null,'text'),
('letters',15,'شيء ممكن يكون في صورة',null,'text'),
('letters',16,'شيء ودك تجربه',null,'text'),
('letters',17,'شيء تلقاه في المدرسة',null,'text'),
('letters',18,'شيء تخزنه',null,'text'),
('letters',19,'شيء تشوفه في الطبيعة',null,'text'),
('letters',20,'شيء يسهّل حياتك',null,'text'),
('letters',21,'شيء يخلّيك تتحمس',null,'text'),
('letters',22,'شيء تنتظره',null,'text'),
('letters',23,'شيء له أشكال مختلفة',null,'text'),
('letters',24,'شيء يجي بأحجام مختلفة',null,'text'),
('letters',25,'شيء تتكلم عنه مع أصحابك',null,'text'),
('letters',26,'شيء يذكرك بالإجازة',null,'text'),
('letters',27,'شيء تقدر توصفه بكلمة',null,'text'),
('letters',28,'شيء موجود حولك',null,'text'),
('letters',29,'شيء تحب تشوفه',null,'text')
on conflict(game,id) do nothing;

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
  if r.game_key='wrong' and g->>'phase'='result' then
    select * into bank from private.party_bank where game='wrong' and id=(g->>'bank_id')::integer;
    select coalesce(jsonb_object_agg(target,n),'{}') into tally from(select value target,count(*) n from jsonb_each_text(g->'votes') group by value) v;
    select max(value::integer) into top_count from jsonb_each_text(tally);
    select count(*),min(key) into leaders,suspect from jsonb_each_text(tally) where value::integer=top_count;
    solution:=jsonb_build_object('odd',g->>'odd','common',case when (g->>'flip')::boolean then bank.b else bank.a end,'different',case when (g->>'flip')::boolean then bank.a else bank.b end,
      'tally',tally,'tied',leaders>1,'caught',leaders=1 and suspect=g->>'odd');
  end if;
  return jsonb_build_object('game',r.game_key,'id',r.id,'code',r.code,'round',r.round_no,'step',coalesce((g->>'step')::integer,0),
    'revision',(select revision from public.room_events where room_id=r.id),'server_time',now(),'phase',coalesce(g->>'phase','lobby'),'me',me.id,'is_host',me.id=r.host_id,
    'host_offline',not exists(select 1 from private.players where id=r.host_id and last_seen>now()-interval '60 seconds'),
    'members',members,'players',case when g is null or r.game_key='letters' then members else players end,
    'answers',case when r.game_key='wrong' and g->>'phase' in ('discuss','vote','result') then g->'answers' else null end,'my_answer',g->'answers'->>(me.id::text),'my_vote',g->'votes'->>(me.id::text),
    'question',case when r.game_key='letters' then g->>'question' else null end,'used',coalesce(g->'used','[]'),'result',solution);
end $$;
revoke all on function private.party_state(uuid,uuid) from public,anon,authenticated;

create or replace function public.party_action(p_action text,p_code text default '',p_round integer default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r private.rooms; me private.players; g jsonb; response jsonb; actor text; kind text; bank private.party_bank; roster jsonb; n integer; picked integer; used jsonb; input_value text; votes_count integer;
begin
  if uid is null then raise exception 'AUTH_REQUIRED';end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4096 then raise exception 'INVALID_PAYLOAD';end if;
  kind:=p_payload->>'game';if kind is null or kind not in ('wrong','letters') then raise exception 'WRONG_GAME';end if;
  if p_action='create' then
    response:=private.game_action_v1('create','',p_payload->>'name',null,null,120);
    update private.rooms set game_key=kind,timer_enabled=false where id=(response->>'id')::uuid returning * into r;return private.party_state(r.id,uid);
  end if;
  if p_action='join' then perform pg_advisory_xact_lock(hashtextextended(uid::text,0));end if;
  select * into r from private.rooms where code=upper(trim(p_code)) and expires_at>now() for update;if r.id is null then raise exception 'ROOM_NOT_FOUND';end if;
  if r.game_key<>kind then raise exception 'WRONG_GAME';end if;
  if p_action='join' then perform private.game_action_v1('join',r.code,p_payload->>'name',null,null,120);return private.party_state(r.id,uid);end if;
  select * into me from private.players where room_id=r.id and user_id=uid;if me.id is null then raise exception 'NOT_MEMBER';end if;
  actor:=me.id::text;update private.players set last_seen=now() where id=me.id;
  select data into g from private.party_sessions where room_id=r.id;
  if p_action='state' then return private.party_state(r.id,uid);end if;
  if p_round is distinct from r.round_no then raise exception 'STALE_ROUND';end if;
  if (p_payload->>'step')::integer is distinct from coalesce((g->>'step')::integer,0) then raise exception 'STALE_PHASE';end if;
  if p_action='secret' then
    if kind<>'wrong' or g->>'phase' is null or g->>'phase' not in ('answer','discuss','vote') then raise exception 'WRONG_PHASE';end if;
    if not exists(select 1 from jsonb_array_elements(g->'players') p where p->>'id'=actor) then raise exception 'NOT_MEMBER';end if;
    select * into bank from private.party_bank pb where pb.game=kind and id=(g->>'bank_id')::integer;
    return jsonb_build_object('question',case when (actor=g->>'odd')<>(g->>'flip')::boolean then bank.b else bank.a end,'input',bank.input);
  end if;
  if p_action in ('claim_host','remove','leave') then
    response:=private.game_action_v1(p_action,r.code,null,(p_payload->>'target')::uuid,r.round_no,120);if p_action='leave' then return response;end if;return private.party_state(r.id,uid);
  end if;
  if p_action in ('start','cancel','open_vote','finish_vote','undo') and me.id<>r.host_id then raise exception 'HOST_ONLY';end if;
  if p_action='cancel' then delete from private.party_sessions where room_id=r.id;update private.rooms set phase='lobby',deadline=null where id=r.id;perform private.touch(r.id);return private.party_state(r.id,uid);end if;
  if p_action='start' then
    if r.phase not in ('lobby','result') then raise exception 'WRONG_PHASE';end if;
    select count(*),jsonb_agg(jsonb_build_object('id',id,'name',name) order by joined_at,id) into n,roster from private.players where room_id=r.id;
    if kind='wrong' and n<4 then raise exception 'WRONG_PLAYERS';elsif kind='letters' and n<1 then raise exception 'LETTERS_PLAYERS';end if;
    if n>12 then raise exception 'ROOM_FULL';end if;
    if exists(select 1 from private.players where room_id=r.id and last_seen<=now()-interval '60 seconds') then raise exception 'PLAYER_OFFLINE';end if;
    used:=coalesce(g->'bank_used','[]');
    if not exists(select 1 from private.party_bank pb where pb.game=kind and not(used @> jsonb_build_array(id))) then used:='[]';end if;
    select * into bank from private.party_bank pb where pb.game=kind and not(used @> jsonb_build_array(id)) order by gen_random_uuid() limit 1;
    if bank.id is null then raise exception 'BANK_EMPTY';end if;
    picked:=((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)%n)::integer;
    g:=jsonb_build_object('phase',case when kind='wrong' then 'answer' else 'letters' end,'step',1,'players',roster,'bank_id',bank.id,'bank_used',used||jsonb_build_array(bank.id),
      'flip',((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)%2)=1,'odd',case when kind='wrong' then roster->picked->>'id' else null end,
      'question',case when kind='letters' then bank.a else null end,'answers','{}'::jsonb,'votes','{}'::jsonb,'used','[]'::jsonb);
    insert into private.party_sessions values(r.id,g) on conflict(room_id) do update set data=excluded.data;
    update private.rooms set round_no=round_no+1,phase=case when kind='wrong' then 'reveal' else 'discuss' end,deadline=null where id=r.id;perform private.touch(r.id);return private.party_state(r.id,uid);
  end if;
  if g is null then raise exception 'WRONG_PHASE';end if;
  if kind='wrong' and not exists(select 1 from jsonb_array_elements(g->'players') p where p->>'id'=actor) then raise exception 'NOT_MEMBER';end if;
  case p_action
  when 'answer' then
    if kind<>'wrong' or g->>'phase'<>'answer' then raise exception 'WRONG_PHASE';end if;
    if jsonb_typeof(p_payload->'answer') is distinct from 'string' then raise exception 'ANSWER_INVALID';end if;
    input_value:=trim(p_payload->>'answer');
    if char_length(input_value) not between 1 and 60 or input_value~'[[:cntrl:]]' or input_value~U&'[\200E\200F\202A-\202E\2066-\2069]' then raise exception 'ANSWER_INVALID';end if;
    select * into bank from private.party_bank pb where pb.game=kind and id=(g->>'bank_id')::integer;
    if bank.input='number' and input_value!~'^[0-9٠-٩۰-۹]+([.,٫][0-9٠-٩۰-۹]+)?$' then raise exception 'ANSWER_NUMBER';end if;
    if g->'answers' ? actor then if g->'answers'->>actor=input_value then return private.party_state(r.id,uid);end if;raise exception 'ANSWER_LOCKED';end if;
    g:=jsonb_set(g,array['answers',actor],to_jsonb(input_value));
    if (select count(*) from jsonb_each(g->'answers'))=jsonb_array_length(g->'players') then g:=g||jsonb_build_object('phase','discuss','step',(g->>'step')::integer+1);end if;
  when 'open_vote' then
    if kind<>'wrong' or g->>'phase'<>'discuss' then raise exception 'WRONG_PHASE';end if;g:=g||jsonb_build_object('phase','vote','step',(g->>'step')::integer+1);
  when 'vote' then
    if kind<>'wrong' or g->>'phase'<>'vote' then raise exception 'WRONG_PHASE';end if;
    input_value:=p_payload->>'target';if input_value is null or input_value<>'skip' and not exists(select 1 from jsonb_array_elements(g->'players') p where p->>'id'=input_value) then raise exception 'INVALID_VOTE';end if;
    if g->'votes' ? actor then if g->'votes'->>actor=input_value then return private.party_state(r.id,uid);end if;raise exception 'ALREADY_VOTED';end if;
    g:=jsonb_set(g,array['votes',actor],to_jsonb(input_value));
    if (select count(*) from jsonb_each(g->'votes'))=jsonb_array_length(g->'players') then g:=g||jsonb_build_object('phase','result','step',(g->>'step')::integer+1);end if;
  when 'finish_vote' then
    if kind<>'wrong' or g->>'phase'<>'vote' then raise exception 'WRONG_PHASE';end if;
    select count(*) into votes_count from jsonb_each(g->'votes');if votes_count=0 then raise exception 'VOTE_REQUIRED';end if;
    if votes_count<jsonb_array_length(g->'players') and not coalesce((p_payload->>'force')::boolean,false) then raise exception 'NOT_READY';end if;
    g:=g||jsonb_build_object('phase','result','step',(g->>'step')::integer+1);
  when 'letter' then
    if kind<>'letters' or g->>'phase'<>'letters' then raise exception 'WRONG_PHASE';end if;
    input_value:=p_payload->>'letter';if input_value is null or char_length(input_value)<>1 or position(input_value in 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي')=0 then raise exception 'LETTER_INVALID';end if;
    if exists(select 1 from jsonb_array_elements(g->'used') u where u->>'letter'=input_value) then raise exception 'LETTER_USED';end if;
    g:=jsonb_set(g,'{used}',g->'used'||jsonb_build_array(jsonb_build_object('letter',input_value,'actor',actor)));
    if jsonb_array_length(g->'used')=28 then g:=g||jsonb_build_object('phase','result','step',(g->>'step')::integer+1);end if;
  when 'undo' then
    if kind<>'letters' or g->>'phase' not in ('letters','result') then raise exception 'WRONG_PHASE';end if;
    if jsonb_array_length(g->'used')=0 or (g->'used' -> -1 ->> 'letter') is distinct from p_payload->>'letter' then raise exception 'STALE_PHASE';end if;
    g:=jsonb_set(g,'{used}',(g->'used')-(-1));if g->>'phase'='result' then g:=g||jsonb_build_object('phase','letters','step',(g->>'step')::integer+1);end if;
  else raise exception 'ACTION_INVALID';
  end case;
  update private.party_sessions set data=g where room_id=r.id;
  update private.rooms set phase=case when g->>'phase'='result' then 'result' when g->>'phase'='answer' then 'reveal' else 'discuss' end,deadline=null where id=r.id;
  perform private.touch(r.id);return private.party_state(r.id,uid);
end $$;
revoke all on function public.party_action(text,text,integer,jsonb) from public,anon;
grant execute on function public.party_action(text,text,integer,jsonb) to authenticated;

create or replace function public.game_action(p_action text,p_code text default '',p_name text default null,p_target uuid default null,p_round integer default null,p_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare game text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
  if p_action<>'create' then
    select game_key into game from private.rooms where code=upper(trim(p_code));
    if game in ('wrong','letters','wave','mafia','crime') then
      if p_action<>'join' then raise exception 'WRONG_GAME';end if;
      if game in ('wrong','letters') then return public.party_action('join',p_code,p_round,jsonb_build_object('name',p_name,'game',game));
      elsif game='wave' then return public.wave_action('join',p_code,p_round,jsonb_build_object('name',p_name));
      elsif game='mafia' then return public.mafia_action('join',p_code,p_round,jsonb_build_object('name',p_name));
      else return public.crime_action('join',p_code,p_round,jsonb_build_object('name',p_name));end if;
    end if;
  end if;
  return private.outsider_action_v2(p_action,p_code,p_name,p_target,p_round,p_seconds);
end $$;
revoke all on function public.game_action(text,text,text,uuid,integer,integer) from public,anon;
grant execute on function public.game_action(text,text,text,uuid,integer,integer) to authenticated;


-- Source: 007_polish.sql
-- Apply after 006. Repeatable; no player/room records are deleted.

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

-- Fatin: wrong question + Arabic letters. Apply after migrations 001 through 005.
begin;
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
on conflict(game,id) do update set a=excluded.a,b=excluded.b,input=excluded.input;

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
declare uid uuid:=auth.uid(); r private.rooms; me private.players; g jsonb; response jsonb; actor text; kind text; bank private.party_bank; roster jsonb; n integer; picked integer; used jsonb; value text; votes_count integer;
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
    value:=trim(p_payload->>'answer');
    if char_length(value) not between 1 and 60 or value~'[[:cntrl:]]' or value~U&'[\200E\200F\202A-\202E\2066-\2069]' then raise exception 'ANSWER_INVALID';end if;
    select * into bank from private.party_bank pb where pb.game=kind and id=(g->>'bank_id')::integer;
    if bank.input='number' and value!~'^[0-9٠-٩۰-۹]+([.,٫][0-9٠-٩۰-۹]+)?$' then raise exception 'ANSWER_NUMBER';end if;
    if g->'answers' ? actor then if g->'answers'->>actor=value then return private.party_state(r.id,uid);end if;raise exception 'ANSWER_LOCKED';end if;
    g:=jsonb_set(g,array['answers',actor],to_jsonb(value));
    if (select count(*) from jsonb_each(g->'answers'))=jsonb_array_length(g->'players') then g:=g||jsonb_build_object('phase','discuss','step',(g->>'step')::integer+1);end if;
  when 'open_vote' then
    if kind<>'wrong' or g->>'phase'<>'discuss' then raise exception 'WRONG_PHASE';end if;g:=g||jsonb_build_object('phase','vote','step',(g->>'step')::integer+1);
  when 'vote' then
    if kind<>'wrong' or g->>'phase'<>'vote' then raise exception 'WRONG_PHASE';end if;
    value:=p_payload->>'target';if value is null or value<>'skip' and not exists(select 1 from jsonb_array_elements(g->'players') p where p->>'id'=value) then raise exception 'INVALID_VOTE';end if;
    if g->'votes' ? actor then if g->'votes'->>actor=value then return private.party_state(r.id,uid);end if;raise exception 'ALREADY_VOTED';end if;
    g:=jsonb_set(g,array['votes',actor],to_jsonb(value));
    if (select count(*) from jsonb_each(g->'votes'))=jsonb_array_length(g->'players') then g:=g||jsonb_build_object('phase','result','step',(g->>'step')::integer+1);end if;
  when 'finish_vote' then
    if kind<>'wrong' or g->>'phase'<>'vote' then raise exception 'WRONG_PHASE';end if;
    select count(*) into votes_count from jsonb_each(g->'votes');if votes_count=0 then raise exception 'VOTE_REQUIRED';end if;
    if votes_count<jsonb_array_length(g->'players') and not coalesce((p_payload->>'force')::boolean,false) then raise exception 'NOT_READY';end if;
    g:=g||jsonb_build_object('phase','result','step',(g->>'step')::integer+1);
  when 'letter' then
    if kind<>'letters' or g->>'phase'<>'letters' then raise exception 'WRONG_PHASE';end if;
    value:=p_payload->>'letter';if value is null or char_length(value)<>1 or position(value in 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي')=0 then raise exception 'LETTER_INVALID';end if;
    if exists(select 1 from jsonb_array_elements(g->'used') u where u->>'letter'=value) then raise exception 'LETTER_USED';end if;
    g:=jsonb_set(g,'{used}',g->'used'||jsonb_build_array(jsonb_build_object('letter',value,'actor',actor)));
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
notify pgrst,'reload schema';
commit;

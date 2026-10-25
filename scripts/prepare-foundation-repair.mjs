// Restore named foundations explicitly: never rename an already upgraded dispatcher.
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../supabase/migrations/',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const strip=sql=>sql.replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'').replace(/^notify pgrst,\s*'reload schema';\s*$/gmi,'');
function definition(sql,from,to){
  const start=sql.search(new RegExp(`create (?:or replace )?function ${from.replaceAll('.','\\.')}\\(`,'i'));
  const end=sql.indexOf('$$;',sql.indexOf('as $$',start));
  if(start<0||end<0)throw new Error(`Missing source function: ${from}`);
  return sql.slice(start,end+3).replace(/^create (?:or replace )?function \S+\(/,`create or replace function ${to}(`);
}
const base=await read('001_lamma.sql'),timer=await read('002_host_timer.sql');
let sql=`-- Fatin 009: repair missing foundations after an incomplete upgrade.
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
`;
sql+=timer.match(/^alter table private\.rooms .*;$/gm).join('\n')+'\n';
for(const [from,to,signature] of [
  ['private.touch','private.touch','uuid'],
  ['private.room_state','private.room_state_v1','uuid,uuid'],
  ['public.game_action','private.game_action_v1','text,text,text,uuid,integer,integer'],
]){
  sql+=definition(base,from,to)+`\nrevoke all on function ${to}(${signature}) from public,anon,authenticated;\n`;
}
sql+=definition(timer,'public.game_action','private.outsider_action_v2')+
  '\nrevoke all on function private.outsider_action_v2(text,text,text,uuid,integer,integer) from public,anon,authenticated;\n';
// The latest dispatcher is supplied by 008 below. Omit the old rename block entirely.
let crime=(await read('003_closed_case.sql')).split('-- A dispatcher protects game boundaries')[0];
crime=strip(crime)
  .replace('on conflict(id) do update set name=excluded.name,kind=excluded.kind;','on conflict(id) do nothing;')
  .replace('on conflict(id) do update set options=excluded.options;','on conflict(id) do nothing;');
if(/on conflict\(id\) do update/.test(crime))throw new Error('Unexpected content overwrite in crime migration');
sql+='\n-- Restore crime tables and functions without replacing existing cards.\n'+crime;
sql+='\n-- Restore the latest rules and public dispatchers for all six games.\n'+strip(await read('008_readiness.sql'));
sql+="\nnotify pgrst,'reload schema';\ncommit;\n";
await writeFile(new URL('009_foundation_repair.sql',root),sql);
console.log('Prepared 009_foundation_repair.sql');

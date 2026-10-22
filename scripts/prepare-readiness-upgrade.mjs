// Rebuild the recovery migration after editing its source migrations.
// Existing custom content and active sessions must survive this upgrade.
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../supabase/migrations/',import.meta.url);
let output='-- Fatin readiness recovery. Requires migrations 001, 002 and 003.\n-- Safe to repeat; preserves active rooms and existing content.\nbegin;\n';
for(const name of ['004_mafia.sql','005_same_wave.sql','006_questions_letters.sql','007_polish.sql']){
  let sql=await readFile(new URL(name,root),'utf8');
  sql=sql.replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'').replace(/^notify pgrst,\s*'reload schema';\s*$/gmi,'');
  sql=sql.replace(/on conflict\(id\) do update set low_label=excluded.low_label,high_label=excluded.high_label;/,'on conflict(id) do nothing;');
  sql=sql.replace(/on conflict\(game,id\) do update set a=excluded.a,b=excluded.b,input=excluded.input;/,'on conflict(game,id) do nothing;');
  output+=`\n-- Source: ${name}\n${sql}\n`;
}
output+="notify pgrst,'reload schema';\ncommit;\n";
await writeFile(new URL('008_readiness.sql',root),output);
console.log('Prepared 008_readiness.sql');

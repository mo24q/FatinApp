import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// This command validates content and writes SQL; it never connects to a database.
const root=new URL('../',import.meta.url);
const bank=JSON.parse(await readFile(new URL('content/game-content.json',root),'utf8'));
const check=(ok,message)=>{if(!ok)throw new Error(`game-content.json: ${message}`);};
const text=(value,max=120)=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value);
const unique=(values)=>new Set(values).size===values.length;
const array=(value,min,label)=>check(Array.isArray(value)&&value.length>=min,`${label}: expected at least ${min} entries`);
check(bank.version===1,'unsupported version');
check(Object.keys(bank).sort().join(',')==='crime,crimeClues,letters,outsider,version,wave,wrong','unexpected or missing sections');
array(bank.outsider,2,'outsider');array(bank.wave,12,'wave');array(bank.wrong,2,'wrong');array(bank.letters,2,'letters');array(bank.crime,88,'crime');array(bank.crimeClues,6,'crimeClues');
for(const key of ['outsider','wave']){
  check(bank[key].every(row=>Array.isArray(row)&&row.length===2&&row.every(v=>text(v,60))),`${key}: each row must contain two short strings`);
}
check(unique(bank.outsider.map(row=>row[1])),'outsider: duplicate word');
check(bank.wave.every(row=>row[0]!==row[1])&&unique(bank.wave.map(row=>JSON.stringify([...row].sort()))),'wave: repeated/identical endpoints');
check(bank.wrong.every(row=>Array.isArray(row)&&row.length===3&&text(row[0])&&text(row[1])&&row[0]!==row[1]&&['text','number'].includes(row[2])),'wrong: expected [question A, question B, text|number]');
check(unique(bank.wrong.map(row=>JSON.stringify(row.slice(0,2).sort()))),'wrong: repeated pair');
check(bank.letters.every(v=>text(v))&&unique(bank.letters),'letters: invalid or repeated prompt');
const artKinds=new Set(["axe", "badge", "bag", "ball", "bat", "bell", "belt", "book", "bookend", "bottle", "bow", "box", "brick", "brush", "bucket", "button", "cable", "camera", "candle", "cane", "card", "case", "chain", "cleaver", "clip", "cloth", "coin", "cup", "dice", "disc", "drill", "feather", "flashlight", "flower", "fork", "glasses", "glove", "hammer", "hat", "headphones", "hook", "iron", "kettle", "key", "knife", "leaf", "lock", "mail", "map", "mask", "matches", "mirror", "nail", "necklace", "pan", "paper", "pen", "perfume", "phone", "photo", "pipe", "plank", "pot", "puzzle", "racket", "receipt", "remote", "ring", "rock", "rope", "saw", "scale", "scissors", "shard", "shell", "shoe", "shovel", "skewer", "stamp", "stapler", "statue", "thread", "ticket", "tie", "tongs", "tool", "trophy", "umbrella", "usb", "vase", "wallet", "watch", "weight", "wrapper", "wrench"]);
check(bank.crime.every(c=>c&&Object.keys(c).sort().join(',')==='art,id,kind,name'&&text(c.name,60)&&['weapon','evidence'].includes(c.kind)&&new RegExp(`^${c.kind==='weapon'?'w':'e'}[0-9]{2,4}$`).test(c.id)&&artKinds.has(c.art)),'crime: invalid card, id, kind or artwork key');
check(unique(bank.crime.map(c=>c.id)),'crime: duplicate id');
for(const kind of ['weapon','evidence'])check(bank.crime.filter(c=>c.kind===kind).length>=44,`crime: need at least 44 ${kind} cards`);
check(bank.crimeClues.every(c=>c&&/^[a-z_]+$/.test(c.id)&&text(c.name,60)&&Array.isArray(c.options)&&c.options.length===6&&c.options.every(v=>text(v,60))&&unique(c.options))&&unique(bank.crimeClues.map(c=>c.id)),'crimeClues: invalid legacy board');
// Quote every value; no SQL supplied by content is executed.
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const rows=values=>values.map(row=>'('+row.join(',')+')').join(',\n');
const sql=`-- GENERATED from content/game-content.json by npm run content:sync.
-- Apply after migrations 001 through 007. Content only; retains existing rows.
-- Update between sessions. Keep IDs and array order stable; append new entries.
begin;
set local standard_conforming_strings=on;
insert into private.words(category,word) values
${rows(bank.outsider.map(row=>row.map(q)))}
on conflict(word) do update set category=excluded.category;
insert into private.wave_pairs(id,low_label,high_label) values
${rows(bank.wave.map((row,id)=>[id,...row.map(q)]))}
on conflict(id) do update set low_label=excluded.low_label,high_label=excluded.high_label;
insert into private.party_bank(game,id,a,b,input) values
${rows([...bank.wrong.map((row,id)=>[q('wrong'),id,...row.map(q)]),...bank.letters.map((prompt,id)=>[q('letters'),id,q(prompt),'null',q('text')])])}
on conflict(game,id) do update set a=excluded.a,b=excluded.b,input=excluded.input;
insert into private.crime_cards(id,kind,name) values
${rows(bank.crime.map(c=>[q(c.id),q(c.kind),q(c.name)]))}
on conflict(id) do update set kind=excluded.kind,name=excluded.name;
insert into private.crime_clues(id,options) values
${rows(bank.crimeClues.map(c=>[q(c.id),q(JSON.stringify(c.options))+'::jsonb']))}
on conflict(id) do update set options=excluded.options;
commit;
`;
const output=new URL('supabase/content-update.sql',root);
await writeFile(output,sql,'utf8');
console.log(`Content prepared: ${bank.outsider.length} words, ${bank.wave.length} scales, ${bank.wrong.length} question pairs, ${bank.letters.length} prompts, ${bank.crime.length} cards.\nSQL: ${fileURLToPath(output)}`);

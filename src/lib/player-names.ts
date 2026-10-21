// Explicit names keep their validation. Fill blanks without colliding with them.
export function defaultPlayerNames(names:string[]):string[]{
  const clean=names.map(name=>name.trim().replace(/\s+/g,' '));
  const used=new Set(clean.filter(Boolean).map(name=>name.toLowerCase()));
  return clean.map((name,index)=>{
    if(name)return name;
    let number=index+1,candidate=`لاعب ${number}`;
    while(used.has(candidate.toLowerCase()))candidate=`لاعب ${++number}`;
    used.add(candidate.toLowerCase());return candidate;
  });
}

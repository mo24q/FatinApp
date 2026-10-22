export type RoundScore={id:string;name:string;imposter:boolean;correct:number;received:number;score:number};
// Round totals are independent; no client supplied score is accepted online.
export function roundScores(players:{id:string;name:string}[],imposter:string,votes:Record<string,string>):RoundScore[]{
  return players.map(p=>{const received=Object.values(votes).filter(id=>id===p.id).length;
    const odd=p.id===imposter,correct=!odd&&votes[p.id]===imposter?1:0;
    return {id:p.id,name:p.name,imposter:odd,correct,received,score:(odd?3:correct)-received};
  });
}

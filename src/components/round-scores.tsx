import type { RoundScore } from '@/lib/round-scores';
export function RoundScores({scores}:{scores?:RoundScore[]}){
  if(!scores)return null;
  return <section className="round-scores" aria-label="نقاط الجولة"><h3>نقاط الجولة</h3><p className="field-note">إصابة المتخفي +1 للمواطن. كل صوت عليك −1. المتخفي يبدأ بـ3 نقاط. النقاط مستقلة لكل جولة وقد تصبح سالبة.</p><ol>{[...scores].sort((a,b)=>b.score-a.score).map(p=><li key={p.id}><div><strong>{p.name}</strong><small>{p.imposter?'رصيد المتخفي: 3':`إصابة صحيحة: +${p.correct}`} · أصوات عليك: −{p.received}</small></div><b className={p.score<0?'negative':''} dir="ltr">{p.score>0?'+':''}{p.score}</b></li>)}</ol></section>;
}

'use client';
import { useState } from 'react';
import { Clock3, Pause, Play, RotateCcw, TimerOff } from 'lucide-react';
import type { TimerCommand, TimerState } from '@/lib/local-game';

export function TimerPanel({timer,remaining,active=true,host=false,disabled=false,onAction}: {
  timer: TimerState; remaining: number; active?: boolean; host?: boolean; disabled?: boolean;
  onAction?: (command: TimerCommand, seconds?: number)=>void;
}) {
  const [seconds,setSeconds]=useState(timer.duration_seconds);
  return <div className="timer-panel">
    {active && <><div className={`timer ${timer.enabled && remaining===0 ? 'expired' : ''}`} role="timer" aria-label={timer.enabled ? `الوقت المتبقي ${remaining} ثانية${timer.paused ? '، متوقف مؤقتًا' : ''}` : 'المؤقت ملغى'}>
      {timer.enabled ? <><Clock3 size={24}/><span>{Math.floor(remaining/60).toString().padStart(2,'0')}:{(remaining%60).toString().padStart(2,'0')}</span></> : <><TimerOff size={24}/><span className="timer-off-label">بدون مؤقت</span></>}
    </div><p className="timer-status">{!timer.enabled ? 'خذوا راحتكم، وكملوا لما تكونون جاهزين.' : timer.paused ? 'المؤقت متوقف مؤقتًا' : remaining===0 ? 'انتهى الوقت' : 'المؤقت شغّال'}</p></>}
    {host && <div className="timer-controls" aria-label="تحكم المضيف بالمؤقت">
      <span className="timer-controls-title">{active ? 'تحكم المضيف بالمؤقت' : 'إعداد مؤقت النقاش'}{!active && ` · ${timer.enabled ? 'مفعّل' : 'بدون مؤقت'}`}</span>
      <div className="timer-buttons">
        <button className="button white small-button" disabled={disabled} onClick={()=>onAction?.(timer.enabled?'timer_disable':'timer_enable')}>{timer.enabled ? <TimerOff size={16}/> : <Play size={16}/>} {timer.enabled?'إلغاء المؤقت':'تشغيل المؤقت'}</button>
        {active && timer.enabled && <button className="button white small-button" disabled={disabled || remaining===0} onClick={()=>onAction?.(timer.paused?'timer_resume':'timer_pause')}>{timer.paused ? <Play size={16}/> : <Pause size={16}/>} {timer.paused?'استئناف':'إيقاف مؤقت'}</button>}
        {active && <button className="button white small-button" disabled={disabled} onClick={()=>onAction?.('timer_reset')}><RotateCcw size={16}/> إعادة الوقت</button>}
      </div>
      <form className="timer-duration" onSubmit={e=>{e.preventDefault();onAction?.('timer_set',seconds);}}>
        <label>المدة بالثواني<input aria-label="المدة بالثواني" type="number" min={15} max={900} step={1} required value={seconds} onChange={e=>setSeconds(Number(e.target.value))} disabled={disabled}/></label>
        <button className="button light-purple small-button" disabled={disabled}>تطبيق المدة</button>
      </form><p className="field-note">١٥–٩٠٠ ثانية. تطبيق المدة يعيد العدّ إليها ويحافظ على الإيقاف المؤقت.</p>
    </div>}
  </div>;
}

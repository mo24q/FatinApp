'use client';
import { friendlyError, supabase } from './supabase';
export async function waveAction<T>(action:string,code='',round:number|null=null,payload:Record<string,unknown>={}):Promise<T>{const {data,error}=await supabase().rpc('wave_action',{p_action:action,p_code:code,p_round:round,p_payload:payload});if(error)throw error;return data as T;}
export function waveError(error:unknown){const message=error&&typeof error==='object'&&'message'in error?String(error.message):String(error);
  const errors:Record<string,string>={WAVE_PLAYERS:'تحتاجون من لاعبين إلى ١٢ لاعبًا.',WAVE_ROUNDS:'اختاروا ٤ أو ٦ أو ٨ أو ١٢ جولة.',WAVE_CLUE:'اكتب تلميحًا من حرفين إلى ٨٠ حرفًا، دون أرقام أو رموز تحكم.',WAVE_GIVER_ONLY:'الهدف والتلميح لصاحب الموجة فقط.',WAVE_GIVER_GUESS:'أنت تعرف الهدف؛ اترك التخمين للبقية.',WAVE_GUESS:'اختر موقعًا من صفر إلى مئة.',WAVE_LOCKED:'ثبتنا تخمينك؛ ما تقدر تغيره.',WAVE_WAIT:'باقي لاعبين ما خمنوا.',WAVE_NO_GUESSES:'نحتاج تخمينًا واحدًا على الأقل قبل الكشف.',STALE_PHASE:'تغيّرت المرحلة؛ نحدّث الجولة الآن.',WRONG_GAME:'هذا الرمز للعبة أخرى. ادخل من صفحة فطين الرئيسية.'};for(const [code,text] of Object.entries(errors))if(message.includes(code))return text;
  if(/wave_action|wave_sessions/.test(message)&&/schema cache|does not exist|Could not find/i.test(message))return 'نفس الموجة تحتاج تحديث قاعدة البيانات: شغّل 005_same_wave.sql.';return friendlyError(error);
}

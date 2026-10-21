'use client';
import { friendlyError, supabase } from './supabase';
export async function mafiaAction<T>(action:string,code='',round:number|null=null,payload:Record<string,unknown>={}):Promise<T>{
  const {data,error}=await supabase().rpc('mafia_action',{p_action:action,p_code:code,p_round:round,p_payload:payload});
  if(error)throw error;return data as T;
}
export function mafiaError(error:unknown){
  const message=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);
  const messages:Record<string,string>={MAFIA_NEED_PLAYERS:'تحتاجون ٥–١٢ لاعبًا، أو ٦–١٢ مع راوي من اللاعبين.',MAFIA_CONFIG:'راجع توزيع الأدوار: عدد المافيا بحد أقصى ثلث المشاركين، دون الراوي.',INVALID_NARRATOR:'اختر الراوي من اللاعبين الموجودين.',NARRATOR_ONLY:'هذه الخطوة للراوي الذي اخترتموه.',WAIT_ACTIONS:'باقي لاعبين ما أكملوا اختيارهم.',NOT_READY:'ينبغي أن يطّلع الجميع على أدوارهم أولًا.',ELIMINATED:'خرجت من الجولة؛ تقدر تتابع النقاش والنتيجة.',INVALID_TARGET:'هذا اللاعب غير متاح لاختيارك.',STALE_PHASE:'انتقلت اللعبة لمرحلة جديدة. تم تحديث الصفحة.',WRONG_GAME:'هذا الرمز للعبة أخرى. ادخل من صفحة فطين الرئيسية.',ALREADY_VOTED:'تم تثبيت صوتك، ما تقدر تغيّره.',PLAYER_OFFLINE:'انتظر عودة اللاعبين غير المتصلين، أو أزلهم قبل البدء.'};
  for(const [key,text] of Object.entries(messages))if(message.includes(key))return text;
  if(/mafia_action|mafia_sessions/.test(message)&&/schema cache|does not exist|Could not find/i.test(message))return 'الغرف تحتاج تحديث المافيا: شغّل ملف 004_mafia.sql في Supabase.';
  return friendlyError(error);
}

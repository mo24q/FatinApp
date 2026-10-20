'use client';
import { friendlyError, supabase } from './supabase';
export async function crimeAction<T>(action:string,code='',round:number|null=null,payload:Record<string,unknown>={}):Promise<T> {
  const {data,error}=await supabase().rpc('crime_action',{p_action:action,p_code:code,p_round:round,p_payload:payload});
  if(error)throw error;
  return data as T;
}
const messages:Record<string,string>={
  CRIME_NEED_PLAYERS:'تحتاجون ٤ لاعبين على الأقل، شامل الراوي.',
  INVALID_NARRATOR:'اختر الراوي من لاعبي الغرفة.',
  NARRATOR_ONLY:'هذه الخطوة للراوي فقط.',
  KILLER_ONLY:'الاختيار السري للمجرم فقط.',
  INVALID_CARDS:'اختر سلاحًا ودليلًا من بطاقات نفس اللاعب.',
  SOLUTION_REQUIRED:'باقي تثبيت السلاح والدليل من المجرم.',
  SOLUTION_LOCKED:'تم تثبيت السلاح والدليل، ما تقدر تغيرهما في هذه القضية.',
  INVALID_ACCUSATION:'اختر لاعبًا آخر غير الراوي، مع سلاحه ودليله.',
  ALREADY_ACCUSED:'استخدمت اتهامك في هذه القضية. تقدر تكمل النقاش.',
  INVALID_CLUE:'اختر تلميحًا من الخيارات الموجودة.',
  WRONG_GAME:'هذا الرمز للعبة أخرى. ادخل من الصفحة الرئيسية.',
  DECK_TOO_SMALL:'بنك البطاقات غير مكتمل. يحتاج المضيف تحديث قاعدة البيانات.',
  INVALID_PAYLOAD:'الطلب غير صالح. حدّث الصفحة وحاول مجددًا.',
};
export function crimeError(error:unknown) {
  const message=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);
  for(const [key,text] of Object.entries(messages))if(message.includes(key))return text;
  if(/crime_action|crime_rounds/.test(message)&&/schema cache|does not exist|Could not find/i.test(message))return 'لعبة الجريمة تحتاج تحديث قاعدة البيانات: شغّل ملف 003_closed_case.sql في Supabase.';
  if(/[\u0600-\u06ff]/.test(message))return message;
  return friendlyError(error);
}

'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
let client: SupabaseClient | undefined;
let signingIn: Promise<string> | null = null;

export function supabase() {
  if (!configured) throw new Error('SETUP_REQUIRED');
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  return client;
}

// Identity comes from a signed Supabase JWT, never a player id supplied by the UI.
export async function ensureGuest(captchaToken?: string) {
  const { data, error } = await supabase().auth.getSession();
  if (error) throw error;
  if (data.session) return data.session.user.id;
  if (!signingIn) signingIn = (async () => {
    const { data, error } = await supabase().auth.signInAnonymously({ options: { captchaToken } });
    if (error) throw error;
    if (!data.user) throw new Error('AUTH_REQUIRED');
    return data.user.id;
  })().finally(() => { signingIn = null; });
  return signingIn;
}

export async function action<T>(action: string, code = '', extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase().rpc('game_action', {
    p_action: action, p_code: code, p_name: null, p_target: null, p_round: null, p_seconds: 120, ...extra
  });
  if (error) throw error;
  return data as T;
}

const errors: Record<string, string> = {
  SETUP_REQUIRED: 'الموقع ينتظر ربط قاعدة البيانات. تجد خطوات الإعداد في ملف README.',
  AUTH_REQUIRED: 'انتهت جلسة الضيف. ارجع للرئيسية وادخل من جديد.',
  ROOM_NOT_FOUND: 'ما لقينا الغرفة، أو انتهت صلاحيتها. تأكد من الرمز.',
  NOT_MEMBER: 'هذا الجهاز غير منضم للغرفة. ادخل باسمك أولًا.',
  NAME_INVALID: 'اكتب اسمًا من حرفين إلى ٢٠ حرفًا، دون رموز تحكم.',
  NAME_TAKEN: 'الاسم مستخدم في الغرفة. جرّب اسمًا مختلفًا.',
  ROOM_FULL: 'الغرفة مكتملة؛ الحد الأقصى ١٢ لاعبًا.',
  ROUND_IN_PROGRESS: 'الجولة بدأت. انتظر النتيجة ثم انضم.',
  HOST_ONLY: 'هذه الخطوة متاحة للمضيف فقط.',
  WRONG_PHASE: 'تغيّرت مرحلة اللعب. حدّث الصفحة وحاول مجددًا.',
  STALE_ROUND: 'انتهت هذه الجولة. حدّث الصفحة للمتابعة.',
  NEED_PLAYERS: 'تحتاجون ٣ لاعبين على الأقل لبدء الجولة.',
  PLAYER_OFFLINE: 'بعض اللاعبين غير متصلين. انتظر عودتهم أو أزلهم قبل البدء.',
  NOT_READY: 'باقي لاعب لم يؤكد قراءة دوره.',
  INVALID_VOTE: 'اختر لاعبًا آخر من لاعبي الجولة.',
  ALREADY_VOTED: 'تم تثبيت صوتك مسبقًا.',
  VOTING_OPEN: 'انتظر اكتمال الأصوات أو انتهاء وقت التصويت.',
  HOST_ONLINE: 'المضيف ما زال متصلًا. يمكنك استلام الاستضافة بعد غيابه لدقيقة.',
  CANNOT_REMOVE: 'لا يمكنك إزالة هذا اللاعب الآن.',
  CREATE_LIMIT: 'أنشأت عدة غرف خلال ساعة. استخدم غرفة موجودة أو حاول لاحقًا.',
  ROOM_LIMIT: 'أنت في غرف كثيرة. غادر غرفة قبل الانضمام لغرفة أخرى.',
  INVALID_SECONDS: 'اختر مدة نقاش متاحة.',
  ACTION_INVALID: 'الطلب غير معروف.'
};

export function friendlyError(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
  for (const [code, text] of Object.entries(errors)) if (message.includes(code)) return text;
  if (/anonymous.*disabled/i.test(message)) return 'دخول الضيوف غير مفعّل بعد في إعدادات Supabase.';
  if (/captcha/i.test(message)) return 'أكمل التحقق ثم حاول مجددًا.';
  if (/rate|429/i.test(message)) return 'طلبات كثيرة خلال وقت قصير. انتظر قليلًا وحاول مجددًا.';
  return 'تعذّر الاتصال الآن. تحقق من الشبكة وحاول مجددًا.';
}

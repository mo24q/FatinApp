// Common object names, original selection and artwork. No commercial card assets.
export type CrimeCard = { id: string; name: string; art: string; kind: 'weapon' | 'evidence' };
const weaponNames = [
  ['مطرقة','hammer'],['سكين مطبخ','knife'],['مقص','scissors'],['فأس','axe'],
  ['مفتاح ربط','wrench'],['مفك','tool'],['منشار','saw'],['مجرفة','shovel'],
  ['حبل','rope'],['سلسلة','chain'],['سلك كهرباء','cable'],['حزام','belt'],
  ['حجر','rock'],['قالب طوب','brick'],['عصا خشبية','bat'],['مضرب بيسبول','bat'],
  ['مقلاة','pan'],['قدر','pot'],['زجاجة','bottle'],['قطعة زجاج','shard'],
  ['مزهرية','vase'],['تمثال صغير','statue'],['كأس بطولة','trophy'],['ثقل رياضي','weight'],
  ['مظلة','umbrella'],['عكاز','cane'],['مصباح يدوي','flashlight'],['شمعدان','candle'],
  ['مفتاح أنابيب','wrench'],['كماشة','tool'],['مثقاب','drill'],['مبرد معدني','saw'],
  ['خطاف','hook'],['مسمار كبير','nail'],['شوكة كبيرة','fork'],['سيخ معدني','skewer'],
  ['لوح خشب','plank'],['ساق كرسي','bat'],['عصا بلياردو','bat'],['مضرب تنس','racket'],
  ['قوس وسهم','bow'],['مطرقة مطاطية','hammer'],['جرس معدني','bell'],['مكواة','iron'],
  ['إبريق','kettle'],['حجر زينة','rock'],['قفل ثقيل','lock'],['ميزان معدني','scale'],
  ['حامل كتب','bookend'],['أنبوب معدني','pipe'],['قطعة سيراميك','shard'],['حبل قفز','rope'],
  ['عود مشي','cane'],['ثقالة ورق','rock'],['زجاجة عطر','perfume'],['عود طبلة','bat'],
  ['رافعة صغيرة','tool'],['دباسة معدنية','stapler'],['صندوق أدوات','case'],['ساطور','cleaver'],
  ['ملقط فحم','tongs'],['بلطة تخييم','axe'],['مفتاح عجلات','wrench'],['دلو معدني','bucket'],
] as const;
const evidenceNames = [
  ['مفتاح','key'],['ساعة يد','watch'],['خاتم','ring'],['نظارة','glasses'],
  ['هاتف','phone'],['محفظة','wallet'],['تذكرة سفر','ticket'],['إيصال شراء','receipt'],
  ['صورة قديمة','photo'],['زر قميص','button'],['قفاز','glove'],['منديل','cloth'],
  ['ريشة','feather'],['ورقة شجر','leaf'],['زهرة جافة','flower'],['ظرف','mail'],
  ['خريطة','map'],['كوب قهوة','cup'],['قلم','pen'],['دفتر','book'],
  ['عملة','coin'],['حجر نرد','dice'],['بطاقة لعب','card'],['جهاز تحكم','remote'],
  ['سماعة','headphones'],['شاحن','cable'],['كمامة','mask'],['علبة كبريت','matches'],
  ['حذاء','shoe'],['قبعة','hat'],['وشاح','cloth'],['ربطة عنق','tie'],
  ['مشبك شعر','clip'],['قلادة','necklace'],['سوار','ring'],['بروش','badge'],
  ['مفتاح سيارة','key'],['بطاقة دخول','badge'],['تذكرة سينما','ticket'],['بطاقة بريدية','photo'],
  ['فاتورة مطعم','receipt'],['قائمة مشتريات','receipt'],['كتاب','book'],['جريدة','paper'],
  ['حقيبة صغيرة','bag'],['مظروف نقدي','mail'],['علبة حلوى','box'],['غلاف شوكولاتة','wrapper'],
  ['قنينة ماء','bottle'],['غطاء زجاجة','button'],['فرشاة','brush'],['مرآة جيب','mirror'],
  ['مفتاح غرفة','key'],['فلاش ذاكرة','usb'],['كاميرا','camera'],['قرص موسيقى','disc'],
  ['تذكرة موقف','ticket'],['كرة صغيرة','ball'],['قطعة قماش','cloth'],['بكرة خيط','thread'],
  ['صدفة','shell'],['قطعة أحجية','puzzle'],['مشبك ورق','clip'],['ختم','stamp'],
] as const;
export const crimeCards: CrimeCard[] = [
  ...weaponNames.map(([name,art],i)=>({id:`w${String(i+1).padStart(2,'0')}`,name,art,kind:'weapon' as const})),
  ...evidenceNames.map(([name,art],i)=>({id:`e${String(i+1).padStart(2,'0')}`,name,art,kind:'evidence' as const})),
];
export const crimeCardById = Object.fromEntries(crimeCards.map(c=>[c.id,c])) as Record<string,CrimeCard>;
// The narrator chooses associations, never an automatically generated factual claim.
export const clueBoards = [
  {id:'place',name:'مكان الحادث',options:['منزل','مكان عمل','مكان مفتوح','وسيلة نقل','مكان عام','غير واضح']},
  {id:'trace',name:'الأثر الأبرز',options:['كسر','فوضى','خدش','شيء مفقود','شيء متروك','أثر خفيف']},
  {id:'material',name:'المادة الأقرب',options:['معدن','خشب','قماش','زجاج','ورق','بلاستيك']},
  {id:'mood',name:'جوّ القضية',options:['روتين يومي','رحلة','مناسبة','خلاف','عمل مستعجل','مفاجأة']},
  {id:'object',name:'صفة تلفت النظر',options:['صغير','ثقيل','قابل للطي','لامع','قديم','شخصي']},
  {id:'link',name:'خيط يقربكم',options:['هواية','مهنة','ذكرى','شراء','تنقّل','مظهر']},
] as const;
export type ClueId = typeof clueBoards[number]['id'];

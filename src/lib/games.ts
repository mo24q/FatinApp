export const games = [
  { id: 'outsider', name: 'برا السالفة', tag: 'كشف وخداع', players: '٣–١٢ لاعب', time: '٥–١٠ دقائق', available: true,
    description: 'الكل يعرف الكلمة… إلا واحد. اسألوا، شكّوا، واكتشفوا مين برا السالفة.' },
  { id: 'crime', name: 'الجريمة المغلقة', tag: 'تحقيق وأدوار سرية', players: '٤–١٢ لاعب', time: '١٥–٢٥ دقيقة', available: true,
    description: 'مجرم بينكم، والراوي يعرف الحل. فتّشوا في البطاقات واربطوا خيوط القضية.' },
  { id: 'quick-answer', name: 'على السريع', tag: 'سرعة بديهة', players: 'قريبًا', time: '', available: false,
    description: 'تحديات خفيفة تختبر سرعة البديهة. قريبًا ضمن ألعاب فطين.' },
  { id: 'same-wave', name: 'نفس الموجة', tag: 'توافق وتوقع', players: 'قريبًا', time: '', available: false,
    description: 'قد إيش تعرفون بعض؟ مساحة للعبة جديدة تجمعكم على نفس التفكير.' }
] as const;

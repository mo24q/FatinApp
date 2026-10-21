export const games = [
  { id: 'outsider', name: 'برا السالفة', tag: 'كشف وخداع', players: '٣–١٢ لاعب', time: '٥–١٠ دقائق', available: true,
    description: 'الكل يعرف الكلمة… إلا واحد. اسألوا، شكّوا، واكتشفوا مين برا السالفة.' },
  { id: 'crime', name: 'الجريمة المغلقة', tag: 'تحقيق وأدوار سرية', players: '٤–١٢ لاعب', time: '١٥–٢٥ دقيقة', available: true,
    description: 'مجرم بينكم، والراوي يعرف الحل. تصفّحوا البطاقات واكتشفوا حقيقة القضية.' },
  { id: 'mafia', name: 'المافيا', tag: 'أدوار سرية وخداع', players: '٥–١٢ لاعب', time: '١٥–٣٠ دقيقة', available: true,
    description: 'نامت المدينة… وصحيت الشكوك. فطين يدير اللعبة، أو اختاروا راويًا منكم.' },
  { id: 'wrong', name: 'السؤال المغلوط', tag: 'أسئلة وخداع', players: '٤–١٢ لاعب', time: '٥–١٠ دقائق', available: true,
    description: 'واحد سؤالُه غير، حتى هو ما يدري. جاوبوا سرًا، واكتشفوه من الإجابات.' },
  { id: 'letters', name: 'حرف ورا حرف', tag: 'حروف وسوالف', players: '١–١٢ لاعب', time: '٥–١٥ دقيقة', available: true,
    description: 'سؤال واحد و٢٨ حرفًا. قولوا الإجابة واضغطوا حرفها… حتى آخر حرف.' },
  { id: 'same-wave', name: 'نفس الموجة', tag: 'توافق وتوقع', players: '٢–١٢ لاعب', time: '١٠–٢٠ دقيقة', available: true,
    description: 'تلميح واحد بين طرفين. حرّكوا المؤشر واجمعوا النقاط… هل أنتم على نفس الموجة؟' }
] as const;

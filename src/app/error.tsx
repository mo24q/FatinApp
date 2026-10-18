'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main id="main" className="empty-page"><h1>لحظة ونرجع نكمل.</h1><p>تعذّر عرض الصفحة. جرّب مرة ثانية.</p><button className="button primary" onClick={reset}>إعادة المحاولة</button></main>; }

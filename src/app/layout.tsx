import type { Metadata } from 'next';
import '@fontsource/noto-sans-arabic/400.css';
import '@fontsource/noto-sans-arabic/500.css';
import '@fontsource/noto-sans-arabic/600.css';
import '@fontsource/noto-sans-arabic/700.css';
import '@fontsource/noto-sans-arabic/800.css';
import './globals.css';
export const metadata: Metadata = {
  title: 'فطين | ألعاب تجمعنا', applicationName: 'فطين', description: 'فطين: ألعاب جماعية عربية لجلساتكم. افتح غرفة، شارك الرمز، وخلّ اللمّة تبدأ.'
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body><a href="#main" className="skip-link">انتقل للمحتوى</a>{children}</body></html>;
}

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
export function Brand() {
  return <Link href="/" className="brand" aria-label="فطين — الرئيسية"><span className="brand-icon"><Sparkles size={23}/></span><span>فطين<span className="brand-dot">.</span></span></Link>;
}
export function Footer() {
  return <footer className="footer"><span>فطين — ألعاب تجمعنا.</span><span>صُنعت للوقت اللي يجمعنا <span className="purple">✳</span></span></footer>;
}

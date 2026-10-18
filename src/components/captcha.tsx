'use client';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
type Turnstile = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile } }
export function Captcha({ onToken }: { onToken: (token: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!key || !loaded || !element.current || !window.turnstile) return;
    const id = window.turnstile.render(element.current, { sitekey: key, callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken(''), language: 'ar', theme: 'light' });
    return () => window.turnstile?.remove(id);
  }, [key, loaded, onToken]);
  if (!key) return null;
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setLoaded(true)}/><div ref={element} className="captcha"/></>;
}

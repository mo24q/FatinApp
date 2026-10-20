import { crimeCardById } from './crime-content';
import type { CrimeHand } from './crime-game';

// Render only the public hand, never a screenshot of the room or private file.
export async function createCrimeImage(root: HTMLElement, hand: CrimeHand, name: string): Promise<File> {
  const ids = [...hand.weapons, ...hand.evidence];
  const sources = ids.map(id => {
    const svg = root.querySelector(`[data-card-art="${id}"] svg`)?.cloneNode(true) as SVGElement | undefined;
    if (!svg || !crimeCardById[id]) throw new Error('CARD_ART_MISSING');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '200');
    svg.setAttribute('height', '200');
    return new XMLSerializer().serializeToString(svg);
  });
  await document.fonts.load('700 36px "Noto Sans Arabic"');
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1500;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.fillStyle = '#faf9f6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  function text(value: string, x: number, y: number, size: number, color: string, maxWidth: number) {
    ctx!.font = `700 ${size}px "Noto Sans Arabic", sans-serif`;
    ctx!.fillStyle = color;
    ctx!.fillText(value, x, y, maxWidth);
  }
  text('فطين.', 540, 90, 58, '#7043d1', 960);
  text('الجريمة المغلقة', 540, 150, 28, '#817b89', 960);
  text(`بطاقات ${name}`, 540, 220, 42, '#292534', 960);
  text('أسلحة محتملة', 797, 285, 27, '#8f674f', 450);
  text('أدلة محتملة', 283, 285, 27, '#795d9e', 450);
  for (let i = 0; i < ids.length; i++) {
    const card = crimeCardById[ids[i]];
    const x = i < 4 ? 562 : 48;
    const y = 310 + (i % 4) * 258;
    ctx.beginPath();
    ctx.roundRect(x, y, 470, 240, 24);
    ctx.fillStyle = i < 4 ? '#fffaf5' : '#faf7ff';
    ctx.fill();
    ctx.strokeStyle = '#e1dbe8';
    ctx.lineWidth = 2;
    ctx.stroke();
    const url = URL.createObjectURL(new Blob([sources[i]], { type: 'image/svg+xml' }));
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('CARD_ART_UNAVAILABLE'));
        img.src = url;
      });
      ctx.drawImage(image, x + 156, y + 12, 158, 158);
    } finally {
      URL.revokeObjectURL(url);
    }
    text(card.name, x + 235, y + 207, 28, '#292534', 420);
  }
  text('بطاقات ظاهرة للجميع · بدون دور أو حل القضية', 540, 1400, 22, '#817b89', 960);
  text('فطين — ألعاب تجمعنا', 540, 1450, 24, '#7043d1', 960);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('IMAGE_EXPORT_FAILED')), 'image/png');
  });
  return new File([blob], 'fatin-crime-cards.png', { type: 'image/png' });
}

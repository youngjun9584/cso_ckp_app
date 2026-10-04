/** 공지 HTML 에서 <img src> 를 문서 순서대로 뽑는다 (확대 보기 목록·순번용) */

const IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function extractImageSources(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(IMG_SRC)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    const src = decodeAttr(raw.trim());
    if (src) out.push(src);
  }
  return out;
}

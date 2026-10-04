/**
 * 공지 HTML 정화 (DESIGN §5.6)
 *  - 허용 태그: p, br, h1~h4, strong, b, em, i, u, s, ul, ol, li, blockquote, a, img, hr, table, thead, tbody, tr, th, td, span, code, pre
 *  - a[href,title,target,rel] (https/mailto/tel 만, rel·target 강제), img[src,alt,width,height] (https 또는 data:image/(png|jpeg|jpg|gif|webp);base64)
 *  - iframe(영상) → <p><a href="https 원본">동영상 보기</a></p>
 *  - Quill ql-align-center|right|justify class → style="text-align:…" (이 style 만 허용), 그 외 class·style 제거
 *  - data: 이미지 1개 최대 5MB, 초과 시 '[이미지 생략]'
 */
import sanitizeHtml from 'sanitize-html';

export const DATA_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const OMITTED_IMAGE_TEXT = '[이미지 생략]';
export const VIDEO_LINK_TEXT = '동영상 보기';

const ALLOWED_TAGS = [
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote',
  'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'code', 'pre',
];

/** 정렬 style 을 허용할 블록 태그 (Quill 이 ql-align-* 를 붙이는 요소) */
const ALIGNABLE_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote', 'pre', 'td', 'th'];

/** 내용까지 통째로 버릴 태그 */
const NON_TEXT_TAGS = [
  'script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template',
  'svg', 'math', 'head', 'title', 'xmp', 'noembed', 'noframes', 'select', 'button',
];

const SAFE_HREF_RE = /^(https:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d\-().\s]+)$/i;
const HTTPS_RE = /^https:\/\/[^\s]+$/i;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/i;
const DIMENSION_RE = /^\d{1,5}%?$/;
const ALIGN_RE = /(?:^|\s)ql-align-(center|right|justify)(?:\s|$)/;

function alignFromClass(className: string | undefined): string | null {
  if (!className) return null;
  const m = ALIGN_RE.exec(className);
  return m ? (m[1] as string) : null;
}

/** base64 본문 길이로 디코드 후 바이트 수를 추정 */
function base64DecodedBytes(b64: string): number {
  const clean = b64.replace(/\s+/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/**
 * iframe 을 "동영상 보기" 링크 문단으로 바꾼다(https 일 때만, 아니면 제거).
 * 이 단계의 결과도 다시 sanitize-html 을 거치므로 안전성은 sanitize-html 이 보장한다.
 */
function replaceIframes(html: string): string {
  const re = /<iframe\b([^>]*)>(?:[\s\S]*?<\/iframe\s*>)?|<iframe\b([^>]*)\/>/gi;
  return html.replace(re, (_m, attrs1: string | undefined, attrs2: string | undefined) => {
    const attrs = attrs1 ?? attrs2 ?? '';
    const srcMatch = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const raw = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '') : '';
    const src = decodeBasicEntities(raw.trim());
    if (!HTTPS_RE.test(src)) return '';
    return `<p><a href="${escapeAttr(src)}">${VIDEO_LINK_TEXT}</a></p>`;
  });
}

/** 5MB 를 넘는 data: 이미지는 '[이미지 생략]' 문구로 바꾼다 (sanitize 전 단계) */
function replaceOversizedDataImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const m = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const src = m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
    const data = DATA_IMAGE_RE.exec(src);
    if (data && base64DecodedBytes(data[2] as string) > DATA_IMAGE_MAX_BYTES) return `<span>${OMITTED_IMAGE_TEXT}</span>`;
    return tag;
  });
}

function blockTransform(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
  const align = alignFromClass(attribs.class);
  const next: sanitizeHtml.Attributes = {};
  if (align) next.style = `text-align:${align}`;
  return { tagName, attribs: next };
}

const transformTags: Record<string, sanitizeHtml.Transformer> = {
  a: (tagName, attribs) => {
    const next: sanitizeHtml.Attributes = {};
    const href = (attribs.href ?? '').trim();
    if (href && SAFE_HREF_RE.test(href)) next.href = href;
    if (attribs.title) next.title = attribs.title;
    next.target = '_blank';
    next.rel = 'noopener noreferrer nofollow';
    return { tagName, attribs: next };
  },
  img: (tagName, attribs) => {
    const src = (attribs.src ?? '').trim();
    const next: sanitizeHtml.Attributes = {};
    const data = DATA_IMAGE_RE.exec(src);
    if (data) {
      // 크기 초과분은 replaceOversizedDataImages 에서 이미 문구로 바뀐다. 남아 있으면 src 를 버려 이미지 자체를 제거.
      if (base64DecodedBytes(data[2] as string) <= DATA_IMAGE_MAX_BYTES) next.src = src.replace(/\s+/g, '');
    } else if (HTTPS_RE.test(src)) {
      next.src = src;
    }
    if (attribs.alt) next.alt = attribs.alt;
    if (attribs.width && DIMENSION_RE.test(attribs.width)) next.width = attribs.width;
    if (attribs.height && DIMENSION_RE.test(attribs.height)) next.height = attribs.height;
    return { tagName, attribs: next };
  },
};
for (const tag of ALIGNABLE_TAGS) transformTags[tag] = blockTransform;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    ...Object.fromEntries(ALIGNABLE_TAGS.map((t) => [t, ['style']])),
  },
  allowedStyles: {
    '*': { 'text-align': [/^(center|right|justify)$/] },
  },
  allowedSchemes: ['https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['https', 'data'] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  allowedClasses: {},
  disallowedTagsMode: 'discard',
  nonTextTags: NON_TEXT_TAGS,
  transformTags,
  exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
};

/** 공지 본문 HTML 정화. null/빈 값은 '' */
export function sanitizeNoticeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeHtml(replaceOversizedDataImages(replaceIframes(html)), OPTIONS).trim();
}

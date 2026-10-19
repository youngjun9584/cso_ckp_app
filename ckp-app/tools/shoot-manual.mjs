/**
 * 메뉴얼 스크린샷 자동 촬영 (assets/manual/*.png).
 * 화면이 바뀌어 메뉴얼 이미지를 갱신할 때 실행한다.
 *
 * 준비
 *   1) 샘플 모드로 웹 서버 실행:  set EXPO_PUBLIC_API_MODE=sample && set EXPO_PUBLIC_API_BASE_URL= && npx expo start --web --port 8089
 *   2) playwright-core 설치(패키지 목록에 넣지 않음):  npm i --no-save playwright-core
 *   3) 실행:  node tools/shoot-manual.mjs            (모바일 + 넓은 화면)
 *             node tools/shoot-manual.mjs mobile     (모바일만)  /  wide (넓은 화면만)
 *   Chrome 경로가 다르면 CHROME_EXE 환경변수로 지정한다.
 * 샘플 계정 ckp_demo / demo1234 로 로그인하며, 샘플 모드 띠는 촬영 전에 숨긴다.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:8089';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/manual');
const EXE = process.env.CHROME_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const explore = process.argv.includes('explore');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(page, ms = 1200) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(ms);
}

async function hideBanner(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[aria-label="샘플 모드 · 서버에 저장되지 않습니다"]')) el.style.display = 'none';
  });
}

async function shot(page, name, suffix) {
  await settle(page);
  await hideBanner(page);
  await sleep(150);
  const file = path.join(OUT, `${name}${suffix}.png`);
  await page.screenshot({ path: file });
  console.log('shot', path.basename(file));
}

async function dump(page, label) {
  const items = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[role], input, button, textarea')) {
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const name = el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.textContent || '').trim().slice(0, 60);
      if (name) out.push(`${role}: ${name}`);
    }
    return out;
  });
  console.log(`---- ${label}\n` + items.join('\n'));
}

async function login(page) {
  await page.goto(`${BASE}/login`);
  await settle(page);
  await page.getByPlaceholder('아이디').last().fill('ckp_demo');
  await page.getByPlaceholder('비밀번호').last().fill('demo1234');
  await page.getByRole('button', { name: '로그인', exact: true }).last().click();
  await page.waitForURL(/\/home/, { timeout: 30000 });
  await settle(page);
}

async function openFirst(page, pattern, urlPattern) {
  const el = page.getByRole('button', { name: pattern }).last();
  if (!(await el.count())) {
    console.log('not found:', pattern);
    return false;
  }
  await el.click();
  await page.waitForURL(urlPattern);
  return true;
}

async function run(suffix, viewport, deviceScaleFactor, isMobile) {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, isMobile, hasTouch: isMobile, locale: 'ko-KR' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(240000);
  page.on('pageerror', (e) => console.log('pageerror', e.message));

  // 로그인 / 회원가입
  await page.goto(`${BASE}/login`);
  await shot(page, 'login', suffix);
  await page.getByRole('button', { name: '회원가입' }).last().click();
  await page.waitForURL(/\/signup/);
  await shot(page, 'signup', suffix);

  await login(page);
  await shot(page, 'home', suffix);

  // 의약품
  await page.goto(`${BASE}/medicines`);
  await shot(page, 'medicines', suffix);
  if (await openFirst(page, /CKP도네온필름코팅정10mg/, /\/medicines\/./)) await shot(page, 'medicine-detail', suffix);

  // 공지사항
  await page.goto(`${BASE}/notices`);
  await shot(page, 'notices', suffix);
  if (await openFirst(page, /앱으로 EDI 사진 등록하는 방법/, /\/notices\/./)) await shot(page, 'notice-detail', suffix);

  // EDI 내역 / 상세
  await page.goto(`${BASE}/edi`);
  await shot(page, 'edi', suffix);
  if (await openFirst(page, /한빛정형외과의원.*상세 보기/, /\/edi\/./)) await shot(page, 'edi-detail', suffix);

  // EDI 새 등록
  await page.goto(`${BASE}/edi/new`);
  await settle(page, 1500);
  await shot(page, 'edi-new-1', suffix);
  await ediSteps(page, suffix);

  // 거래처
  await page.goto(`${BASE}/clients`);
  await shot(page, 'clients', suffix);
  if (await openFirst(page, /^서울바른내과의원, 승인 상태/, /\/clients\/./)) await shot(page, 'client-detail', suffix);
  await page.goto(`${BASE}/clients/new`);
  await shot(page, 'client-new', suffix);

  // 계정
  await page.goto(`${BASE}/account`);
  await shot(page, 'account', suffix);

  // 메뉴얼 (있을 때만)
  await page.goto(`${BASE}/manual`);
  await settle(page, 1200);
  if (!/not-found/.test(page.url()) && (await page.getByRole('heading', { name: '메뉴얼' }).count())) {
    await shot(page, 'manual', suffix);
  }

  await browser.close();
}

async function ediSteps(page, suffix) {
  // 1단계: 거래처 선택
  await page.getByRole('button', { name: /거래처 선택/ }).last().click();
  await settle(page, 800);
  if (explore) await dump(page, 'client picker');
  await shot(page, 'edi-new-1-picker', suffix);
  const option = page.getByRole('button', { name: /서울바른내과의원/ }).last();
  if (await option.count()) await option.click();
  else {
    const text = page.getByText('서울바른내과의원').last();
    await text.click();
  }
  await settle(page, 600);
  await page.getByRole('button', { name: /^다음/ }).last().click();
  await settle(page, 800);
  if (explore) await dump(page, 'step2');
  await shot(page, 'edi-new-2-empty', suffix);
  // 2단계: 사진 추가 — 웹은 클릭 때 <input type=file> 을 만들어 여므로 filechooser 이벤트로 받는다
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null);
  await page.getByRole('button', { name: /사진 파일 선택|앨범에서 선택/ }).last().click();
  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles([
      path.join(OUT, `login${suffix}.png`),
      path.join(OUT, `home${suffix}.png`),
      path.join(OUT, `notices${suffix}.png`),
      path.join(OUT, `medicines${suffix}.png`),
    ]);
    await settle(page, 4000);
  } else console.log('no file chooser');
  await shot(page, 'edi-new-2', suffix);
  await page.getByRole('button', { name: /^다음 · 확인$/ }).last().click();
  await settle(page, 800);
  if (explore) await dump(page, 'step3');
  await shot(page, 'edi-new-3', suffix);
}

const which = process.argv.includes('wide') ? ['wide'] : process.argv.includes('mobile') ? ['mobile'] : ['mobile', 'wide'];
for (const w of which) {
  if (w === 'mobile') await run('', { width: 390, height: 844 }, 2, true);
  else await run('-wide', { width: 1280, height: 800 }, 1.5, false);
}

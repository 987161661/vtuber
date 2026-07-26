import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import QRCode from 'qrcode';
import {
  bilibiliQrState,
  mergeBilibiliLoginCookie,
  validateBilibiliCookie,
} from './bilibili-qr-auth-common.mjs';
import {
  chooseQrCandidate,
  hasPlatformLogin,
  platformAuthProvider,
  serializePlatformCookies,
} from './platform-qr-auth-common.mjs';

const PORT = Number(process.env.PLATFORM_QR_AUTH_PORT || 8198);
const GATEWAY_URL =
  process.env.ORDINARYROAD_GATEWAY_URL || 'http://127.0.0.1:8197';
const SESSION_TTL_MS = 180_000;
const EDGE_PATH =
  process.env.PLATFORM_AUTH_BROWSER_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const workspaceRoot = resolve(appRoot, '..');
const credentialRoot = resolve(
  workspaceRoot,
  '.runtime',
  'live-connectors',
  'credentials',
  'ordinaryroad',
);
const requestHeaders = {
  Referer: 'https://www.bilibili.com/',
  'User-Agent': 'Mozilla/5.0 Chrome/136 Safari/537.36',
};

const sessions = new Map();

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function existingBilibiliCookie() {
  try {
    const path = resolve(credentialRoot, 'bilibili.json');
    return String(JSON.parse(readFileSync(path, 'utf8'))?.cookie || '');
  } catch {
    return '';
  }
}

function setCors(request, response) {
  const origin = String(request.headers.origin || '');
  if (ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
}

function json(request, response, status, payload) {
  setCors(request, response);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function publicSession(session) {
  if (!session) return { state: 'idle' };
  return {
    id: session.id,
    platformId: session.platformId,
    platformLabel: session.provider.label,
    state: session.state,
    qrDataUrl:
      session.state === 'authenticated' ? undefined : session.qrDataUrl,
    expiresAt: session.expiresAt,
    detail: session.detail,
  };
}

async function persistCredential(platformId, cookie) {
  const response = await fetch(
    `${GATEWAY_URL}/platforms/${encodeURIComponent(platformId)}/credential`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie }),
      signal: AbortSignal.timeout(12_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `gateway_http_${response.status}`);
  }
}

async function closeBrowserSession(session) {
  if (!session?.browser) return;
  const browser = session.browser;
  session.browser = null;
  await browser.close().catch(() => {});
}

async function startBilibiliSession(provider) {
  const response = await fetch(
    'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
    { headers: requestHeaders, signal: AbortSignal.timeout(8_000) },
  );
  const payload = await response.json();
  if (!response.ok || payload?.code !== 0 || !payload?.data?.qrcode_key) {
    throw new Error('bilibili_qr_generate_failed');
  }
  const now = Date.now();
  return {
    id: randomUUID(),
    platformId: provider.id,
    provider,
    key: payload.data.qrcode_key,
    qrDataUrl: await QRCode.toDataURL(payload.data.url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
    }),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    state: 'waiting-scan',
    detail: '',
    polling: null,
  };
}

async function clickLoginTrigger(page, preferScan = false) {
  for (const frame of page.frames()) {
    const clicked = await frame
      .evaluate((scanPreferred) => {
        if (scanPreferred) {
          const platformScanSwitch = document.querySelector(
            '.scanicon-toLogin, #J-qrcode-target, [class*="scanicon" i]',
          );
          if (platformScanSwitch) {
            platformScanSwitch.click();
            return 'platform-scan-switch';
          }
        }
        const nodes = [...document.querySelectorAll('button, a, [role="button"], div, span')];
        const candidates = nodes
          .filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (
              style.visibility === 'hidden' ||
              style.display === 'none' ||
              rect.width < 20 ||
              rect.height < 16
            ) {
              return false;
            }
            const text = String(element.textContent || '').trim();
            return /登录/u.test(text) && text.length <= 20;
          })
          .sort(
            (left, right) =>
              (scanPreferred && /扫码|二维码/u.test(String(right.textContent || ''))
                ? 1
                : 0) -
                (scanPreferred && /扫码|二维码/u.test(String(left.textContent || ''))
                  ? 1
                  : 0) ||
              String(left.textContent || '').length -
                String(right.textContent || '').length,
          );
        candidates[0]?.click();
        return candidates[0]
          ? `text:${String(candidates[0].textContent || '').trim()}`
          : '';
      }, preferScan)
      .catch(() => '');
    if (clicked) return clicked;
  }
  return '';
}

async function captureQrCode(page, platformId) {
  const candidates = [];
  const strongSelector =
    '[class*="qrcode" i], [id*="qrcode" i], [class~="qr" i], [class*="qr-" i], [class*="-qr" i], [class*="scan" i]';
  for (const frame of page.frames()) {
    const strongHandles = await frame.$$(strongSelector).catch(() => []);
    const mediaHandles = await frame.$$('canvas, img, svg').catch(() => []);
    for (const handle of [...strongHandles, ...mediaHandles.slice(0, 160)]) {
      const box = await handle.boundingBox().catch(() => null);
      if (!box) continue;
      const metadata = await handle
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            tagName: element.tagName,
            visible:
              style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              Number(style.opacity || 1) > 0,
            hint: [element, element.parentElement, element.parentElement?.parentElement]
              .filter(Boolean)
              .map(
                (node) =>
                  `${node.id || ''} ${String(node.className || '')} ${node.getAttribute?.('alt') || ''}`,
              )
              .join(' '),
          };
        })
        .catch(() => ({ visible: false, hint: '' }));
      candidates.push({ ...box, ...metadata, handle });
    }
  }
  const choice = chooseQrCandidate(candidates);
  if (!choice) {
    const diagnostic = await page
      .evaluate(() => {
        const element = document.querySelector(
          '.qrcode, .qr-login-code, [class*="qrcode" i]',
        );
        if (!element) return { found: false };
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          found: true,
          className: String(element.className || ''),
          width: rect.width,
          height: rect.height,
          display: style.display,
          visibility: style.visibility,
        };
      })
      .catch(() => ({ found: false }));
    console.log(
      JSON.stringify({
        event: 'platform-auth-qr-missing',
        platformId,
        diagnostic,
      }),
    );
    return '';
  }
  console.log(
    JSON.stringify({
      event: 'platform-auth-qr-candidate',
      platformId,
      tagName: choice.tagName,
      width: choice.width,
      height: choice.height,
      hint: String(choice.hint || '').slice(0, 240),
    }),
  );
  const embeddedImage = await choice.handle
    .evaluate((element) => {
      if (element instanceof HTMLCanvasElement) {
        return element.toDataURL('image/png');
      }
      if (element instanceof HTMLImageElement && element.src.startsWith('data:')) {
        return element.src;
      }
      return '';
    })
    .catch(() => '');
  if (embeddedImage) return embeddedImage;
  const image = await choice.handle.screenshot({ encoding: 'base64' });
  return `data:image/png;base64,${image}`;
}

async function browserCookies(session) {
  return session.browser.defaultBrowserContext().cookies();
}

async function completeBrowserLogin(session) {
  const cookies = await browserCookies(session);
  if (!hasPlatformLogin(cookies, session.provider)) return false;
  const cookie = serializePlatformCookies(cookies, session.provider);
  if (!cookie) throw new Error('platform_login_cookie_empty');
  await persistCredential(session.platformId, cookie);
  session.state = 'authenticated';
  session.detail = '授权成功，登录态已安全保存，直播网关正在重连。';
  session.qrDataUrl = '';
  await closeBrowserSession(session);
  return true;
}

async function startBrowserSession(provider) {
  const now = Date.now();
  const session = {
    id: randomUUID(),
    platformId: provider.id,
    provider,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    state: 'waiting-scan',
    detail: '',
    qrDataUrl: '',
    browser: null,
    page: null,
    polling: null,
  };
  session.browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--window-size=1180,820',
    ],
  });
  const pages = await session.browser.pages();
  session.page = pages[0] || (await session.browser.newPage());
  await session.page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 1 });
  await session.page.goto(provider.loginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 25_000,
  });
  if (provider.loginSelector) {
    await session.page
      .waitForSelector(provider.loginSelector, {
        visible: true,
        timeout: 12_000,
      })
      .catch(() => {});
  }
  await delay(provider.pageReadyDelayMs || 1_200);
  if (provider.loginSelector) {
    const selectorClicked = await session.page
      .$eval(provider.loginSelector, (element) => element.click())
      .then(() => true)
      .catch(() => false);
    console.log(
      JSON.stringify({
        event: 'platform-auth-preferred-login-click',
        platformId: provider.id,
        selector: provider.loginSelector,
        clicked: selectorClicked,
      }),
    );
  }
  const loginPromptOpened = provider.loginSelector
    ? `selector:${provider.loginSelector}`
    : await clickLoginTrigger(session.page);
  console.log(
    JSON.stringify({
      event: 'platform-auth-login-trigger',
      platformId: provider.id,
      trigger: loginPromptOpened || 'none',
    }),
  );
  if (!loginPromptOpened && (await completeBrowserLogin(session))) return session;
  await delay(provider.loginReadyDelayMs || 600);
  const scanSwitch = provider.skipScanSwitch
    ? 'not-required'
    : await clickLoginTrigger(session.page, true);
  console.log(
    JSON.stringify({
      event: 'platform-auth-scan-switch',
      platformId: provider.id,
      trigger: scanSwitch || 'none',
    }),
  );
  await delay(1_200);
  session.qrDataUrl = await captureQrCode(session.page, provider.id);
  if (!session.qrDataUrl) {
    session.state = 'error';
    session.detail = `未能从${provider.label}官方登录页读取二维码，请重新授权。`;
    await closeBrowserSession(session);
  }
  return session;
}

async function startSession(platformId) {
  const provider = platformAuthProvider(platformId);
  if (!provider) throw new Error('platform_qr_auth_unsupported');
  await closeBrowserSession(sessions.get(platformId));
  const session =
    provider.mode === 'api'
      ? await startBilibiliSession(provider)
      : await startBrowserSession(provider);
  sessions.set(platformId, session);
  return publicSession(session);
}

async function pollBilibiliSession(session) {
  const response = await fetch(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(session.key)}`,
    { headers: requestHeaders, signal: AbortSignal.timeout(8_000) },
  );
  const payload = await response.json();
  if (!response.ok || payload?.code !== 0) {
    throw new Error('bilibili_qr_poll_failed');
  }
  const state = bilibiliQrState(Number(payload?.data?.code));
  session.state = state;
  session.detail = String(payload?.data?.message || '');
  if (state !== 'authenticated') return;

  const setCookieHeaders =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  const cookie = mergeBilibiliLoginCookie({
    existingCookie: existingBilibiliCookie(),
    redirectUrl: payload?.data?.url,
    setCookieHeaders,
  });
  if (!(await validateBilibiliCookie(cookie))) {
    throw new Error('扫码完成，但 B 站未返回有效登录态。');
  }
  await persistCredential('bilibili', cookie);
  session.state = 'authenticated';
  session.detail = '授权成功，登录态已安全保存，直播网关正在重连。';
}

async function pollBrowserSession(session) {
  if (!session.browser || !session.page || session.page.isClosed()) {
    throw new Error('官方登录会话已关闭，请重新授权。');
  }
  if (await completeBrowserLogin(session)) return;
  session.qrDataUrl =
    (await captureQrCode(session.page, session.platformId)) ||
    session.qrDataUrl;
}

async function pollSession(platformId) {
  const session = sessions.get(platformId);
  if (!session) return { platformId, state: 'idle' };
  if (session.state === 'authenticated') return publicSession(session);
  if (Date.now() >= session.expiresAt) {
    session.state = 'expired';
    session.detail = '二维码已过期，请生成新的二维码。';
    await closeBrowserSession(session);
    return publicSession(session);
  }
  if (session.polling) return session.polling;

  session.polling = (async () => {
    if (session.provider.mode === 'api') await pollBilibiliSession(session);
    else await pollBrowserSession(session);
    return publicSession(session);
  })()
    .catch(async (error) => {
      session.state = 'error';
      session.detail =
        error instanceof Error ? error.message : 'platform_qr_auth_unknown_error';
      await closeBrowserSession(session);
      return publicSession(session);
    })
    .finally(() => {
      session.polling = null;
    });
  return session.polling;
}

async function cancelSession(platformId) {
  const session = sessions.get(platformId);
  await closeBrowserSession(session);
  sessions.delete(platformId);
  return { platformId, state: 'idle', detail: '授权会话已取消。' };
}

const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>直播平台扫码授权服务</title></head><body><main><h1>直播平台扫码授权服务</h1><p>请从数字人配置页选择平台并发起扫码授权。</p></main></body></html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  if (request.method === 'OPTIONS') {
    setCors(request, response);
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    });
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(page);
    return;
  }

  const platformRoute = url.pathname.match(
    /^\/platforms\/([a-z0-9-]+)\/(start|status|cancel)$/,
  );
  const legacyRoute = url.pathname === '/start' || url.pathname === '/status';
  if (platformRoute || legacyRoute) {
    const platformId = platformRoute?.[1] || 'bilibili';
    const action = platformRoute?.[2] || url.pathname.slice(1);
    const expectedMethod =
      action === 'start' ? 'POST' : action === 'cancel' ? 'DELETE' : 'GET';
    if (request.method !== expectedMethod) {
      json(request, response, 405, { state: 'error', detail: 'method_not_allowed' });
      return;
    }
    const operation =
      action === 'start'
        ? startSession(platformId)
        : action === 'cancel'
          ? cancelSession(platformId)
          : pollSession(platformId);
    void operation
      .then((value) => json(request, response, 200, value))
      .catch((error) =>
        json(request, response, 502, {
          platformId,
          state: 'error',
          detail: String(error.message || error),
        }),
      );
    return;
  }
  json(request, response, 404, { error: 'not_found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Platform QR auth ready at http://127.0.0.1:${PORT}/`);
});

async function shutdown() {
  await Promise.all([...sessions.values()].map(closeBrowserSession));
  server.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

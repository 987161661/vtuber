export const PLATFORM_AUTH_PROVIDERS = Object.freeze({
  bilibili: {
    id: 'bilibili',
    label: '哔哩哔哩',
    mode: 'api',
  },
  douyu: {
    id: 'douyu',
    label: '斗鱼',
    mode: 'browser',
    loginUrl: 'https://passport.douyu.com/member/login',
    domains: ['douyu.com'],
    authCookieGroups: [
      ['acf_uid', 'acf_auth'],
      ['acf_uid', 'acf_stk'],
    ],
  },
  huya: {
    id: 'huya',
    label: '虎牙',
    mode: 'browser',
    loginUrl: 'https://www.huya.com/',
    pageReadyDelayMs: 3_500,
    loginReadyDelayMs: 2_000,
    skipScanSwitch: true,
    domains: ['huya.com', 'yy.com'],
    authCookieGroups: [
      ['yyuid', 'udb_passdata'],
      ['udb_uid', 'udb_biztoken'],
    ],
  },
  kuaishou: {
    id: 'kuaishou',
    label: '快手',
    mode: 'browser',
    loginUrl: 'https://live.kuaishou.com/',
    loginSelector: '.login.flex-center',
    pageReadyDelayMs: 800,
    loginReadyDelayMs: 1_200,
    skipScanSwitch: true,
    domains: ['kuaishou.com'],
    authCookieGroups: [
      ['userId', 'kuaishou.live.web_st'],
      ['userId', 'kuaishou.live.bfb1s'],
    ],
  },
});

export function platformAuthProvider(platformId) {
  return PLATFORM_AUTH_PROVIDERS[String(platformId || '').trim()] || null;
}

export function serializePlatformCookies(cookies, provider) {
  const domainSuffixes = provider?.domains || [];
  return (cookies || [])
    .filter((cookie) =>
      domainSuffixes.some((suffix) =>
        String(cookie.domain || '')
          .replace(/^\./, '')
          .endsWith(suffix),
      ),
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function hasPlatformLogin(cookies, provider) {
  const names = new Set((cookies || []).map((cookie) => cookie.name));
  return Boolean(
    provider?.authCookieGroups?.some((group) =>
      group.every((name) => names.has(name)),
    ),
  );
}

export function chooseQrCandidate(candidates) {
  return (candidates || [])
    .filter(
      (candidate) =>
        candidate.visible &&
        candidate.width >= 120 &&
        candidate.height >= 120 &&
        candidate.width <= 520 &&
        candidate.height <= 520,
    )
    .map((candidate) => {
      const ratio = Math.min(candidate.width, candidate.height) /
        Math.max(candidate.width, candidate.height);
      const qrHint =
        /qrcode|(?:^|[\s_-])(?:qr|scan)(?:[\s_-]|$)|扫码|二维码/iu.test(
          candidate.hint || '',
        );
      const canvasHint = candidate.tagName === 'CANVAS';
      const directImage =
        canvasHint || candidate.tagName === 'IMG' || candidate.tagName === 'SVG';
      const loginHint = /login|passport|qr[-_]?image|qrimg/i.test(
        candidate.hint || '',
      );
      const promotionalHint =
        /download|footer|app[-_]?qrcode|footer[-_]?prod/i.test(
          candidate.hint || '',
        );
      return {
        ...candidate,
        score:
          (qrHint ? 5 : 0) +
          (directImage ? 2 : 0) +
          (loginHint ? 4 : 0) +
          ratio * 3 -
          (promotionalHint ? 8 : 0),
        credible: qrHint || (canvasHint && ratio >= 0.86),
      };
    })
    .filter((candidate) => candidate.credible)
    .sort((left, right) => right.score - left.score)[0] || null;
}

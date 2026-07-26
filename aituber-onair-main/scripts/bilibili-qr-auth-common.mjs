const LOGIN_COOKIE_NAMES = new Set([
  'DedeUserID',
  'DedeUserID__ckMd5',
  'SESSDATA',
  'bili_jct',
  'sid',
]);

function cookieEntries(cookie) {
  return String(cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('=');
      return separator > 0
        ? [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
        : ['', ''];
    })
    .filter(([name]) => name);
}

export function mergeBilibiliLoginCookie({
  existingCookie = '',
  redirectUrl = '',
  setCookieHeaders = [],
}) {
  const values = new Map(cookieEntries(existingCookie));

  for (const header of setCookieHeaders) {
    const [entry] = String(header || '').split(';');
    const [[name, value] = []] = cookieEntries(entry);
    if (name && value) values.set(name, value);
  }

  if (redirectUrl) {
    const redirect = new URL(redirectUrl);
    for (const name of LOGIN_COOKIE_NAMES) {
      const value = redirect.searchParams.get(name);
      if (value) values.set(name, value);
    }
  }

  if (!values.get('SESSDATA') || !values.get('bili_jct')) {
    throw new Error('bilibili_qr_cookie_incomplete');
  }

  return [...values.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export function bilibiliQrState(code) {
  if (code === 0) return 'authenticated';
  if (code === 86101) return 'waiting-scan';
  if (code === 86090) return 'waiting-confirmation';
  if (code === 86038) return 'expired';
  return 'error';
}

export async function validateBilibiliCookie(cookie, fetchImpl = fetch) {
  const response = await fetchImpl(
    'https://api.bilibili.com/x/web-interface/nav',
    {
      headers: {
        Cookie: cookie,
        Referer: 'https://www.bilibili.com/',
        'User-Agent': 'Mozilla/5.0 Chrome/136 Safari/537.36',
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  const payload = await response.json();
  return Boolean(
    response.ok && payload?.code === 0 && payload?.data?.isLogin,
  );
}

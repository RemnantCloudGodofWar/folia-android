const NETEASE_DOMAINS = [
  'music.163.com',
  '.music.163.com',
  'www.music.163.com',
  '.163.com',
  '163.com',
  'interface.music.163.com',
  'interface3.music.163.com',
  '.126.net',
];
const NETEASE_URLS = [
  'https://music.163.com/',
  'https://music.163.com',
  'https://www.music.163.com/',
  'https://interface.music.163.com/',
  'https://interface3.music.163.com/',
];
const QQ_DOMAINS = [
  'y.qq.com', '.y.qq.com', '.qq.com', 'qq.com', 'i.y.qq.com',
  'graph.qq.com', '.graph.qq.com', 'u.y.qq.com', '.tencent.com',
];
const QQ_URLS = [
  'https://y.qq.com/',
  'https://y.qq.com',
  'https://i.y.qq.com/',
  'https://u.y.qq.com/',
  'https://graph.qq.com/',
  'https://qq.com/',
];
const QQ_COOKIE_KEYS = [
  'uin', 'p_uin', 'wxuin', 'qqmusic_uin', 'qm_keyst', 'qqmusic_key', 'music_key',
  'p_skey', 'skey', 'wxskey', 'login_type', 'vipType', 'vip_type', 'green_vip_level',
  'luxury_vip_level', 'music_vip_level', 'psrf_qqaccess_token', 'psrf_qqrefresh_token',
  'wxuin', 'wxopenid', 'tmeLoginType',
];
const KG_DOMAINS = ['kugou.com', '.kugou.com', 'www.kugou.com', 'm.kugou.com', '.kugou.net'];
const KG_URLS = ['https://www.kugou.com/', 'https://kugou.com/', 'https://m.kugou.com/'];
const KG_COOKIE_KEYS = [
  'userid', 'token', 'KugooID', 'KuGoo', 'Kugoo', 'NickName', 'nickname', 'kg_mid', 'kugouid',
  'pic', 'user_pic', 'avatar', 'headpic', 'userpic', 'dfid', 'DFID', 'KToken', 't', 't1', 'KugooPwd',
  'vip_type', 'vip_token', 'VIPType', 'VipType', 'musicvip', 'MusicPack', 'musicpack', 'is_vip',
  'IsVIP', 'isVIP', 'su_vip', 'm_type', 'y_type', 'music_vip', 'VipLevel', 'vip_level',
  'vip_endtime', 'vip_end_time', 'su_vip_end_time', 'm_end_time',
  'KUGOU_API_PLATFORM', 'KUGOU_API_GUID', 'KUGOU_API_MID', 'KUGOU_API_DEV', 'KUGOU_API_MAC', 'KUGOU_API_WEBGL',
];
const NETEASE_KEY_NAMES = ['MUSIC_U', 'MUSIC_A', '__csrf', 'NMTID', 'WNMCID', 'WEVNSM', '_ntes_nuid', '_ntes_nnid', 'MUSIC_R_U'];

const COOKIE_CACHE_TTL_MS = 2500;
const PERSISTENT_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400;
const cookieCache = new Map();
const BRIDGE_COOKIE_STORAGE_KEYS = {
  netease: 'foliaBridgeNeteaseCookie',
  qq: 'foliaBridgeQqCookie',
  kg: 'foliaBridgeKgCookie',
};

function persistentCookieExpirationDate() {
  return Math.floor(Date.now() / 1000) + PERSISTENT_COOKIE_MAX_AGE_SEC;
}

function cookieDomainForUrl(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === 'kugou.com' || host.endsWith('.kugou.com')) return '.kugou.com';
    if (host === 'kugou.net' || host.endsWith('.kugou.net')) return '.kugou.net';
    if (host.endsWith('.qq.com')) return '.qq.com';
    if (host.endsWith('.163.com')) return '.163.com';
  } catch (_) {}
  return undefined;
}

function buildPersistentCookieSetOptions(baseUrl, name, value) {
  const domain = cookieDomainForUrl(baseUrl);
  return {
    url: baseUrl,
    name,
    value,
    path: '/',
    secure: true,
    expirationDate: persistentCookieExpirationDate(),
    ...(domain ? { domain } : {}),
  };
}

export function clearCookieCache() {
  cookieCache.clear();
}

export async function saveProviderCookie(provider, cookieHeader) {
  const storageKey = BRIDGE_COOKIE_STORAGE_KEYS[provider];
  const cookie = typeof cookieHeader === 'string'
    ? cookieHeader.trim()
    : Array.isArray(cookieHeader)
      ? cookieHeader
          .map((item) => {
            const name = item?.name;
            const value = normalizeCookieValue(item);
            return name && value ? `${name}=${value}` : '';
          })
          .filter(Boolean)
          .join('; ')
      : cookieHeader && typeof cookieHeader === 'object'
        ? Object.entries(cookieHeader)
            .map(([name, value]) => {
              const normalized = normalizeCookieValue(value);
              return name && normalized ? `${name}=${normalized}` : '';
            })
            .filter(Boolean)
            .join('; ')
        : '';
  if (!storageKey || !cookie || !chrome.storage?.local) return;
  try {
    const current = await chrome.storage.local.get([storageKey]);
    const merged = mergeCookieHeaders(current?.[storageKey] || '', cookie);
    await chrome.storage.local.set({ [storageKey]: merged });
  } catch (_) {}
  clearCookieCache();
}

async function readStoredProviderCookie(provider) {
  const storageKey = BRIDGE_COOKIE_STORAGE_KEYS[provider];
  if (!storageKey || !chrome.storage?.local) return '';
  try {
    const stored = await chrome.storage.local.get([storageKey]);
    return String(stored?.[storageKey] || '');
  } catch (_) {
    return '';
  }
}

function mergeCookieHeaders(...headers) {
  const merged = new Map();
  headers.forEach((header) => {
    Object.entries(parseCookieString(header)).forEach(([name, value]) => {
      if (name && value !== '') merged.set(name, value);
    });
  });
  return Array.from(merged, ([name, value]) => `${name}=${value}`).join('; ');
}

async function withStoredCookie(provider, build) {
  const [collected, stored] = await Promise.all([
    build(),
    readStoredProviderCookie(provider),
  ]);
  return mergeCookieHeaders(stored, collected);
}

async function withCookieCache(key, build) {
  const hit = cookieCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < COOKIE_CACHE_TTL_MS) return hit.value;
  const value = await build();
  cookieCache.set(key, { value, at: now });
  return value;
}

async function collectCookieHeader(domains, urls, keyNames, keyUrl) {
  const picked = new Map();
  await Promise.all([
    ...(domains || []).map(async (domain) => {
      try { await mergeCookieList(picked, await chrome.cookies.getAll({ domain })); } catch (_) {}
    }),
    ...(urls || []).map(async (url) => {
      try { await mergeCookieList(picked, await chrome.cookies.getAll({ url })); } catch (_) {}
    }),
    ...(keyNames || []).map(async (name) => {
      try {
        const item = await chrome.cookies.get({ url: keyUrl, name });
        if (item && item.value) picked.set(name, item.value);
      } catch (_) {}
    }),
  ]);
  return Array.from(picked.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function mergeCookieList(picked, list) {
  (list || []).forEach((item) => {
    if (item && item.name && item.value != null && item.value !== '') {
      picked.set(item.name, item.value);
    }
  });
}

export async function getCookieHeader(domains, urls) {
  const picked = new Map();
  for (const domain of domains || []) {
    try {
      await mergeCookieList(picked, await chrome.cookies.getAll({ domain }));
    } catch (_) {}
  }
  for (const url of urls || []) {
    try {
      await mergeCookieList(picked, await chrome.cookies.getAll({ url }));
    } catch (_) {}
  }
  return Array.from(picked.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export async function getNeteaseCookie() {
  return withCookieCache('netease', () => withStoredCookie('netease', () => collectCookieHeader(
    NETEASE_DOMAINS, NETEASE_URLS, NETEASE_KEY_NAMES, 'https://music.163.com/',
  )));
}

export async function getQQCookie() {
  return withCookieCache('qq', () => withStoredCookie('qq', () => collectCookieHeader(
    QQ_DOMAINS, QQ_URLS, QQ_COOKIE_KEYS, 'https://y.qq.com/',
  )));
}

export async function getKGCookie() {
  return withCookieCache('kg', () => withStoredCookie('kg', () => collectCookieHeader(
    KG_DOMAINS, KG_URLS, KG_COOKIE_KEYS, 'https://www.kugou.com/',
  )));
}

export function parseCookieString(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx <= 0) return;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (key) out[key] = value;
    });
  return out;
}

function normalizeCookieValue(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value.value != null) return String(value.value);
  return String(value);
}

export async function setBrowserCookies(baseUrl, cookieInput) {
  const tasks = [];
  if (typeof cookieInput === 'string') {
    Object.entries(parseCookieString(cookieInput)).forEach(([name, value]) => {
      tasks.push(chrome.cookies.set(buildPersistentCookieSetOptions(baseUrl, name, value)).catch(() => null));
    });
  } else if (Array.isArray(cookieInput)) {
    cookieInput.forEach((item) => {
      const name = item && item.name;
      const value = normalizeCookieValue(item);
      if (!name || !value) return;
      tasks.push(chrome.cookies.set(buildPersistentCookieSetOptions(baseUrl, name, value)).catch(() => null));
    });
  } else if (cookieInput && typeof cookieInput === 'object') {
    Object.entries(cookieInput).forEach(([name, value]) => {
      const v = normalizeCookieValue(value);
      if (!name || !v) return;
      tasks.push(chrome.cookies.set(buildPersistentCookieSetOptions(baseUrl, name, v)).catch(() => null));
    });
  }
  await Promise.all(tasks);
  clearCookieCache();
}

export function hasNeteaseLogin(cookieHeader) {
  const obj = parseCookieString(cookieHeader);
  return !!(obj.MUSIC_U || obj.MUSIC_A || obj.__csrf);
}

export function qqCookieObject(cookieHeader) {
  return parseCookieString(cookieHeader);
}

export function qqCookiePlaybackKey(cookieHeader) {
  const obj = parseCookieString(cookieHeader);
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
}

export function qqCookieMusicKey(cookieHeader) {
  const obj = parseCookieString(cookieHeader);
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey
    || obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
}

function normalizeQQUin(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || digits;
}

function decodeQQCookieValue(value) {
  try {
    return decodeURIComponent(String(value || '').replace(/\+/g, '%20')).trim();
  } catch (_) {
    return String(value || '').trim();
  }
}

export function qqCookieUin(cookieHeader) {
  const obj = parseCookieString(cookieHeader);
  const raw = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin)
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin);
  return normalizeQQUin(raw);
}

export function qqCookieNickname(cookieHeader, uin) {
  const obj = parseCookieString(cookieHeader);
  uin = normalizeQQUin(uin || qqCookieUin(cookieHeader));
  const padded = uin ? `0${uin}` : '';
  const keys = [
    uin && `ptnick_${uin}`,
    padded && `ptnick_${padded}`,
    'ptnick',
    'nick',
    'nickname',
    'qq_nickname',
  ].filter(Boolean);
  for (const key of keys) {
    if (obj[key]) {
      const nick = decodeQQCookieValue(obj[key]);
      if (nick) return nick;
    }
  }
  const nickKey = Object.keys(obj).find((k) => /^ptnick_/i.test(k) && obj[k]);
  return nickKey ? decodeQQCookieValue(obj[nickKey]) : (uin ? `QQ ${uin}` : '');
}

export function qqCookieAvatar(cookieHeader, uin) {
  const obj = parseCookieString(cookieHeader);
  const direct = obj.qqmusic_avatar || obj.avatar || obj.avatarUrl || obj.headpic || '';
  if (direct) return decodeQQCookieValue(direct);
  uin = normalizeQQUin(uin || qqCookieUin(cookieHeader));
  return uin ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=100` : '';
}

function decodeKGUnicodeEscapes(value) {
  return String(value || '').replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeKGCookieValue(value) {
  value = String(value || '').trim();
  if (!value) return '';
  if (/%u[0-9a-fA-F]{4}/.test(value)) value = decodeKGUnicodeEscapes(value);
  try {
    return decodeURIComponent(value.replace(/\+/g, '%20')).trim();
  } catch (_) {
    return value.trim();
  }
}

function expandKGCookieObject(obj) {
  obj = Object.assign({}, obj || {});
  for (const key of ['KuGoo', 'Kugoo', 'KGLogin', 'kguser']) {
    let raw = obj[key];
    if (!raw) continue;
    try { raw = decodeURIComponent(String(raw).replace(/\+/g, '%20')); } catch (_) { raw = String(raw); }
    const kuGooFields = {};
    String(raw).split('&').forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx <= 0) return;
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k) kuGooFields[k] = v;
    });
    const overrideKeys = [
      'KugooID', 'userid', 'kugouid', 't', 't1', 'token', 'KToken', 'KugooPwd', 'NickName', 'Pic', 'UserName',
      'vip_type', 'VIPType', 'VipType', 'vip_token', 'VipToken', 'VIPToken', 'viptoken',
      'MusicPack', 'musicpack', 'is_vip', 'IsVIP', 'isVIP', 'su_vip', 'm_type', 'y_type', 'music_vip',
      'VipLevel', 'vip_level', 'vip_endtime', 'vip_end_time',
    ];
    overrideKeys.forEach((k) => {
      if (kuGooFields[k]) obj[k] = kuGooFields[k];
    });
    Object.entries(kuGooFields).forEach(([k, v]) => {
      if (obj[k] == null || obj[k] === '') obj[k] = v;
    });
  }
  return obj;
}

export function parseKGCookieObject(cookieHeader) {
  return expandKGCookieObject(parseCookieString(cookieHeader));
}

export function kgCookieUserId(cookieHeader) {
  const obj = parseKGCookieObject(cookieHeader);
  return String(obj.KugooID || obj.userid || obj.kugouid || '').trim();
}

export function kgCookieToken(cookieHeader) {
  // Prefer trailing standalone token/t cookies (enrichKGCookieHeader appends appToken last).
  // Otherwise KuGoo blob fields would overwrite the android token and cause error 20017.
  const parts = String(cookieHeader || '').split(';');
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].trim();
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if ((key === 'token' || key === 't' || key === 'KToken') && value) return value;
  }
  const obj = parseKGCookieObject(cookieHeader);
  return String(obj.t || obj.token || obj.KToken || obj.kg_token || '').trim();
}

/** Always read web session token from KuGoo blob (ignore appended android appToken). */
export function kgCookieWebToken(cookieHeader) {
  const obj = parseKGCookieObject(cookieHeader);
  return String(obj.t || obj.token || obj.KToken || obj.kg_token || '').trim();
}

export function kgCookieVipType(cookieHeader) {
  const obj = parseKGCookieObject(cookieHeader);
  const direct = Number(
    obj.vip_type || obj.VIPType || obj.VipType || obj.vipType || obj.musicvip ||
    obj.MusicPack || obj.musicpack || obj.VipLevel || obj.vip_level || 0,
  ) || 0;
  if (direct > 0) return direct;
  if (Number(obj.su_vip) > 0) return 33;
  if (Number(obj.m_type) > 0) return 3;
  if (Number(obj.y_type) > 0 || Number(obj.music_vip) > 0) return 6;
  if (String(obj.vip_token || obj.vipToken || '').trim()) return 6;
  if (Number(obj.is_vip) === 1 || Number(obj.IsVIP) === 1 || Number(obj.isVIP) === 1 || Number(obj.MusicPack) === 1) return 6;
  const vipEndRaw = obj.vip_endtime || obj.vip_end_time || '';
  if (vipEndRaw) {
    const endMs = Date.parse(String(vipEndRaw).replace(/-/g, '/'));
    if (Number.isFinite(endMs) && endMs > Date.now()) return 6;
  }
  return 0;
}

export function kgCookieHasVipSession(cookieHeader) {
  return kgCookieVipType(cookieHeader) > 0 || !!kgCookieVipToken(cookieHeader);
}

export function analyzeKGCookieSession(cookieHeader) {
  const obj = parseKGCookieObject(cookieHeader || '');
  const userId = kgCookieUserId(cookieHeader);
  const token = kgCookieToken(cookieHeader);
  const sessionKeys = ['KuGoo', 'Kugoo', 'userid', 'KugooID', 'token', 't', 'vip_token', 'vip_type', 'dfid', 'kg_mid'];
  const foundSessionKeys = sessionKeys.filter((key) => {
    const value = obj[key];
    return value != null && String(value).trim() !== '';
  });
  const hasKuGoo = !!(obj.KuGoo || obj.Kugoo);
  return {
    loggedIn: !!(userId && token),
    userId: userId || '',
    hasKuGoo,
    hasToken: !!token,
    hasVipToken: !!kgCookieVipToken(cookieHeader),
    foundSessionKeys,
    trackingOnly: foundSessionKeys.length === 0 && Object.keys(obj).length > 0,
  };
}

export function kgCookieLoginPwd(cookieHeader) {
  const obj = parseKGCookieObject(cookieHeader);
  return String(obj.KugooPwd || obj.kugoo_pwd || obj.pwd || '').trim();
}

export function kgCookieVipToken(cookieHeader) {
  const obj = parseKGCookieObject(cookieHeader);
  return String(
    obj.vip_token || obj.vipToken || obj.VipToken || obj.VIPToken || obj.viptoken || obj.vip_key || '',
  ).trim();
}

export function kgCookieDfid(cookieHeader) {
  const obj = parseKGCookieObject(cookieHeader);
  return String(obj.dfid || obj.DFID || '-').trim() || '-';
}

export function kgCookieNickname(cookieHeader) {
  const obj = parseKGCookieObject(cookieHeader);
  return decodeKGCookieValue(obj.NickName || obj.nickname || obj.username || obj.uname || obj.UserName || '');
}

export function kgCookieAvatar(cookieHeader) {
  const obj = parseKGCookieObject(cookieHeader);
  let url = decodeKGCookieValue(obj.pic || obj.Pic || obj.user_pic || obj.avatar || obj.headpic || obj.userpic || '');
  if (url && url.startsWith('//')) url = 'http:' + url;
  return url;
}

export async function getNeteaseMusicU() {
  try {
    const item = await chrome.cookies.get({ url: 'https://music.163.com/', name: 'MUSIC_U' });
    return item && item.value ? item.value : '';
  } catch (_) {
    return '';
  }
}

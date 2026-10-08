import CryptoJS from '../vendor/crypto-es.mjs';
import { parseCookieString, getNeteaseMusicU } from './cookies.js';

const EAPI_KEY = 'e82ckenh8dichen8';
const EAPI_BASE = 'https://interface.music.163.com';
export const EAPI_UA = 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)';

const EAPI_COOKIE_KEYS = [
  'MUSIC_U',
  'MUSIC_A',
  '__csrf',
  'NMTID',
  'WNMCID',
  'WEVNSM',
  '_ntes_nuid',
  '_ntes_nnid',
  'MUSIC_R_U',
  'deviceId',
  'sDeviceId',
  'WM_TID',
  'WM_NI',
  'WM_NIKE',
];

function eapiEncrypt(url, object) {
  const text = typeof object === 'object' ? JSON.stringify(object) : String(object || '');
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = CryptoJS.MD5(message).toString();
  const payload = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(payload),
    CryptoJS.enc.Utf8.parse(EAPI_KEY),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  );
  return { params: encrypted.ciphertext.toString().toUpperCase() };
}

function safeDecodeCookieValue(value) {
  const raw = String(value || '');
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return raw;
  }
}

function encodeCookiePair(key, value) {
  return `${encodeURIComponent(key)}=${encodeURIComponent(safeDecodeCookieValue(value))}`;
}

/** eapi 的 deviceId 必须跨请求稳定：每次都换一个，风控会把请求判成「环境异常」（8821）。 */
const EAPI_DEVICE_ID_KEY = 'neteaseDeviceId';

async function getEapiDeviceId(parsed) {
  const fromCookie = String(parsed.deviceId || '').trim();
  if (fromCookie) return fromCookie;
  try {
    const stored = await chrome.storage.local.get([EAPI_DEVICE_ID_KEY]);
    const existing = String(stored?.[EAPI_DEVICE_ID_KEY] || '').trim();
    if (existing) return existing;
  } catch (_) {}
  let created = '';
  for (let index = 0; index < 16; index += 1) {
    created += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36));
  }
  try { await chrome.storage.local.set({ [EAPI_DEVICE_ID_KEY]: created }); } catch (_) {}
  return created;
}

/**
 * 官方客户端的 eapi body 里带一个 header 块（deviceId / appver / requestId …）。
 * 之前只把设备信息塞进 Cookie、body 里没有 header，服务端会按「非官方客户端」判风控，
 * 登录接口直接回 8821「环境异常」。这里按官方客户端的字段补上。
 */
async function buildEapiBodyHeader(parsed) {
  const header = {
    osver: parsed.osver || '16.2',
    deviceId: await getEapiDeviceId(parsed),
    appver: parsed.appver || '9.0.90',
    versioncode: parsed.versioncode || '140',
    mobilename: parsed.mobilename || '',
    buildver: parsed.buildver || String(Date.now()).slice(0, 10),
    resolution: parsed.resolution || '1920x1080',
    __csrf: parsed.__csrf || '',
    os: parsed.os || 'ios',
    channel: parsed.channel || 'distribution',
    requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
  };
  if (parsed.MUSIC_U) header.MUSIC_U = parsed.MUSIC_U;
  if (parsed.MUSIC_A) header.MUSIC_A = parsed.MUSIC_A;
  return header;
}

async function resolveEapiCookieMap(cookieHeader) {
  const parsed = parseCookieString(cookieHeader);
  if (!parsed.MUSIC_U) {
    const musicU = await getNeteaseMusicU();
    if (musicU) parsed.MUSIC_U = musicU;
  }
  return parsed;
}

async function formatEapiCookieHeader(parsed) {
  const header = {
    osver: parsed.osver || '16.2',
    os: parsed.os || 'ios',
    appver: parsed.appver || '9.0.90',
    versioncode: parsed.versioncode || '140',
    channel: parsed.channel || 'distribution',
  };
  EAPI_COOKIE_KEYS.forEach((key) => {
    if (parsed[key]) header[key] = parsed[key];
  });
  return Object.entries(header)
    .filter(([, value]) => value != null && String(value) !== '')
    .map(([key, value]) => encodeCookiePair(key, value))
    .join('; ');
}

export async function buildEapiCookieHeader(cookieHeader) {
  return formatEapiCookieHeader(await resolveEapiCookieMap(cookieHeader));
}

export async function eapiRequest(path, data, cookieHeader) {
  const uri = path.startsWith('/api/') ? path : `/api/${path.replace(/^\//, '')}`;
  const apiPath = uri.slice(5);
  const parsedCookies = await resolveEapiCookieMap(cookieHeader);
  const requestBody = Object.assign({}, data || {}, {
    header: await buildEapiBodyHeader(parsedCookies),
  });
  const encrypted = eapiEncrypt(uri, requestBody);
  const resp = await fetch(`${EAPI_BASE}/eapi/${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': EAPI_UA,
      Cookie: await formatEapiCookieHeader(parsedCookies),
    },
    body: new URLSearchParams(encrypted).toString(),
    credentials: 'include',
  });
  let body = {};
  try {
    body = await resp.json();
  } catch (_) {
    body = {};
  }
  let setCookies = [];
  try {
    if (resp.headers && typeof resp.headers.getSetCookie === 'function') {
      setCookies = resp.headers.getSetCookie() || [];
    }
  } catch (_) {}
  return { status: resp.status, body, setCookies };
}

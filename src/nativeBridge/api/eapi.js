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

export async function buildEapiCookieHeader(cookieHeader) {
  const parsed = parseCookieString(cookieHeader);
  if (!parsed.MUSIC_U) {
    const musicU = await getNeteaseMusicU();
    if (musicU) parsed.MUSIC_U = musicU;
  }
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

export async function eapiRequest(path, data, cookieHeader) {
  const uri = path.startsWith('/api/') ? path : `/api/${path.replace(/^\//, '')}`;
  const apiPath = uri.slice(5);
  const encrypted = eapiEncrypt(uri, data || {});
  const resp = await fetch(`${EAPI_BASE}/eapi/${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': EAPI_UA,
      Cookie: await buildEapiCookieHeader(cookieHeader),
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

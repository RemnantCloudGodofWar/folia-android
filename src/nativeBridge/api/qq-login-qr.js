/**
 * QQ Music QR login — port of sansenjian/qq-music-api
 * Docs: https://sansenjian.github.io/qq-music-api/api/user.html
 *
 * Flow:
 *  1. GET  ptqrshow  → qrsig + qr image + ptqrtoken(=hash33(qrsig))
 *  2. GET  ptqrlogin → wait / scanned / success(+checkSigUrl)
 *  3. GET  checkSigUrl (manual) → p_skey
 *  4. POST graph.qq.com/oauth2.0/authorize → Location?code=
 *  5. POST u.y.qq.com musicu QQLogin → qm_keyst session cookies
 *
 * Extension fetch cannot send Cookie headers; we inject them via
 * declarativeNetRequest for the duration of each privileged request.
 */

import { UA } from './weapi.js';
import { clearCookieCache, setBrowserCookies } from './cookies.js';
import { noteQrLoginStep, resetQrLoginTrace } from './qrLoginTrace.js';

const QQ_PT_APPID = '716027609';
const QQ_PT_DAID = '383';
const QQ_PT_AID = '100497308';
const QQ_PT_U1 = 'https://graph.qq.com/oauth2.0/login_jump';
const QQ_AUTHORIZE_REDIRECT =
  'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/';

// 换票过程中的临时失败不该让前端停止轮询：扫码会话还在，下一次轮询往往就能走通。
// 回 801（waiting）让 UI 继续转，同时把真实原因留在诊断字段里。
const retryableCheckFailure = (message, error, extra = {}) => ({
  isOk: false,
  code: 801,
  refresh: false,
  message,
  error,
  provider: 'qq',
  status: 'wait',
  retryable: true,
  ...extra,
});

const DNR_COOKIE_RULE_ID = 917027609;
let dnrCookieSerial = 0;

export function hash33(qrsig) {
  let e = 0;
  const t = String(qrsig || '');
  for (let n = 0, o = t.length; n < o; n += 1) e += (e << 5) + t.charCodeAt(n);
  return 2147483647 & e;
}

function getGtk(pSkey) {
  const str = String(pSkey || '');
  let hash = 5381;
  for (let i = 0, len = str.length; i < len; i += 1) {
    hash += (hash << 5) + str.charCodeAt(i);
  }
  return hash & 2147483647;
}

function getGuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }).toUpperCase();
}

function parseSetCookieRaw(setCookieHeader) {
  if (!setCookieHeader) return [];
  if (Array.isArray(setCookieHeader)) {
    return setCookieHeader
      .map((part) => String(part || '').split(';')[0].trim())
      .filter((pair) => pair.includes('=') && pair.split('=')[1]);
  }
  const cookies = [];
  const parts = String(setCookieHeader).split(/,(?=\s*[a-zA-Z_][\w-]*=)/);
  for (const part of parts) {
    const cookiePair = part.split(';')[0].trim();
    if (cookiePair && cookiePair.includes('=') && cookiePair.split('=')[1]) cookies.push(cookiePair);
  }
  return cookies;
}

function collectSetCookies(resp) {
  const list = [];
  try {
    if (resp && resp.headers && typeof resp.headers.getSetCookie === 'function') {
      list.push(...parseSetCookieRaw(resp.headers.getSetCookie()));
      return list;
    }
  } catch (_) {}
  try {
    list.push(...parseSetCookieRaw(resp && resp.headers && resp.headers.get('Set-Cookie')));
  } catch (_) {}
  return list;
}

function cookiePairsToHeader(pairs) {
  return (pairs || []).filter(Boolean).join('; ');
}

function cookiePairsToObject(pairs) {
  const obj = {};
  (pairs || []).forEach((pair) => {
    const eq = String(pair).indexOf('=');
    if (eq <= 0) return;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key && value) obj[key] = value;
  });
  return obj;
}

// The browser extension injects cookies with declarativeNetRequest. The Android
// bridge stubs that API out, so there the header has to be handed to fetch
// directly. Reading the jar per URL also picks up whatever the origin stored
// during the previous hop.
async function readJarCookiePairs(url) {
  try {
    const items = await chrome.cookies.getAll({ url });
    return (items || [])
      .filter((item) => item && item.name && item.value)
      .map((item) => `${item.name}=${item.value}`);
  } catch (_) {
    return [];
  }
}

// chrome.cookies.get 是按域名查找，能读到跳转响应写入、但当前 URL 取不到的 cookie。
async function readJarCookieValue(url, name) {
  try {
    const item = await chrome.cookies.get({ url, name });
    return item && item.value ? item.value : '';
  } catch (_) {
    return '';
  }
}

function mergeCookieHeader(...headers) {
  const merged = new Map();
  for (const header of headers) {
    for (const pair of String(header || '').split(';')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name && value) merged.set(name, value);
    }
  }
  return Array.from(merged, ([name, value]) => `${name}=${value}`).join('; ');
}

async function buildRequestCookieHeader(url, pairs) {
  return mergeCookieHeader(
    cookiePairsToHeader(pairs),
    cookiePairsToHeader(await readJarCookiePairs(url)),
  );
}

function mergeCookiePairs(map, pairs) {
  for (const pair of pairs || []) {
    const eq = String(pair).indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (name) map.set(name, pair.trim());
  }
  return map;
}

function buildLoginSession(cookie) {
  const cookieList = String(cookie || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
  const cookieObject = cookiePairsToObject(cookieList);
  const loginUin = cookieObject.uin || cookieObject.p_uin || '';
  return {
    loginUin,
    uin: loginUin,
    cookie: cookieList.join('; '),
    cookieList,
    cookieObject,
  };
}

async function withInjectedCookie(cookieHeader, urlFilters, run) {
  const cookie = String(cookieHeader || '').trim();
  const filters = (urlFilters || []).filter(Boolean);
  if (!cookie || !filters.length || !chrome.declarativeNetRequest?.updateSessionRules) {
    return run();
  }
  dnrCookieSerial = (dnrCookieSerial + 1) % 1000;
  const baseId = DNR_COOKIE_RULE_ID + dnrCookieSerial * 10;
  const ruleIds = filters.map((_, i) => baseId + i);
  const addRules = filters.map((urlFilter, i) => ({
    id: ruleIds[i],
    priority: 100,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'cookie', operation: 'set', value: cookie }],
    },
    condition: {
      urlFilter,
      resourceTypes: ['xmlhttprequest', 'other'],
    },
  }));
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: ruleIds,
      addRules,
    });
  } catch (err) {
    console.warn('[Mineradio Bridge] QQ cookie DNR inject failed', err);
    return run();
  }
  try {
    return await run();
  } finally {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds, addRules: [] });
    } catch (_) {}
  }
}

async function fetchWithTimeout(input, init = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function writeSessionCookies(session) {
  const raw = (session && session.cookie) || '';
  if (!raw) return;
  await setBrowserCookies('https://y.qq.com/', raw);
  await setBrowserCookies('https://qq.com/', raw);
  await setBrowserCookies('https://graph.qq.com/', raw);
  clearCookieCache();
}

/** GET /user/getQQLoginQr equivalent */
export async function qqGetLoginQr() {
  resetQrLoginTrace();
  noteQrLoginStep('qr:create:start');
  const u = new URL('https://ssl.ptlogin2.qq.com/ptqrshow');
  u.searchParams.set('appid', QQ_PT_APPID);
  u.searchParams.set('e', '2');
  u.searchParams.set('l', 'M');
  u.searchParams.set('s', '3');
  u.searchParams.set('d', '72');
  u.searchParams.set('v', '4');
  u.searchParams.set('t', String(Math.random()));
  u.searchParams.set('daid', QQ_PT_DAID);
  u.searchParams.set('pt_3rd_aid', QQ_PT_AID);
  u.searchParams.set('u1', QQ_PT_U1);

  const response = await fetchWithTimeout(u.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'User-Agent': UA,
      Referer: 'https://xui.ptlogin2.qq.com/',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    noteQrLoginStep('qr:create:http', { status: response.status });
    throw new Error('Failed to fetch QQ login QR');
  }

  const pairs = collectSetCookies(response);
  let qrsig = '';
  for (const pair of pairs) {
    if (pair.startsWith('qrsig=')) {
      qrsig = pair.slice('qrsig='.length);
      break;
    }
  }
  if (!qrsig) {
    // Fallback: cookie jar (credentials:include may have stored it)
    try {
      const item = await chrome.cookies.get({ url: 'https://ssl.ptlogin2.qq.com/', name: 'qrsig' });
      if (item && item.value) qrsig = item.value;
    } catch (_) {}
  }
  if (!qrsig) throw new Error('Failed to get qrsig from response');
  noteQrLoginStep('qr:create:ok', { status: response.status, setCookieCount: pairs.length });

  // Keep qrsig in Chrome jar for credentials:include fallback
  try {
    await chrome.cookies.set({
      url: 'https://ssl.ptlogin2.qq.com/',
      name: 'qrsig',
      value: qrsig,
      path: '/',
      secure: true,
    });
  } catch (_) {}

  const buf = await response.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const img = `data:image/png;base64,${btoa(binary)}`;
  const ptqrtoken = String(hash33(qrsig));

  return {
    // sansenjian shape
    img,
    qrsig,
    ptqrtoken,
    // Bridge-compatible aliases
    provider: 'qq',
    qrimg: img,
  };
}

/** POST /user/checkQQLoginQr equivalent */
export async function qqCheckLoginQr(params = {}) {
  const qrsig = String(params.qrsig || '').trim();
  let ptqrtoken = String(params.ptqrtoken || '').trim();
  if (!qrsig) {
    return { isOk: false, code: 65, refresh: true, message: '参数错误：缺少 qrsig', provider: 'qq' };
  }
  if (!ptqrtoken) ptqrtoken = String(hash33(qrsig));

  const cookieMap = new Map();
  cookieMap.set('qrsig', `qrsig=${qrsig}`);

  const pollUrl = new URL('https://ssl.ptlogin2.qq.com/ptqrlogin');
  pollUrl.searchParams.set('u1', QQ_PT_U1);
  pollUrl.searchParams.set('ptqrtoken', ptqrtoken);
  pollUrl.searchParams.set('ptredirect', '0');
  pollUrl.searchParams.set('h', '1');
  pollUrl.searchParams.set('t', '1');
  pollUrl.searchParams.set('g', '1');
  pollUrl.searchParams.set('from_ui', '1');
  pollUrl.searchParams.set('ptlang', '2052');
  pollUrl.searchParams.set('action', `0-0-${Date.now()}`);
  pollUrl.searchParams.set('js_ver', '23111510');
  pollUrl.searchParams.set('js_type', '1');
  pollUrl.searchParams.set('login_sig', '');
  pollUrl.searchParams.set('pt_uistyle', '40');
  pollUrl.searchParams.set('aid', QQ_PT_APPID);
  pollUrl.searchParams.set('daid', QQ_PT_DAID);
  pollUrl.searchParams.set('pt_3rd_aid', QQ_PT_AID);

  const runPoll = async () => {
    const cookieHeader = await buildRequestCookieHeader(pollUrl.toString(), Array.from(cookieMap.values()));
    const res = await withInjectedCookie(cookieHeader, ['||ssl.ptlogin2.qq.com'], () =>
      fetchWithTimeout(pollUrl.toString(), {
        method: 'GET',
        credentials: 'include',
        headers: {
          'User-Agent': UA,
          Referer: 'https://xui.ptlogin2.qq.com/',
          Accept: '*/*',
          Cookie: cookieHeader,
        },
      }),
    );
    return { res, body: (await res.text()) || '' };
  };

  let response;
  let data = '';
  try {
    ({ res: response, body: data } = await runPoll());
    // Tencent answers an unidentified poll with an empty 403. Retrying once with
    // a freshly read cookie jar recovers when the first write had not landed.
    if (response.status === 403 || (response.status >= 400 && !String(data).trim())) {
      noteQrLoginStep('qr:poll:forbidden-retry', { status: response.status });
      await writeSessionCookies({ cookie: cookiePairsToHeader(Array.from(cookieMap.values())) });
      const retry = await runPoll();
      response = retry.res;
      data = retry.body;
    }
  } catch (err) {
    noteQrLoginStep('qr:poll:exception', { name: err?.name || 'Error', message: err?.message || String(err) });
    if (err && err.name === 'AbortError') {
      return { isOk: false, code: 0, message: '登录检查超时', error: '登录检查超时', provider: 'qq' };
    }
    return {
      isOk: false,
      code: 0,
      message: (err && err.message) || '登录检查失败',
      error: (err && err.message) || '登录检查失败',
      provider: 'qq',
    };
  }

  const pollSetCookies = collectSetCookies(response);
  mergeCookiePairs(cookieMap, pollSetCookies);

  const refresh = /已失效|已过期/.test(data) && !/未失效/.test(data);
  const scanned = /二维码认证中|扫描成功|已扫描/.test(data);
  const waiting = /二维码未失效|等待扫码|未失效/.test(data);
  const success = /登录成功|登陆成功/.test(data);
  const responseHead = String(data).replace(/\s+/g, ' ').trim().slice(0, 80);
  noteQrLoginStep('qr:poll', {
    status: response.status,
    scanned,
    success,
    refresh,
    waiting,
    body: responseHead,
    setCookieCount: pollSetCookies.length,
  });

  if (!success) {
    if (refresh) {
      return { isOk: false, code: 65, refresh: true, message: '二维码已失效', provider: 'qq', status: 'expired' };
    }
    if (scanned) {
      return { isOk: false, code: 67, refresh: false, message: '已扫码，请在手机确认', provider: 'qq', status: 'scanned' };
    }
    return {
      isOk: false,
      code: waiting ? 66 : 66,
      refresh: false,
      message: waiting ? '请用手机 QQ 扫码' : '未扫描二维码',
      provider: 'qq',
      status: 'wait',
      raw: data.slice(0, 160),
    };
  }

  // Extract the check_sig URL. qq-music-api matches the quoted form; the bare
  // form is accepted as a fallback because the response markup does vary.
  const quotedUrlMatch = data.match(/(?:'((?:https?|ftp):\/\/[^\s/$.?#].[^\s]*)')/g);
  const bareUrlMatch = data.match(/https?:\/\/(?:ptlogin2|ssl\.ptlogin2)\.qq\.com\/[^\s'"]+/);
  const rawCheckSigUrl = quotedUrlMatch && quotedUrlMatch[0]
    ? quotedUrlMatch[0].replace(/'/g, '')
    : (bareUrlMatch && bareUrlMatch[0]) || '';
  if (!rawCheckSigUrl) {
    noteQrLoginStep('qr:check-sig:missing-url', { body: responseHead });
    return retryableCheckFailure('登录检查失败：未拿到 checkSigUrl', '提取不到 checkSigUrl');
  }
  const checkSigUrl = rawCheckSigUrl.replace(/[;,'"]+$/, '');

  let checkSigRes;
  let checkSigFinalUrl = checkSigUrl;
  try {
    const checkSigCookieHeader = await buildRequestCookieHeader(checkSigUrl, Array.from(cookieMap.values()));
    checkSigRes = await withInjectedCookie(
      checkSigCookieHeader,
      ['||ptlogin2.qq.com', '||qq.com'],
      () =>
        fetchWithTimeout(
          checkSigUrl,
          {
            method: 'GET',
            redirect: 'manual',
            credentials: 'include',
            headers: {
              'User-Agent': UA,
              Referer: 'https://xui.ptlogin2.qq.com/',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              Cookie: checkSigCookieHeader,
            },
          },
          12000,
        ),
    );
    // check_sig 通常回 302，p_skey 写在跳转目标上。手动跟一层，
    // 否则既读不到 Set-Cookie，也拿不到最终的登录态。
    if (checkSigRes.status >= 300 && checkSigRes.status < 400) {
      const redirectTarget = checkSigRes.headers.get('Location') || checkSigRes.headers.get('location') || '';
      if (redirectTarget) {
        const resolvedTarget = new URL(redirectTarget, checkSigUrl).toString();
        noteQrLoginStep('qr:check-sig:redirect', {
          toHost: (() => {
            try {
              return new URL(resolvedTarget).host;
            } catch {
              return '';
            }
          })(),
        });
        try {
          const followCookieHeader = await buildRequestCookieHeader(
            resolvedTarget,
            Array.from(cookieMap.values()),
          );
          const followed = await fetchWithTimeout(
            resolvedTarget,
            {
              method: 'GET',
              credentials: 'include',
              headers: {
                'User-Agent': UA,
                Referer: checkSigUrl,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                Cookie: followCookieHeader,
              },
            },
            12000,
          );
          mergeCookiePairs(cookieMap, collectSetCookies(followed));
          checkSigRes = followed;
          checkSigFinalUrl = resolvedTarget;
        } catch (_) {}
      }
    }
  } catch (err) {
    noteQrLoginStep('qr:check-sig:exception', { message: err?.message || String(err) });
    return retryableCheckFailure(
      (err && err.message) || '登录检查失败',
      'check_sig 请求失败',
    );
  }

  const checkSigCookies = collectSetCookies(checkSigRes);
  mergeCookiePairs(cookieMap, checkSigCookies);
  // The jar may hold cookies the response headers do not expose (the native
  // bridge hides Set-Cookie from JS), so read it back for the final URL too.
  const checkSigJarPairs = await readJarCookiePairs(checkSigFinalUrl);
  mergeCookiePairs(cookieMap, checkSigJarPairs);
  noteQrLoginStep('qr:check-sig', {
    status: checkSigRes.status,
    setCookieCount: checkSigCookies.length,
    jarCookieCount: checkSigJarPairs.length,
  });
  const checkSigCookieHeader = cookiePairsToHeader(checkSigCookies);
  const jarPSkey = await readJarCookieValue(checkSigFinalUrl, 'p_skey');
  const pSkeyMatch = checkSigCookieHeader.match(/p_skey=([^;]+)/)
    || cookiePairsToHeader(Array.from(cookieMap.values())).match(/p_skey=([^;]+)/)
    || (jarPSkey ? [null, jarPSkey] : null);
  if (!pSkeyMatch || !pSkeyMatch[1]) {
    noteQrLoginStep('qr:check-sig:no-p-skey', { cookieCount: checkSigCookies.length });
    return retryableCheckFailure('登录检查失败：缺少 p_skey', '提取不到 p_skey');
  }
  const pSkey = pSkeyMatch[1];
  const gtk = getGtk(pSkey);

  // FormData would be serialized as a multipart blob and the native bridge
  // forwards it as base64, so the server saw no parameters at all (error
  // 100001 with an empty client_id). graph.qq.com accepts ordinary
  // form-urlencoded bodies, which the bridge passes through as text.
  const form = new URLSearchParams();
  form.append('response_type', 'code');
  form.append('client_id', QQ_PT_AID);
  form.append('redirect_uri', QQ_AUTHORIZE_REDIRECT);
  form.append('scope', 'get_user_info,get_app_friends');
  form.append('state', 'state');
  form.append('switch', '');
  form.append('from_ptlogin', '1');
  form.append('src', '1');
  form.append('update_auth', '1');
  form.append('openapi', '1010_1030');
  form.append('g_tk', String(gtk));
  form.append('auth_time', String(Date.now()));
  form.append('ui', getGuid());

  let authorizeRes;
  try {
    const authorizeCookieHeader = await buildRequestCookieHeader(
      'https://graph.qq.com/oauth2.0/authorize',
      Array.from(cookieMap.values()),
    );
    authorizeRes = await withInjectedCookie(
      authorizeCookieHeader,
      ['||graph.qq.com'],
      () =>
        fetchWithTimeout(
          'https://graph.qq.com/oauth2.0/authorize',
          {
            method: 'POST',
            redirect: 'manual',
            credentials: 'include',
            headers: {
              'User-Agent': UA,
              Referer: 'https://graph.qq.com/',
              Origin: 'https://graph.qq.com',
              Cookie: authorizeCookieHeader,
            },
            body: form,
          },
          12000,
        ),
    );
  } catch (err) {
    noteQrLoginStep('qr:authorize:exception', { message: err?.message || String(err) });
    return retryableCheckFailure(
      (err && err.message) || '授权请求失败',
      '授权响应异常',
    );
  }
  mergeCookiePairs(cookieMap, collectSetCookies(authorizeRes));
  let location = authorizeRes.headers.get('Location') || authorizeRes.headers.get('location') || '';
  noteQrLoginStep('qr:authorize:first', {
    status: authorizeRes.status,
    location: String(location).slice(0, 200),
  });

  // 授权码可能在后续几次跳转里，Location 本身不带 code 时要继续追。
  let authorizeRedirectHops = 0;
  while (
    authorizeRes.status >= 300
    && authorizeRes.status < 400
    && location
    && !/[?&]code=/.test(String(location))
    && authorizeRedirectHops < 4
  ) {
    authorizeRedirectHops += 1;
    let nextUrl;
    try {
      nextUrl = new URL(String(location), 'https://graph.qq.com/').toString();
    } catch (_) {
      break;
    }
    noteQrLoginStep('qr:authorize:hop', {
      hop: authorizeRedirectHops,
      toHost: new URL(nextUrl).host,
      location: String(location).slice(0, 160),
    });
    try {
      const hopCookieHeader = await buildRequestCookieHeader(nextUrl, Array.from(cookieMap.values()));
      const hopRes = await fetchWithTimeout(
        nextUrl,
        {
          method: 'GET',
          redirect: 'manual',
          credentials: 'include',
          headers: {
            'User-Agent': UA,
            Referer: 'https://graph.qq.com/',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Cookie: hopCookieHeader,
          },
        },
        12000,
      );
      mergeCookiePairs(cookieMap, collectSetCookies(hopRes));
      const mergedHopJar = await readJarCookiePairs(nextUrl);
      mergeCookiePairs(cookieMap, mergedHopJar);
      authorizeRes = hopRes;
      location = hopRes.headers.get('Location') || hopRes.headers.get('location') || '';
      noteQrLoginStep('qr:authorize:hop:result', {
        hop: authorizeRedirectHops,
        status: hopRes.status,
        hasLocation: Boolean(location),
        locationHost: (() => {
          try {
            return location ? new URL(String(location), nextUrl).host : '';
          } catch {
            return '';
          }
        })(),
        hasCode: /[?&]code=/.test(String(location)),
      });
      // 有些跳转把 code 放在响应体内，而不是 Location 上。
      if (!/[?&]code=/.test(String(location))) {
        try {
          const hopBody = await hopRes.clone().text();
          const bodyCode = hopBody.match(/[?&]code=([^&"'\s]+)/);
          if (bodyCode && bodyCode[1]) {
            location = `x?code=${bodyCode[1]}`;
            noteQrLoginStep('qr:authorize:code-in-body', { hop: authorizeRedirectHops });
          }
        } catch (_) {}
      }
    } catch (err) {
      noteQrLoginStep('qr:authorize:hop:exception', { hop: authorizeRedirectHops, message: err?.message || String(err) });
      break;
    }
  }

  let authorizeBodyHead = '';
  const authorizeOk = authorizeRes.status >= 300 && authorizeRes.status < 400 && Boolean(location);
  if (!authorizeOk) {
    try {
      authorizeBodyHead = String(await authorizeRes.clone().text()).replace(/\s+/g, ' ').trim().slice(0, 160);
    } catch (_) {}
  }
  noteQrLoginStep('qr:authorize', {
    status: authorizeRes.status,
    hasLocation: Boolean(location),
    hops: authorizeRedirectHops,
    locationHost: (() => {
      try {
        return new URL(String(location)).host;
      } catch {
        return '';
      }
    })(),
    hasCode: /[?&]code=/.test(String(location)),
    body: authorizeBodyHead || undefined,
  });
  if (authorizeBodyHead) {
    noteQrLoginStep('qr:authorize:body', { body: authorizeBodyHead });
  }
  if (!authorizeOk) {
    return retryableCheckFailure(
      '授权响应异常，未返回跳转地址',
      '授权响应异常，未返回跳转地址',
      { authorizeStatus: authorizeRes.status },
    );
  }
  const codeMatch = String(location).match(/[?&]code=([^&]+)/);
  if (!codeMatch || !codeMatch[1]) {
    return retryableCheckFailure(
      '授权跳转缺少 code',
      '授权跳转缺少 code',
      { location: String(location).slice(0, 200) },
    );
  }
  const code = decodeURIComponent(codeMatch[1]);

  const fcgBody = JSON.stringify({
    comm: { g_tk: gtk, platform: 'yqq', ct: 24, cv: 0 },
    req: {
      module: 'QQConnectLogin.LoginServer',
      method: 'QQLogin',
      param: { code },
    },
  });

  let loginRes;
  try {
    const musicuCookieHeader = await buildRequestCookieHeader(
      'https://u.y.qq.com/cgi-bin/musicu.fcg',
      Array.from(cookieMap.values()),
    );
    loginRes = await withInjectedCookie(
      musicuCookieHeader,
      ['||u.y.qq.com', '||y.qq.com'],
      () =>
        fetchWithTimeout(
          'https://u.y.qq.com/cgi-bin/musicu.fcg',
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'User-Agent': UA,
              Referer: 'https://y.qq.com/',
              'Content-Type': 'application/x-www-form-urlencoded',
              Origin: 'https://y.qq.com',
              Cookie: musicuCookieHeader,
            },
            body: fcgBody,
          },
          12000,
        ),
    );
  } catch (err) {
    noteQrLoginStep('qr:musicu:exception', { message: err?.message || String(err) });
    return retryableCheckFailure(
      (err && err.message) || 'QQLogin 失败',
      'QQLogin 失败',
    );
  }
  mergeCookiePairs(cookieMap, collectSetCookies(loginRes));
  noteQrLoginStep('qr:musicu', { status: loginRes.status, setCookieCount: collectSetCookies(loginRes).length });

  // Promote musicid/musickey from JSON body when Set-Cookie is sparse
  try {
    const json = await loginRes.clone().json();
    const dataNode = json && json.req && json.req.data;
    if (dataNode && typeof dataNode === 'object') {
      if (dataNode.musickey) cookieMap.set('qm_keyst', `qm_keyst=${dataNode.musickey}`);
      if (dataNode.qqmusic_key) cookieMap.set('qqmusic_key', `qqmusic_key=${dataNode.qqmusic_key}`);
      const id = String(dataNode.musicid || dataNode.uin || '').replace(/\D/g, '');
      if (id) cookieMap.set('uin', `uin=o${id}`);
    }
  } catch (_) {}

  const session = buildLoginSession(cookiePairsToHeader(Array.from(cookieMap.values())));
  noteQrLoginStep('qr:session', {
    hasMusicKey: Boolean(session.cookieObject.qm_keyst || session.cookieObject.qqmusic_key),
    hasUin: Boolean(session.cookieObject.uin || session.cookieObject.p_uin),
    cookieCount: session.cookieList.length,
  });
  if (!session.cookieObject.qm_keyst && !session.cookieObject.qqmusic_key) {
    return retryableCheckFailure(
      '登录成功但未拿到 qm_keyst',
      '登录成功但未拿到 qm_keyst',
      { session },
    );
  }

  await writeSessionCookies(session);
  noteQrLoginStep('qr:done:ok');

  return {
    // sansenjian shape
    isOk: true,
    message: '登录成功',
    session,
    // Bridge-compatible shape (UI / status)
    provider: 'qq',
    code: 0,
    status: 'ok',
    loggedIn: true,
    hasCookie: true,
    userId: String(session.uin || '').replace(/\D/g, ''),
    uin: String(session.uin || '').replace(/\D/g, ''),
    nickname: session.cookieObject.nick || session.cookieObject.nickname || `QQ ${String(session.uin || '').replace(/\D/g, '')}`,
  };
}

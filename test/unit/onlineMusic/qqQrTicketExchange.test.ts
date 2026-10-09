import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqQrTicketExchange.test.ts
// 「手机提示登录成功、应用毫无反应」的根因回归：扫码成功后换票失败曾一律返回 801（等待），
// 界面于是永远转圈。这里固定住新策略 —— 连续失败到上限必须变成终态错误并带上失败阶段。

const PTUI_SUCCESS =
    "ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?pttype=1&uin=2774749','0','登录成功', '')";

const fetchMock = vi.fn();
let checkSigCalls = 0;
/** cookie 罐的桩：两条通道共用 .qq.com 上的同一批 cookie，跨通道污染就是从这里来的。 */
let jarPairs: string[] = [];
/** 模拟「删不掉」的 cookie（域 cookie 用 host-only 删除够不着），用来验证响应头优先。 */
let stickyCookieNames: string[] = [];
/** chrome.storage.local 的桩：桥会把登录后的会话串存在这里（getQQCookie 的账号来源）。 */
let bridgeStorage: Record<string, string> = {};

const cookieEntry = (pair: string) => {
    const eq = pair.indexOf('=');
    return { name: pair.slice(0, eq), value: pair.slice(eq + 1), url: 'https://y.qq.com/' };
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
});

/** 扫码成功 → check_sig 给出 p_skey → authorize 给出 code → musicu 由参数决定是否给 musickey。 */
const stubTicketExchange = ({ musickey, musicid = '2774749' }: { musickey?: string; musicid?: string }) => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes('ptqrlogin')) return new Response(PTUI_SUCCESS, { status: 200 });
        if (url.includes('check_sig')) {
            checkSigCalls += 1;
            if (checkSigCalls === 1) {
                return new Response('', {
                    status: 302,
                    headers: {
                        location: 'https://ptlogin2.qq.com/check_sig_follow?uin=2774749',
                        'set-cookie': 'p_skey=test-p-skey; path=/',
                    },
                });
            }
            return new Response('', { status: 200 });
        }
        if (url.includes('oauth2.0/authorize')) {
            return new Response('', {
                status: 302,
                headers: { location: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&code=test-code' },
            });
        }
        if (url.includes('musicu.fcg')) {
            return jsonResponse({ req: { code: 0, data: musickey ? { musickey, musicid } : {} } });
        }
        return new Response('', { status: 404 });
    });
};

const stubBrowser = () => {
    vi.stubGlobal('chrome', {
        cookies: {
            getAll: async () => jarPairs.map(cookieEntry),
            get: async ({ name }: { name?: string } = {}) => (
                jarPairs.map(cookieEntry).find(entry => entry.name === name) ?? null
            ),
            set: async () => ({}),
            remove: async ({ name }: { name?: string } = {}) => {
                if (!stickyCookieNames.includes(String(name))) {
                    jarPairs = jarPairs.filter(pair => !pair.startsWith(`${name}=`));
                }
                return {};
            },
        },
        storage: {
            local: {
                get: async (keys: string | string[]) => {
                    const list = Array.isArray(keys) ? keys : [keys];
                    return Object.fromEntries(list
                        .filter(key => bridgeStorage[key] !== undefined)
                        .map(key => [key, bridgeStorage[key]]));
                },
                set: async (values: Record<string, string>) => {
                    Object.entries(values).forEach(([key, value]) => { bridgeStorage[key] = value; });
                },
            },
        },
    });
};

const loadBridge = async () => {
    const bridge = await import('@/nativeBridge/api/qq-login-qr.js');
    const trace = await import('@/nativeBridge/api/qrLoginTrace.js');
    return { bridge, trace };
};

/** 桥是 JS 模块，返回的是联合类型；这里只声明测试真正断言到的字段。 */
type QrCheckResult = {
    isOk?: boolean;
    status?: string;
    code?: number;
    retryable?: boolean;
    failureStage?: string;
    failureReason?: string;
    ticketExchangeAttempts?: number;
    loggedIn?: boolean;
    session?: { cookie?: string };
};

const checkOnce = async (): Promise<QrCheckResult> => {
    const { bridge } = await loadBridge();
    return await bridge.qqCheckLoginQr({ qrsig: 'test-qrsig', ptqrtoken: '1' }) as unknown as QrCheckResult;
};

beforeEach(() => {
    vi.resetModules();
    checkSigCalls = 0;
    jarPairs = [];
    stickyCookieNames = [];
    bridgeStorage = {};
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    stubBrowser();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('QQ QR ticket exchange after a confirmed scan', () => {
    it('turns repeated exchange failures into a terminal error instead of endless waiting', async () => {
        stubTicketExchange({});

        const attempts = [await checkOnce(), await checkOnce(), await checkOnce(), await checkOnce()];

        expect(attempts.slice(0, 3).map(result => result.status)).toEqual(['wait', 'wait', 'wait']);
        expect(attempts.slice(0, 3).every(result => result.code === 801 && result.retryable === true)).toBe(true);
        expect(attempts[0].failureStage).toBe('qq-ticket-exchange');

        const terminal = attempts[3];
        expect(terminal.status).toBe('error');
        expect(terminal.retryable).toBe(false);
        expect(terminal.code).toBe(0);
        expect(terminal.failureStage).toBe('qq-ticket-exchange');
        expect(terminal.ticketExchangeAttempts).toBe(4);

        const { trace } = await loadBridge();
        const lines = trace.getQrLoginTraceLines('qq');
        expect(lines.some(line => line.includes('qr:exchange:failed'))).toBe(true);
    });

    it('does not count a successful exchange as a failure', async () => {
        stubTicketExchange({ musickey: 'test-musickey' });

        const ok = await checkOnce();
        expect(ok.isOk).toBe(true);
        expect(ok.loggedIn).toBe(true);

        // 换成换票失败后，计数必须从第一次重新开始，而不是接着上一轮继续涨。
        stubTicketExchange({});
        const failure = await checkOnce();
        expect(failure.status).toBe('wait');
        expect(failure.ticketExchangeAttempts).toBe(1);
    });
});

// 复现路径：先微信扫码登录、退出、再 QQ 扫码。两条通道把 cookie 写在同一个 .qq.com 域上，
// 退出登录过去只清前端会话，罐里还留着微信的 uin / qm_keyst —— 换票过程会把它们当成自己的凭据。
const WECHAT_LEFTOVERS = [
    'uin=o8888888888',
    'qqmusic_uin=o8888888888',
    'qm_keyst=wechat-stale-key',
    'qqmusic_key=wechat-stale-key',
    'login_type=2',
    'tmeLoginType=1',
    'str_musicid=8888888888',
];

const cookieHeaders = (): string => fetchMock.mock.calls
    .map(([, init]) => (init as { headers?: Record<string, string> } | undefined)?.headers || {})
    .map(headers => Object.entries(headers)
        .filter(([name]) => name.toLowerCase() === 'cookie')
        .map(([, value]) => String(value))
        .join('; '))
    .join(' | ');

describe('QQ QR login after a WeChat session left cookies behind', () => {
    it('never lets the previous channel credentials become the new session', async () => {
        jarPairs = [...WECHAT_LEFTOVERS];
        stubTicketExchange({});

        const result = await checkOnce();

        // 罐里那把旧的 musickey 绝不能被当成本次登录的票据：没有新票据就必须失败。
        expect(result.isOk).toBeFalsy();
        expect(result.status).not.toBe('ok');
        const sessionCookie = String((result as { session?: { cookie?: string } }).session?.cookie || '');
        expect(sessionCookie).not.toContain('wechat-stale-key');
        expect(cookieHeaders()).not.toContain('qm_keyst=wechat-stale-key');
        expect(cookieHeaders()).not.toContain('uin=o8888888888');
    });

    it('writes a clean session from the fresh exchange only', async () => {
        const { bridge } = await loadBridge();
        jarPairs = [...WECHAT_LEFTOVERS];
        stubTicketExchange({ musickey: 'fresh-qq-key' });

        const result = await bridge.qqCheckLoginQr({ qrsig: 'test-qrsig', ptqrtoken: '1' }) as unknown as {
            isOk?: boolean;
            session?: { cookie?: string };
        };

        expect(result.isOk).toBe(true);
        expect(result.session?.cookie).toContain('qm_keyst=fresh-qq-key');
        // 账号必须是本次扫码的那个，而不是罐里剩下的微信账号。
        expect(result.session?.cookie).toContain('uin=o2774749');
        expect(result.session?.cookie).not.toContain('o8888888888');
        expect(result.session?.cookie).not.toContain('login_type=2');
        expect(result.session?.cookie).not.toContain('tmeLoginType=1');
    });

    it('clears the whole platform credential set on logout', async () => {
        jarPairs = [...WECHAT_LEFTOVERS, 'ptcz=transport-cookie'];
        const { bridge } = await loadBridge();

        await bridge.clearQQPlatformSessionCookies();

        const names = jarPairs.map(pair => pair.slice(0, pair.indexOf('=')));
        expect(names).not.toContain('uin');
        expect(names).not.toContain('qqmusic_uin');
        expect(names).not.toContain('qm_keyst');
        expect(names).not.toContain('qqmusic_key');
        expect(names).not.toContain('login_type');
        expect(names).not.toContain('tmeLoginType');
        expect(names).not.toContain('str_musicid');
        // 传输类 cookie（ptcz / RK 这类）不该被清掉，否则会把正常的反爬指纹也一起弄丢。
        expect(names).toContain('ptcz');
    });

    // 现场报告（0.7.15-android.59）：登录成功，但 login-status 读到的是 uinTail=…4168 的另一个账号，
    // 歌单只剩 1 首、头像和昵称全靠兜底。原因是罐里旧账号的 uin/wxuin 盖过了刚写下的会话。
    it('keeps the freshly stored session authoritative over leftover jar credentials', async () => {
        jarPairs = [
            'uin=o1234168',
            'wxuin=1234168',
            'qm_keyst=leftover-key',
            'login_type=2',
            'tmeLoginType=1',
            'ptcz=transport-cookie',
        ];
        stubTicketExchange({ musickey: 'fresh-qq-key' });
        const { bridge } = await loadBridge();
        const { handleQQLoginQrCheck } = await import('@/nativeBridge/api/qq.js');
        const { getQQCookie } = await import('@/nativeBridge/api/cookies.js');

        const result = await handleQQLoginQrCheck('test-qrsig', '1') as unknown as {
            isOk?: boolean;
            session?: { cookie?: string };
        };
        expect(result.isOk).toBe(true);
        // 会话必须标成 QQ 通道，并且只带本次扫码的账号。
        expect(result.session?.cookie).toContain('login_type=1');
        expect(result.session?.cookie).not.toContain('tmeLoginType');
        expect(result.session?.cookie).toContain('uin=o2774749');

        // 账号解析（login_status / 歌单 / 播放）用的头必须以刚存下的会话为准。
        const header = await getQQCookie();
        expect(header).toContain('uin=o2774749');
        expect(header).toContain('qm_keyst=fresh-qq-key');
        expect(header).not.toContain('o1234168');
        expect(header).not.toContain('leftover-key');
        // 传输类 cookie 仍然从罐里带上。
        expect(header).toContain('ptcz=transport-cookie');
    });

    // 现场报告（0.7.15-android.60）：扫的是 2774749，但 login-status 读到 uinTail=…9082，
    // 「我喜欢」只回来 1 首 —— musicid 被当成 uin 覆盖了会话里的 QQ 号。
    it('keeps the scanned QQ number as the session account when musicid differs', async () => {
        stubTicketExchange({ musickey: 'fresh-qq-key', musicid: '3379082' });

        const result = await checkOnce();

        expect(result.isOk).toBe(true);
        expect(result.session?.cookie).toContain('uin=o2774749');
        expect(result.session?.cookie).not.toContain('uin=o3379082');
        // musicid 仍然记下来，但它不是账号 id。
        expect(result.session?.cookie).toContain('str_musicid=3379082');
    });
});

// 现场证据（0.7.15-android.57 的报告）：qr:create:ok setCookieCount=0，随后第一次轮询就回
// ptuiCB('65')「二维码已失效」。原因是 Set-Cookie 在安卓桥里对 JS 不可见，qrsig 只能从 cookie 罐
// 回捞，而罐里可能是上一次扫码留下的旧值 —— 新码于是从未被服务端认过。
describe('QQ QR create must not pick up a previous session qrsig', () => {
    it('takes the fresh qrsig from the bridge-exposed Set-Cookie', async () => {
        // 旧 qrsig 删不掉（域 cookie 用 host-only 删除够不着），只能靠响应头里的新值。
        jarPairs = ['qrsig=stale-qrsig', 'uin=o8888888888'];
        stickyCookieNames = ['qrsig'];
        fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input instanceof Request ? input.url : input);
            if (url.includes('ptqrshow')) {
                return new Response(new Uint8Array([1, 2, 3]), {
                    status: 200,
                    headers: {
                        'content-type': 'image/png',
                        'x-folia-set-cookie': 'qrsig=fresh-qrsig; Path=/; Domain=qq.com',
                    },
                });
            }
            if (url.includes('ptqrlogin')) {
                return new Response("ptuiCB('66','0','','0','二维码未失效。', '')", { status: 200 });
            }
            return new Response('', { status: 404 });
        });

        const { bridge, trace } = await loadBridge();
        const created = await bridge.qqGetLoginQr() as unknown as { qrsig?: string; ptqrtoken?: string };

        expect(created.qrsig).toBe('fresh-qrsig');
        expect(created.ptqrtoken).toBe(String(bridge.hash33('fresh-qrsig')));

        const poll = await bridge.qqCheckLoginQr({
            qrsig: String(created.qrsig),
            ptqrtoken: String(created.ptqrtoken),
        }) as unknown as { status?: string };
        expect(poll.status).toBe('wait');
        // 轮询必须带新码；旧码只能留在罐里，不能进请求。
        expect(cookieHeaders()).toContain('qrsig=fresh-qrsig');
        expect(cookieHeaders()).not.toContain('qrsig=stale-qrsig');

        // 清理很快完成时不该在追踪里留下假的 timeout（计时器没清会误报）。
        const lines = trace.getQrLoginTraceLines('qq');
        expect(lines.some(line => line.includes('qr:clean-platform-cookies:timeout'))).toBe(false);
        expect(lines.some(line => line.includes('qr:create:ok'))).toBe(true);
    });
});

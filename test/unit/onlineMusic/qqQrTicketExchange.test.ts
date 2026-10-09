import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqQrTicketExchange.test.ts
// 「手机提示登录成功、应用毫无反应」的根因回归：扫码成功后换票失败曾一律返回 801（等待），
// 界面于是永远转圈。这里固定住新策略 —— 连续失败到上限必须变成终态错误并带上失败阶段。

const PTUI_SUCCESS =
    "ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?pttype=1&uin=2774749','0','登录成功', '')";

const fetchMock = vi.fn();
let checkSigCalls = 0;

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
});

/** 扫码成功 → check_sig 给出 p_skey → authorize 给出 code → musicu 由参数决定是否给 musickey。 */
const stubTicketExchange = ({ musickey }: { musickey?: string }) => {
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
            return jsonResponse({ req: { code: 0, data: musickey ? { musickey, musicid: '2774749' } : {} } });
        }
        return new Response('', { status: 404 });
    });
};

const stubBrowser = () => {
    vi.stubGlobal('chrome', {
        cookies: {
            getAll: async () => [],
            get: async () => null,
            set: async () => ({}),
            remove: async () => ({}),
        },
        storage: { local: { get: async () => ({}), set: async () => undefined } },
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
};

const checkOnce = async (): Promise<QrCheckResult> => {
    const { bridge } = await loadBridge();
    return await bridge.qqCheckLoginQr({ qrsig: 'test-qrsig', ptqrtoken: '1' }) as unknown as QrCheckResult;
};

beforeEach(() => {
    vi.resetModules();
    checkSigCalls = 0;
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

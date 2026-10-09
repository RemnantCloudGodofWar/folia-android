import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqProfileCache.test.ts
// 上游资料页偶发失败时，账号昵称与头像会一起从界面上消失（凭据其实还在）。
// 这里固定住兜底行为：按账号 id 缓存展示信息，只在字段缺失时补，且不会串账号。

const storage = new Map<string, string>();
const fetchMock = vi.fn();

const loginStatusResponse = (profile: Record<string, unknown>) => new Response(
    JSON.stringify({ code: 200, data: { profile } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
);

const loadQqProvider = async () => {
    const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
    return qqProvider.auth!;
};

beforeEach(() => {
    vi.resetModules();
    storage.clear();
    // 有后端会话才会去问 login_status（与内置桥的真实条件一致）。
    storage.set('online_provider:qq:cookie', 'qqmusic_session=test');
    fetchMock.mockReset();
    vi.stubEnv('VITE_QQ_API_BASE', 'https://qq.example.test');
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    });
    vi.spyOn(console, 'info').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('QQ account display fields', () => {
    it('keeps the cached nickname and avatar when the profile page returns none', async () => {
        const auth = await loadQqProvider();
        fetchMock.mockResolvedValue(loginStatusResponse({
            uin: '2774749',
            str_musicid: '2774749',
            nickname: '测试账号',
            avatarUrl: 'https://q1.qlogo.cn/g?b=qq&nk=2774749&s=100',
        }));

        const first = await auth.getLoginStatus();
        expect(first?.nickname).toBe('测试账号');
        expect(first?.avatarUrl).toBe('https://q1.qlogo.cn/g?b=qq&nk=2774749&s=100');

        // 资料页这次什么都没给（上游偶发失败 / 只回了账号 id）。
        fetchMock.mockResolvedValue(loginStatusResponse({ uin: '2774749', str_musicid: '2774749' }));
        const second = await auth.getLoginStatus();

        expect(second?.id).toBe('2774749');
        expect(second?.nickname).toBe('测试账号');
        expect(second?.avatarUrl).toBe('https://q1.qlogo.cn/g?b=qq&nk=2774749&s=100');
    });

    it('never reuses another account cached display fields', async () => {
        const auth = await loadQqProvider();
        fetchMock.mockResolvedValue(loginStatusResponse({
            uin: '2774749',
            str_musicid: '2774749',
            nickname: '测试账号',
            avatarUrl: 'https://q1.qlogo.cn/g?b=qq&nk=2774749&s=100',
        }));
        await auth.getLoginStatus();

        // 换了账号，且资料页没给展示字段：只能拿到的就是空，不能把上一个账号的名字/头像搬过来。
        fetchMock.mockResolvedValue(loginStatusResponse({ uin: '10001', str_musicid: '10001' }));
        const other = await auth.getLoginStatus();

        expect(other?.id).toBe('10001');
        // 名字必须是这个账号自己的兜底，而不是上一个账号的缓存。
        expect(other?.nickname).toBe('QQ 10001');
        expect(other?.avatarUrl).toBeUndefined();
    });
});

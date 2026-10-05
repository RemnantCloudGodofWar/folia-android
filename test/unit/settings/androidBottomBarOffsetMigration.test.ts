import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/settings/androidBottomBarOffsetMigration.test.ts
// 安卓上那个自由滑块把控制条抬到画面中间并持久化过一次，滑块移除时要把这种
// 历史遗留的大偏移复位一次；桌面/网页端以及小幅抬高都必须原样保留。

const VIEWPORT_HEIGHT = 866;
// resolvePlayerBottomBarMaxOffset(866) === 301，25% 阈值约等于 99。

const installGlobals = (storedOffset: string | null, platform: string) => {
    const store = new Map<string, string>();
    if (storedOffset !== null) store.set('player_bottom_bar_offset', storedOffset);

    const storage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)); },
        removeItem: (key: string) => { store.delete(key); },
        clear: () => store.clear(),
        key: () => null,
        get length() { return store.size; },
    };

    vi.stubGlobal('window', {
        innerHeight: VIEWPORT_HEIGHT,
        Capacitor: { getPlatform: () => platform },
        localStorage: storage,
    });
    vi.stubGlobal('localStorage', storage);
    return store;
};

const readOffset = async (): Promise<number> => {
    vi.resetModules();
    const { usePlayerChromeSettingsStore } = await import('../../../src/stores/usePlayerChromeSettingsStore');
    return usePlayerChromeSettingsStore.getState().playerBottomBarOffset;
};

describe('legacy Android bottom bar offset migration', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it('resets a mid-screen offset once on Android', async () => {
        const store = installGlobals('217', 'android');
        await expect(readOffset()).resolves.toBe(32);
        expect(store.get('player_bottom_bar_offset')).toBe('32');
    });

    it('keeps a small deliberate lift', async () => {
        const store = installGlobals('60', 'android');
        await expect(readOffset()).resolves.toBe(60);
        expect(store.get('player_bottom_bar_offset')).toBe('60');
    });

    it('leaves the default value alone', async () => {
        installGlobals('32', 'android');
        await expect(readOffset()).resolves.toBe(32);
    });

    it('does not touch the offset outside Android', async () => {
        const store = installGlobals('217', 'web');
        await expect(readOffset()).resolves.toBe(217);
        expect(store.get('player_bottom_bar_offset')).toBe('217');
    });
});

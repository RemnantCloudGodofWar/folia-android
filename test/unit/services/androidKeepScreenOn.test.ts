import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyKeepScreenOn,
    installKeepScreenOnPreference,
    KEEP_SCREEN_ON_STORAGE_KEY,
    readStoredKeepScreenOn,
    resetKeepScreenOnRuntime,
    writeStoredKeepScreenOn,
} from '@/services/androidKeepScreenOn';

// test/unit/services/androidKeepScreenOn.test.ts
// 「屏幕常亮」：安卓走原生窗口标志（切页不丢），拿不到插件时退回 Screen Wake Lock。

const storage = new Map<string, string>();
const setKeepScreenOn = vi.fn(() => Promise.resolve({ enabled: true }));
const request = vi.fn(async () => ({ release: vi.fn(async () => undefined), addEventListener: vi.fn() }));

beforeEach(() => {
    storage.clear();
    setKeepScreenOn.mockClear();
    request.mockClear();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('window', { Capacitor: { Plugins: { FoliaNative: { setKeepScreenOn } } } });
    vi.stubGlobal('navigator', { wakeLock: { request } });
});

afterEach(() => {
    resetKeepScreenOnRuntime();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('keep screen on', () => {
    it('prefers the native window flag on Android', async () => {
        applyKeepScreenOn(true);
        await Promise.resolve();

        expect(setKeepScreenOn).toHaveBeenCalledWith({ enabled: true });
        // 原生能兜住就不再申请网页 wake lock
        expect(request).not.toHaveBeenCalled();

        applyKeepScreenOn(false);
        await Promise.resolve();
        expect(setKeepScreenOn).toHaveBeenLastCalledWith({ enabled: false });
    });

    it('falls back to the wake lock API when the plugin is missing', async () => {
        vi.stubGlobal('window', { Capacitor: { Plugins: {} } });

        applyKeepScreenOn(true);
        await Promise.resolve();
        expect(request).toHaveBeenCalledWith('screen');

        applyKeepScreenOn(false);
        await Promise.resolve();
        expect(setKeepScreenOn).not.toHaveBeenCalled();
    });

    it('remembers the switch and re-applies it on startup', async () => {
        writeStoredKeepScreenOn(true);
        expect(readStoredKeepScreenOn()).toBe(true);
        expect(storage.get(KEEP_SCREEN_ON_STORAGE_KEY)).toBe('true');

        installKeepScreenOnPreference();
        await Promise.resolve();
        expect(setKeepScreenOn).toHaveBeenCalledWith({ enabled: true });

        writeStoredKeepScreenOn(false);
        expect(readStoredKeepScreenOn()).toBe(false);
    });

    it('stays a no-op instead of throwing when neither mechanism exists', async () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('navigator', {});

        expect(() => applyKeepScreenOn(true)).not.toThrow();
        await Promise.resolve();
        expect(setKeepScreenOn).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });
});

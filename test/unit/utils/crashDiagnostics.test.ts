import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    clearCrashDiagnostics,
    readCrashDiagnostics,
    recordCrashDiagnostic,
} from '@/utils/crashDiagnostics';

// test/unit/utils/crashDiagnostics.test.ts

const createStorage = () => {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
    };
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('crash diagnostics', () => {
    it('keeps WebView errors locally when no native bridge is present', async () => {
        vi.stubGlobal('localStorage', createStorage());
        vi.stubGlobal('window', {});

        recordCrashDiagnostic('window-error', new Error('boom'));
        const entries = await readCrashDiagnostics();

        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ source: 'window-error', type: 'Error', message: 'boom' });
        expect(entries[0].stack).toContain('Error: boom');
    });

    it('prefers the native crash history and clears both stores', async () => {
        const storage = createStorage();
        vi.stubGlobal('localStorage', storage);
        const nativeHistory = JSON.stringify([{
            at: '2026-10-08T00:00:00.000Z',
            source: 'native-uncaught',
            thread: 'main',
            type: 'java.lang.IllegalStateException',
            message: 'native failure',
            stack: 'at MainActivity.onCreate(MainActivity.java:1)',
        }]);
        const getCrashDiagnostics = vi.fn(async () => ({ history: nativeHistory }));
        const clearCrashDiagnostics = vi.fn(async () => undefined);
        vi.stubGlobal('window', {
            Capacitor: { Plugins: { FoliaNative: { getCrashDiagnostics, clearCrashDiagnostics } } },
        });

        const entries = await readCrashDiagnostics();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            source: 'native-uncaught',
            thread: 'main',
            type: 'java.lang.IllegalStateException',
            message: 'native failure',
        });

        await clearCrashDiagnostics();
        expect(clearCrashDiagnostics).toHaveBeenCalledTimes(1);
    });

    it('keeps Android process-exit records returned by the native bridge', async () => {
        vi.stubGlobal('localStorage', createStorage());
        const nativeHistory = JSON.stringify([{
            at: '2026-10-09T14:36:01.000Z',
            source: 'android-exit',
            thread: 'system',
            type: 'process-exit:CRASH_NATIVE',
            message: 'process=top.izuna.foliamajor reason=CRASH_NATIVE status=11',
            stack: 'signal 11 (SIGSEGV)',
        }]);
        const getCrashDiagnostics = vi.fn(async () => ({ history: nativeHistory }));
        vi.stubGlobal('window', {
            Capacitor: { Plugins: { FoliaNative: { getCrashDiagnostics } } },
        });

        const entries = await readCrashDiagnostics();

        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            source: 'android-exit',
            thread: 'system',
            type: 'process-exit:CRASH_NATIVE',
        });
        expect(entries[0].message).toContain('reason=CRASH_NATIVE');
        expect(entries[0].stack).toContain('SIGSEGV');
    });
});

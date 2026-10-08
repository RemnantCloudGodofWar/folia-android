import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ANDROID_PHONE_FIT_STORAGE_KEY,
    ANDROID_PHONE_FIT_ORIENTATION_STORAGE_KEY,
    applyAndroidPhoneFit,
    readStoredAndroidPhoneFitOrientation,
    readStoredAndroidPhoneFit,
    writeStoredAndroidPhoneFitOrientation,
    writeStoredAndroidPhoneFit,
} from '@/services/androidPhoneLayout';

const storage = new Map<string, string>();

afterEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
});

describe('android phone layout preference', () => {
    it('persists the switch using the dedicated key', () => {
        const localStorageStub = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        };
        vi.stubGlobal('window', { localStorage: localStorageStub });
        vi.stubGlobal('localStorage', localStorageStub);

        writeStoredAndroidPhoneFit(true);
        expect(storage.get(ANDROID_PHONE_FIT_STORAGE_KEY)).toBe('true');
        expect(readStoredAndroidPhoneFit()).toBe(true);

        writeStoredAndroidPhoneFit(false);
        expect(readStoredAndroidPhoneFit()).toBe(false);

        writeStoredAndroidPhoneFitOrientation('landscape');
        expect(storage.get(ANDROID_PHONE_FIT_ORIENTATION_STORAGE_KEY)).toBe('landscape');
        expect(readStoredAndroidPhoneFitOrientation()).toBe('landscape');
    });

    it('gates CSS through the document root attribute', () => {
        const setAttribute = vi.fn();
        vi.stubGlobal('document', { documentElement: { setAttribute } });

        applyAndroidPhoneFit(true, 'landscape');
        expect(setAttribute).toHaveBeenCalledWith('data-folia-phone-fit', 'true');
        expect(setAttribute).toHaveBeenCalledWith('data-folia-phone-orientation', 'landscape');

        applyAndroidPhoneFit(false, 'portrait');
        expect(setAttribute).toHaveBeenCalledWith('data-folia-phone-fit', 'false');
        expect(setAttribute).toHaveBeenCalledWith('data-folia-phone-orientation', 'portrait');
    });
});

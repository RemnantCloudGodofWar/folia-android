import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/nativeAndroidBridge.test.ts
// The built-in Android app runs the bridge API modules inside the WebView, so every request they
// make is a cross-origin fetch. Only the hosts routed through the native OkHttp proxy survive;
// anything else fails on CORS and surfaces as an empty result rather than a visible error, which
// is how the KuGou search box broke.

describe('nativeAndroidBridge request routing', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal('location', { href: 'https://localhost/' });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('routes every KuGou API host through the native bridge', async () => {
        const { isBridgedApiUrl } = await import('@/services/nativeAndroidBridge');

        expect(isBridgedApiUrl('https://songsearch.kugou.com/song_search_v2?keyword=lofi')).toBe(true);
        expect(isBridgedApiUrl('https://complexsearch.kugou.com/v2/search/song')).toBe(true);
        expect(isBridgedApiUrl('http://trackercdnbj.kugou.com/i/v2/')).toBe(true);
        expect(isBridgedApiUrl('https://vip.kugou.com/')).toBe(true);
        expect(isBridgedApiUrl('https://kugou.com/')).toBe(true);
    });

    it('keeps NetEase, QQ and the QR image host on the bridge', async () => {
        const { isBridgedApiUrl } = await import('@/services/nativeAndroidBridge');

        expect(isBridgedApiUrl('https://interface.music.163.com/eapi/song/enhance/player/url')).toBe(true);
        expect(isBridgedApiUrl('https://u.y.qq.com/cgi-bin/musicu.fcg')).toBe(true);
        expect(isBridgedApiUrl('https://graph.qq.com/oauth2.0/authorize')).toBe(true);
        expect(isBridgedApiUrl('https://api.qrserver.com/v1/create-qr-code/')).toBe(true);
    });

    it('leaves unrelated hosts and lookalike domains to the browser', async () => {
        const { isBridgedApiUrl } = await import('@/services/nativeAndroidBridge');

        expect(isBridgedApiUrl('https://example.com/api')).toBe(false);
        // `notkugou.com` must not match the `kugou.com` rule by suffix.
        expect(isBridgedApiUrl('https://notkugou.com/song_search_v2')).toBe(false);
        expect(isBridgedApiUrl('https://kugou.com.evil.test/')).toBe(false);
        // Relative urls resolve against the page the app is served from.
        expect(isBridgedApiUrl('/assets/cover.png')).toBe(false);
    });
});

describe('nativeAndroidBridge header safety', () => {
    it('percent-encodes code points Chromium cannot put in Headers', async () => {
        const { toHeaderSafeValue } = await import('@/services/nativeAndroidBridge');

        expect(toHeaderSafeValue('plain ascii')).toBe('plain ascii');
        expect(toHeaderSafeValue('café')).toBe('café');
        expect(toHeaderSafeValue('用户凭证')).toBe('%E7%94%A8%E6%88%B7%E5%87%AD%E8%AF%81');
    });

    it('sanitizes init headers before the Headers constructor sees them', async () => {
        const { toHeaderEntries } = await import('@/services/nativeAndroidBridge');

        expect(toHeaderEntries({ Cookie: '用户凭证' })).toEqual([
            ['Cookie', '%E7%94%A8%E6%88%B7%E5%87%AD%E8%AF%81'],
        ]);
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
    available: vi.fn(),
    request: vi.fn(),
}));

vi.mock('@/services/foliaExtensionBridge', () => ({
    isFoliaExtensionBridgeAvailable: bridge.available,
    requestFoliaExtension: bridge.request,
}));

import { requestBodian } from '@/services/onlineMusic/bodianTransport';

// test/unit/onlineMusic/bodianTransport.test.ts

afterEach(() => vi.unstubAllGlobals());

describe('Bodian page-size adaptation', () => {
    it.each([150, 1000])('bounds the GridView batch of %s while preserving its physical cursor', async limit => {
        const data = { list: [{ id: 1 }], bodianPagination: { nextOffset: 200, hasMore: true } };
        const bodianRequest = vi.fn().mockResolvedValue({ ok: true, data });
        vi.stubGlobal('window', { electron: { bodianRequest } });
        expect(await requestBodian('playlist_tracks', { id: '123', limit, offset: 100, source: 5 })).toEqual(data);
        expect(bodianRequest).toHaveBeenCalledWith('playlist_tracks', { id: '123', limit: 100, offset: 100, source: 5 });
    });

    it('uses the Android bridge when Electron is not present', async () => {
        const data = { resultList: [{ id: 1 }] };
        bridge.available.mockResolvedValue(true);
        bridge.request.mockResolvedValue({ ok: true, data });
        vi.stubGlobal('window', { Capacitor: { getPlatform: () => 'android' } });

        expect(await requestBodian('search', { query: 'test', limit: 150, offset: 0 })).toEqual(data);
        expect(bridge.request).toHaveBeenCalledWith({
            provider: 'bodian',
            operation: 'search',
            params: { query: 'test', limit: 100, offset: 0 },
        });
    });
});

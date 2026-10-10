import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearCollectionOrderDiagnostics,
    getCollectionOrderDiagnosticLines,
    recordCollectionOrderMerged,
    recordCollectionOrderPage,
} from '@/utils/collectionOrderDiagnostics';
import type { SongResult } from '@/types';

const track = (id: string): SongResult => ({
    id,
    name: `Song ${id}`,
    sourceRef: { kind: 'online', providerId: 'kugou', mediaId: id },
} as SongResult);

describe('collection order diagnostics', () => {
    beforeEach(() => clearCollectionOrderDiagnostics());

    it('reports a preserved upstream page order', () => {
        recordCollectionOrderPage({
            phase: 'page', source: 'provider-page', providerId: 'kugou',
            collectionId: '123', collectionType: 'playlist', offset: 0,
            requestedLimit: 3, itemCount: 3, hasMore: false, nextOffset: 3,
            tracks: [track('a'), track('b'), track('c')],
        });
        recordCollectionOrderMerged({
            phase: 'merged', source: 'first-page', providerId: 'kugou',
            collectionId: '123', collectionType: 'playlist', offset: 0,
            itemCount: 3, hasMore: false, nextOffset: 3,
            tracks: [track('a'), track('b'), track('c')],
        });

        expect(getCollectionOrderDiagnosticLines().join('\n')).toContain('orderCheck=preserved');
    });

    it('flags a sequence reversed by the aggregation layer', () => {
        recordCollectionOrderPage({
            phase: 'page', source: 'provider-page', providerId: 'kugou',
            collectionId: '456', collectionType: 'playlist', offset: 0,
            requestedLimit: 3, itemCount: 3, hasMore: false, nextOffset: 3,
            tracks: [track('a'), track('b'), track('c')],
        });
        recordCollectionOrderMerged({
            phase: 'merged', source: 'first-page', providerId: 'kugou',
            collectionId: '456', collectionType: 'playlist', offset: 0,
            itemCount: 3, hasMore: false, nextOffset: 3,
            tracks: [track('c'), track('b'), track('a')],
        });

        expect(getCollectionOrderDiagnosticLines().join('\n')).toContain('orderCheck=reversed');
    });
});

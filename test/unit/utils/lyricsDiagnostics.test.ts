import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearLyricsDiagnostics,
    describeLyricsShape,
    getLyricsDiagnosticLines,
    noteLyricsDiagnostic,
} from '@/utils/lyricsDiagnostics';
import type { LyricData, SongResult } from '@/types';

const song: SongResult = {
    id: 'song-1',
    name: 'Example',
    artists: [],
    album: { id: 'album-1', name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: 'song-1' },
} as SongResult;

const lyrics = {
    lines: [
        { words: [], startTime: 0, endTime: 1, fullText: 'a', wordSegments: ['a'] },
        { words: [], startTime: 1, endTime: 2, fullText: 'b', translation: 'B' },
    ],
} as LyricData;

describe('lyrics diagnostics', () => {
    beforeEach(() => clearLyricsDiagnostics());

    it('describes lyric shape without retaining text', () => {
        expect(describeLyricsShape(lyrics)).toMatchObject({
            lines: 2,
            wordSegments: 1,
            translations: 1,
        });
    });

    it('keeps an ordered, bounded lyric pipeline trail', () => {
        noteLyricsDiagnostic('load:start', song, { autoUseBest: true });
        noteLyricsDiagnostic('setter:null', song, { reason: 'filtered-or-staff-policy' });

        const lines = getLyricsDiagnosticLines();
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('load:start');
        expect(lines[0]).toContain('provider=netease');
        expect(lines[1]).toContain('setter:null');
        expect(lines[1]).toContain('reason=filtered-or-staff-policy');
    });
});

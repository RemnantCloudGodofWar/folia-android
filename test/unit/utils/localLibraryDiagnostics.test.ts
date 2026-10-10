import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearLocalLibraryDiagnostics,
    getLocalLibraryDiagnosticLines,
    noteLocalLibraryDiagnostic,
} from '@/utils/localLibraryDiagnostics';

describe('local library diagnostics', () => {
    beforeEach(() => clearLocalLibraryDiagnostics());

    it('keeps an ordered, bounded local-library read trail', () => {
        noteLocalLibraryDiagnostic('read:start');
        noteLocalLibraryDiagnostic('read:done', { songs: 4200, readMs: 310, totalMs: 980 });

        const lines = getLocalLibraryDiagnosticLines();
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('read:start');
        expect(lines[1]).toContain('read:done');
        expect(lines[1]).toContain('songs=4200');
        expect(lines[1]).toContain('totalMs=980');
    });

    it('does not require or retain song names or file paths', () => {
        noteLocalLibraryDiagnostic('read:done', { songs: 1, readMs: 2, totalMs: 3 });
        const text = getLocalLibraryDiagnosticLines().join('\n');

        expect(text).not.toContain('/storage/');
        expect(text).not.toContain('.mp3');
    });
});

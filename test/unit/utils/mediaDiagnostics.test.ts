import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    noteAudioElementEvent,
    noteAudioElementProgress,
    noteAudioTimeUpdate,
    readPlaybackContinuitySnapshot,
} from '@/utils/mediaDiagnostics';

const createAudioElement = (src: string): HTMLAudioElement => {
    return {
        currentSrc: src,
        readyState: 4,
        networkState: 2,
        buffered: {
            length: 1,
            start: () => 0,
            end: () => 30,
        },
        currentTime: 10,
        paused: false,
        ended: false,
    } as unknown as HTMLAudioElement;
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('mediaDiagnostics playback continuity', () => {
    it('records a buffering interruption and the buffered-ahead window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-08T08:00:00Z'));
        const element = createAudioElement('https://m801.music.126.net/signed/audio.mp3?token=secret');

        noteAudioElementEvent('waiting', element, 'A');
        vi.setSystemTime(new Date('2026-10-08T08:00:00.420Z'));
        noteAudioElementEvent('playing', element, 'A');
        noteAudioElementProgress(element, 'A');

        const snapshot = readPlaybackContinuitySnapshot();
        expect(snapshot.source).toBe('https://m801.music.126.net');
        expect(snapshot.waitingCount).toBe(1);
        expect(snapshot.waitingTotalMs).toBe(420);
        expect(snapshot.waitingMaxMs).toBe(420);
        expect(snapshot.bufferedAheadSec).toBe(20);
        expect(snapshot.deck).toBe('A');
    });

    it('records a media-clock stall when wall time advances but playback does not', () => {
        let clock = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        const element = createAudioElement('https://m802.music.126.net/signed/audio.mp3?token=secret');

        noteAudioElementEvent('playing', element, 'B');
        clock = 1600;
        element.currentTime = 10.1;
        noteAudioTimeUpdate(element, 'B');

        const snapshot = readPlaybackContinuitySnapshot();
        expect(snapshot.clockLagCount).toBe(1);
        expect(snapshot.clockLagMaxMs).toBe(500);
        expect(snapshot.lastClockLagMs).toBe(500);
    });
});

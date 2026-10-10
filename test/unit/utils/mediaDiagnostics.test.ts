import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
    noteAudioElementEvent,
    noteAudioElementProgress,
    noteAudioTimeUpdate,
    notePlaybackStreamInfo,
    readPlaybackContinuitySnapshot,
    resetMediaDiagnosticsForTests,
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
    beforeEach(() => resetMediaDiagnosticsForTests());

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
        clock = 1250;
        element.currentTime = 10.05;
        noteAudioTimeUpdate(element, 'B');

        const snapshot = readPlaybackContinuitySnapshot();
        expect(snapshot.clockLagCount).toBe(1);
        expect(snapshot.clockSamples).toBe(1);
        expect(snapshot.clockLagMaxMs).toBe(200);
        expect(snapshot.lastClockLagMs).toBe(200);
        expect(snapshot.lastClockProgressRatio).toBeCloseTo(0.2);
    });

    it('does not count normal playback progress as a clock stall', () => {
        let clock = 2000;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        const element = createAudioElement('https://m802.music.126.net/signed/audio.mp3?token=secret');

        noteAudioElementEvent('playing', element, 'B');
        clock = 2250;
        element.currentTime = 10.25;
        noteAudioTimeUpdate(element, 'B');

        const snapshot = readPlaybackContinuitySnapshot();
        expect(snapshot.clockSamples).toBe(1);
        expect(snapshot.clockLagCount).toBe(0);
        expect(snapshot.lastClockProgressRatio).toBeCloseTo(1);
    });

    // 「歌卡」反馈里最容易被漏掉的一条：缓冲充足、没有 waiting，但播放中位置/速率被改过。
    it('records the resolved stream and any seek or rate change during playback', () => {
        const element = createAudioElement('https://m801.music.126.net/signed/audio.flac?token=secret');

        noteAudioElementEvent('playing', element, 'A');
        noteAudioElementEvent('seeking', element, 'A');
        noteAudioElementEvent('seeked', element, 'A');
        element.playbackRate = 1.25;
        noteAudioElementEvent('ratechange', element, 'A');
        notePlaybackStreamInfo({
            provider: 'netease',
            requestedLevel: 'exhigh',
            resolvedLevel: 'lossless',
            bitrateKbps: 900,
            format: 'flac',
            host: 'm801.music.126.net',
            sizeMb: 32.4,
            trial: false,
        });

        const snapshot = readPlaybackContinuitySnapshot();
        expect(snapshot.seekingCount).toBe(1);
        expect(snapshot.seekedCount).toBe(1);
        expect(snapshot.rateChangeCount).toBe(1);
        expect(snapshot.playbackRate).toBe(1.25);
        expect(snapshot.stream?.resolvedLevel).toBe('lossless');
        expect(snapshot.stream?.bitrateKbps).toBe(900);
        expect(snapshot.stream?.format).toBe('flac');
    });

    // 缓冲够、没有 waiting，但解码跟不上时，只有这条计数会暴露问题。
    it('samples decoded audio progress when the element exposes it', () => {
        const element = createAudioElement('https://m801.music.126.net/signed/audio.mp3?token=secret') as
            HTMLAudioElement & { webkitAudioDecodedByteCount?: number };
        element.webkitAudioDecodedByteCount = 1_000_000;
        element.currentTime = 30;
        noteAudioElementProgress(element, 'A');

        const first = readPlaybackContinuitySnapshot();
        expect(first.decodedBytes).toBe(1_000_000);
        expect(first.decodeBaseBytes).toBe(1_000_000);
        expect(first.decodeBaseMediaSec).toBe(30);

        element.webkitAudioDecodedByteCount = 2_400_000;
        element.currentTime = 60;
        noteAudioElementProgress(element, 'A');

        const second = readPlaybackContinuitySnapshot();
        expect(second.decodedBytes).toBe(2_400_000);
        // 基线不动，报告才能算出「这段时间平均解码了多少 kbps」。
        expect(second.decodeBaseBytes).toBe(1_000_000);
        expect(second.decodeBaseMediaSec).toBe(30);
    });
});

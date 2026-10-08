import { noteLibraryStep } from '../nativeBridge/api/libraryTrace.js';

// src/utils/mediaDiagnostics.ts
// 播放链路的现场记录。除了「有没有加载成功」，这里还统计缓冲中断、网络停滞、主线程卡顿和
// 音频输出参数，用来区分网易云等平台的卡顿是取链失败、缓冲不足、解码问题还是输出链路问题。

export type AudioDeckId = 'A' | 'B';
export type AudioElementEventKind = 'error' | 'canplay' | 'stalled' | 'waiting' | 'playing';

type PlaybackContinuity = {
    source: string;
    sourceKey: string;
    deck: AudioDeckId | '';
    startedAt: number;
    readyState: number;
    networkState: number;
    bufferedAheadSec: number | null;
    bufferedRanges: number;
    waitingCount: number;
    waitingTotalMs: number;
    waitingMaxMs: number;
    lastWaitingMs: number | null;
    waitingSinceMs: number | null;
    stalledCount: number;
    errorCount: number;
    clockLagCount: number;
    clockLagTotalMs: number;
    clockLagMaxMs: number;
    lastClockLagMs: number | null;
    lastEvent: string;
    lastEventAt: number;
    lastWallMs: number | null;
    lastMediaSec: number | null;
};

type AudioContextDiagnostics = {
    state: string;
    sampleRate: number | null;
    baseLatencySec: number | null;
    outputLatencySec: number | null;
    updatedAt: number;
};

const MAX_AGE_MS = 15 * 60 * 1000;

const now = (): number => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
);

const wallNow = (): number => Date.now();

const emptyContinuity = (): PlaybackContinuity => ({
    source: 'none',
    sourceKey: '',
    deck: '',
    startedAt: wallNow(),
    readyState: 0,
    networkState: 0,
    bufferedAheadSec: null,
    bufferedRanges: 0,
    waitingCount: 0,
    waitingTotalMs: 0,
    waitingMaxMs: 0,
    lastWaitingMs: null,
    waitingSinceMs: null,
    stalledCount: 0,
    errorCount: 0,
    clockLagCount: 0,
    clockLagTotalMs: 0,
    clockLagMaxMs: 0,
    lastClockLagMs: null,
    lastEvent: 'none',
    lastEventAt: 0,
    lastWallMs: null,
    lastMediaSec: null,
});

let continuity = emptyContinuity();
let audioContextDiagnostics: AudioContextDiagnostics = {
    state: 'none',
    sampleRate: null,
    baseLatencySec: null,
    outputLatencySec: null,
    updatedAt: 0,
};

const updateAudioContextDiagnostics = (context: AudioContext): void => {
    audioContextDiagnostics = {
        state: context.state || 'unknown',
        sampleRate: Number.isFinite(context.sampleRate) ? context.sampleRate : null,
        baseLatencySec: Number.isFinite(context.baseLatency) ? context.baseLatency : null,
        outputLatencySec: Number.isFinite(context.outputLatency) ? context.outputLatency : null,
        updatedAt: wallNow(),
    };
};

export const noteAudioContext = (context: AudioContext | null | undefined): void => {
    if (!context) return;
    updateAudioContextDiagnostics(context);
    context.addEventListener('statechange', () => updateAudioContextDiagnostics(context));
};

const resetIfStale = (): void => {
    if (!continuity.startedAt || wallNow() - continuity.startedAt > MAX_AGE_MS) {
        continuity = emptyContinuity();
    }
};

const getBufferedState = (element: HTMLAudioElement): { aheadSec: number | null; ranges: number } => {
    const ranges = element.buffered?.length ?? 0;
    if (!ranges) return { aheadSec: null, ranges: 0 };
    const current = element.currentTime;
    for (let index = 0; index < ranges; index += 1) {
        const start = element.buffered.start(index);
        const end = element.buffered.end(index);
        if (current >= start && current <= end) return { aheadSec: Math.max(0, end - current), ranges };
    }
    const lastEnd = element.buffered.end(ranges - 1);
    return {
        aheadSec: lastEnd >= current ? Math.max(0, lastEnd - current) : 0,
        ranges,
    };
};

const ensureSource = (src: string, deck?: AudioDeckId): void => {
    resetIfStale();
    const sourceKey = src.slice(0, 300);
    if (continuity.sourceKey === sourceKey) return;
    const next = emptyContinuity();
    next.source = describeMediaSource(src);
    next.sourceKey = sourceKey;
    next.deck = deck ?? '';
    continuity = next;
};

const updateElementState = (element: HTMLAudioElement, deck?: AudioDeckId): void => {
    const buffered = getBufferedState(element);
    continuity.readyState = element.readyState;
    continuity.networkState = element.networkState;
    continuity.bufferedAheadSec = buffered.aheadSec;
    continuity.bufferedRanges = buffered.ranges;
    if (deck) continuity.deck = deck;
};

/** 只回报协议 + 主机：在线播放地址带有签名路径与 token，不能整条写进报告。 */
export const describeMediaSource = (src: string | null | undefined): string => {
    if (!src) return 'none';
    if (src.startsWith('blob:')) return 'blob:';
    try {
        const url = new URL(src, 'https://localhost');
        return `${url.protocol}//${url.host}`;
    } catch {
        return 'unparseable';
    }
};

// canplay 在一次播放里可能触发多次（尤其是有两个 deck），只记第一次。
const notedReadySources = new Set<string>();

export const noteAudioElementEvent = (
    kind: AudioElementEventKind,
    target: HTMLAudioElement | null | undefined,
    deck?: AudioDeckId,
    trackContinuity = true,
): void => {
    const element = target;
    if (!element) return;
    const src = element.currentSrc || element.getAttribute('src') || '';
    if (trackContinuity) {
        ensureSource(src, deck);
        updateElementState(element, deck);
        const eventAt = wallNow();
        continuity.lastEvent = deck ? `${kind} deck=${deck}` : kind;
        continuity.lastEventAt = eventAt;

        if (kind === 'waiting') {
            if (continuity.waitingSinceMs === null) {
                continuity.waitingCount += 1;
                continuity.waitingSinceMs = eventAt;
            }
            continuity.lastWallMs = null;
            continuity.lastMediaSec = null;
        } else if (kind === 'playing') {
            if (continuity.waitingSinceMs !== null) {
                const durationMs = Math.max(0, eventAt - continuity.waitingSinceMs);
                continuity.lastWaitingMs = Math.round(durationMs);
                continuity.waitingTotalMs += durationMs;
                continuity.waitingMaxMs = Math.max(continuity.waitingMaxMs, durationMs);
                continuity.waitingSinceMs = null;
            }
            continuity.lastWallMs = now();
            continuity.lastMediaSec = element.currentTime;
        } else if (kind === 'stalled') {
            continuity.stalledCount += 1;
        } else if (kind === 'error') {
            continuity.errorCount += 1;
        }
    }

    if (kind === 'canplay') {
        const key = src.slice(0, 300);
        if (notedReadySources.has(key)) return;
        notedReadySources.add(key);
    }
    noteLibraryStep('audio', kind, {
        source: describeMediaSource(src),
        readyState: element.readyState,
        networkState: element.networkState,
        ...(kind === 'error'
            ? {
                code: element.error?.code ?? null,
                message: element.error?.message ?? null,
                paused: element.paused,
            }
            : {}),
    });
};

/** Samples buffered-ahead without writing a trace row on every progress event. */
export const noteAudioElementProgress = (
    target: HTMLAudioElement | null | undefined,
    deck?: AudioDeckId,
): void => {
    if (!target) return;
    const src = target.currentSrc || target.getAttribute('src') || '';
    if (!src) return;
    ensureSource(src, deck);
    updateElementState(target, deck);
};

/**
 * Detects a UI-thread stall: wall time moves but the media clock does not.
 *
 * `waiting` catches buffer underruns; this catches the case where the audio clock loses progress
 * without a waiting/stalled event, which is the shape an Android WebView jank takes.
 */
export const noteAudioTimeUpdate = (
    target: HTMLAudioElement | null | undefined,
    deck?: AudioDeckId,
): void => {
    if (!target || target.paused || target.ended) return;
    const src = target.currentSrc || target.getAttribute('src') || '';
    if (!src) return;
    ensureSource(src, deck);
    updateElementState(target, deck);

    const eventAt = now();
    const mediaSec = target.currentTime;
    const previousWall = continuity.lastWallMs;
    const previousMedia = continuity.lastMediaSec;
    continuity.lastWallMs = eventAt;
    continuity.lastMediaSec = mediaSec;
    if (previousWall === null || previousMedia === null) return;

    const wallDeltaMs = eventAt - previousWall;
    const mediaDeltaMs = (mediaSec - previousMedia) * 1000;
    if (wallDeltaMs < 400 || mediaDeltaMs < 0 || mediaDeltaMs >= wallDeltaMs * 0.75) return;

    const lostMs = Math.round(wallDeltaMs - mediaDeltaMs);
    if (lostMs < 150) return;
    continuity.clockLagCount += 1;
    continuity.clockLagTotalMs += lostMs;
    continuity.clockLagMaxMs = Math.max(continuity.clockLagMaxMs, lostMs);
    continuity.lastClockLagMs = lostMs;
    continuity.lastEvent = deck ? `clock-lag deck=${deck}` : 'clock-lag';
    continuity.lastEventAt = eventAt;
};

export type PlaybackContinuitySnapshot = ReturnType<typeof readPlaybackContinuitySnapshot>;

export const readPlaybackContinuitySnapshot = () => {
    resetIfStale();
    return {
        source: continuity.source,
        deck: continuity.deck || 'none',
        readyState: continuity.readyState,
        networkState: continuity.networkState,
        bufferedAheadSec: continuity.bufferedAheadSec,
        bufferedRanges: continuity.bufferedRanges,
        waitingCount: continuity.waitingCount,
        waitingTotalMs: Math.round(continuity.waitingTotalMs),
        waitingMaxMs: Math.round(continuity.waitingMaxMs),
        lastWaitingMs: continuity.lastWaitingMs,
        stalledCount: continuity.stalledCount,
        errorCount: continuity.errorCount,
        clockLagCount: continuity.clockLagCount,
        clockLagTotalMs: Math.round(continuity.clockLagTotalMs),
        clockLagMaxMs: Math.round(continuity.clockLagMaxMs),
        lastClockLagMs: continuity.lastClockLagMs,
        lastEvent: continuity.lastEvent,
        lastEventAt: continuity.lastEventAt,
        audioContextState: audioContextDiagnostics.state,
        audioContextSampleRate: audioContextDiagnostics.sampleRate,
        audioContextBaseLatencySec: audioContextDiagnostics.baseLatencySec,
        audioContextOutputLatencySec: audioContextDiagnostics.outputLatencySec,
        audioContextUpdatedAt: audioContextDiagnostics.updatedAt,
    };
};

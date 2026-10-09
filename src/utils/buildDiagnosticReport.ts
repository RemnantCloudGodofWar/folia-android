import { getLibraryTraceLines } from '../nativeBridge/api/libraryTrace.js';
import { getQrLoginTraceLines } from '../nativeBridge/api/qrLoginTrace.js';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { readCrashDiagnostics } from './crashDiagnostics';
import { readPlaybackContinuitySnapshot } from './mediaDiagnostics';
import { readLastAiThemeAttempt, readAiThemeAttempts, readFailedAiThemeAttempts } from './aiThemeDiagnostics';
import { isAiConfigured, readAiSettings } from '../services/aiSettings';

// src/utils/buildDiagnosticReport.ts
// 设置 → 帮助 → 复制诊断数据。给用户原样贴进 issue 用，所以字段固定为英文并包在代码块里。
// 只包含可以公开的内容：版本、运行环境、请求形态与条数，不含 cookie、token、账号。

const readLocalStorageFlag = (key: string): string => {
    try {
        const value = localStorage.getItem(key);
        if (value == null) return 'absent';
        return value.length > 0 ? `len=${value.length}` : 'empty';
    } catch {
        return 'unavailable';
    }
};

/** 原始值，不带长度或隐私含义——用于那些本身就是设置数值的键。 */
const readLocalStorageValue = (key: string): string => {
    try {
        const value = localStorage.getItem(key);
        return value == null || value === '' ? '(default)' : value;
    } catch {
        return 'unavailable';
    }
};

const formatSeconds = (value: number | null): string => (
    value === null || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(2)}s`
);

const formatMilliseconds = (value: number | null): string => (
    value === null || !Number.isFinite(value) ? 'n/a' : `${Math.round(value)}ms`
);

/**
 * 播放连续性现场：缓冲中断、网络停滞、主线程卡顿、输出链路和音频效果一起导出，避免把
 * 网易云的偶发卡顿误判成取链问题，也避免把用户开着的噪声音效当成平台故障。
 */
const readPlaybackContinuityLines = (): string[] => {
    const continuity = readPlaybackContinuitySnapshot();
    const audioSettings = useAudioSettingsStore.getState();
    const playback = usePlaybackStore.getState();
    const equalizer = audioSettings.audioEqualizerSettings;
    const effects = equalizer.effects;
    const lastEventAt = continuity.lastEventAt
        ? new Date(continuity.lastEventAt).toISOString()
        : '(not recorded)';
    return [
        `  source: ${continuity.source}`,
        `  deck: ${continuity.deck} readyState=${continuity.readyState} networkState=${continuity.networkState}`,
        `  buffer: ahead=${formatSeconds(continuity.bufferedAheadSec)} ranges=${continuity.bufferedRanges}`,
        `  interruptions: waiting=${continuity.waitingCount} total=${formatMilliseconds(continuity.waitingTotalMs)}`
            + ` max=${formatMilliseconds(continuity.waitingMaxMs)} last=${formatMilliseconds(continuity.lastWaitingMs)}`,
        `  network stalls: stalled=${continuity.stalledCount} errors=${continuity.errorCount}`,
        `  main-thread stalls: count=${continuity.clockLagCount}`
            + ` total=${formatMilliseconds(continuity.clockLagTotalMs)}`
            + ` max=${formatMilliseconds(continuity.clockLagMaxMs)}`
            + ` last=${formatMilliseconds(continuity.lastClockLagMs)}`,
        `  last audio event: ${continuity.lastEvent} at=${lastEventAt}`,
        `  audio context: state=${continuity.audioContextState}`
            + ` sampleRate=${continuity.audioContextSampleRate ?? 'n/a'}`
            + ` baseLatency=${formatSeconds(continuity.audioContextBaseLatencySec)}`
            + ` outputLatency=${formatSeconds(continuity.audioContextOutputLatencySec)}`,
        `  output settings: quality=${audioSettings.audioQuality} replayGain=${playback.replayGainMode}`
            + ` fade=${audioSettings.playbackFadeEnabled ? 'on' : 'off'}`,
        `  effects: enabled=${equalizer.enabled ? 'yes' : 'no'} noise=${effects.noise} crush=${effects.crush}`
            + ` drive=${effects.drive} wow=${effects.wow} punch=${effects.punch}`,
    ];
};

const readNativePlaybackDiagnostics = async (): Promise<{
    cover?: string;
    status?: string;
    detail?: string;
    at?: number;
    applied?: boolean;
} | null> => {
    if (typeof window === 'undefined') return null;
    const plugin = (window as any).Capacitor?.Plugins?.FoliaNative;
    if (typeof plugin?.getPlaybackDiagnostics !== 'function') return null;
    try {
        return await plugin.getPlaybackDiagnostics();
    } catch {
        return null;
    }
};

/**
 * 手机厂商屏幕顶部（挖孔 / 刘海）的现场。
 *
 * 「顶部还有黑边」时最需要知道的就是系统到底报了什么：cutout mode 是否已经切成
 * shortEdges、有没有识别到挖孔、安全区矩形是多少。全是设备侧只读信息，不含隐私。
 */
const readDisplayCutoutLines = async (): Promise<string[]> => {
    if (typeof window === 'undefined') return ['  (no window)'];
    const plugin = (window as unknown as {
        Capacitor?: { getPlatform?: () => string; Plugins?: { FoliaNative?: { getDisplayCutout?: () => Promise<unknown> } } };
    }).Capacitor;
    if (plugin?.getPlatform?.() !== 'android') {
        return ['  (not an android runtime)'];
    }
    const native = plugin?.Plugins?.FoliaNative;
    if (typeof native?.getDisplayCutout !== 'function') {
        return ['  (native cutout diagnostics unavailable)'];
    }
    try {
        const snapshot = await native.getDisplayCutout() as {
            available?: boolean;
            sdk?: number;
            layoutInDisplayCutoutMode?: number;
            hasCutout?: boolean;
            safeInsets?: { left?: number; top?: number; right?: number; bottom?: number };
            boundingRects?: Array<{ left?: number; top?: number; right?: number; bottom?: number }>;
            screenHeightDp?: number;
            decorHeightPx?: number;
            contentHeightPx?: number;
            webViewHeightPx?: number;
            webViewPaddingTopPx?: number;
            contentPaddingTopPx?: number;
            decorPaddingTopPx?: number;
            visibleFrame?: { left?: number; top?: number; right?: number; bottom?: number };
        } | null;
        if (!snapshot || snapshot.available === false) {
            return ['  (no decor view)'];
        }
        const insets = snapshot.safeInsets;
        const rects = Array.isArray(snapshot.boundingRects) ? snapshot.boundingRects : [];
        return [
            `  sdk: ${snapshot.sdk ?? 'unknown'}`,
            `  layoutInDisplayCutoutMode: ${describeCutoutMode(snapshot.layoutInDisplayCutoutMode)}`,
            `  hasCutout: ${snapshot.hasCutout ? 'yes' : 'no'}`,
            insets
                ? `  safe inset: left=${insets.left ?? 0} top=${insets.top ?? 0} right=${insets.right ?? 0} bottom=${insets.bottom ?? 0}`
                : '  safe inset: (none)',
            rects.length
                ? `  bounding rects: ${rects.map(rect => `[${rect.left ?? 0},${rect.top ?? 0},${rect.right ?? 0},${rect.bottom ?? 0}]`).join(' ')}`
                : '  bounding rects: (none)',
            `  height: screen=${snapshot.screenHeightDp ?? 'n/a'}`
                + ` decor=${snapshot.decorHeightPx ?? 'n/a'}`
                + ` content=${snapshot.contentHeightPx ?? 'n/a'}`,
            `  web view: height=${snapshot.webViewHeightPx ?? 'n/a'}`
                + ` paddingTop=${snapshot.webViewPaddingTopPx ?? 'n/a'}`,
            `  padding: decorTop=${snapshot.decorPaddingTopPx ?? 'n/a'}`
                + ` contentTop=${snapshot.contentPaddingTopPx ?? 'n/a'}`,
            snapshot.visibleFrame
                ? `  visible frame: [${snapshot.visibleFrame.left ?? 0},${snapshot.visibleFrame.top ?? 0},`
                    + `${snapshot.visibleFrame.right ?? 0},${snapshot.visibleFrame.bottom ?? 0}]`
                : '  visible frame: (unknown)',
        ];
    } catch (error) {
        return [`  cutout diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`];
    }
};

/** Android 的 layoutInDisplayCutoutMode 常量值对应关系，读起来比裸数字直观。 */
const describeCutoutMode = (mode: number | undefined): string => {
    if (mode == null) return 'unknown';
    if (mode === 0) return '0 (default)';
    if (mode === 1) return '1 (shortEdges)';
    if (mode === 2) return '2 (never)';
    if (mode === 3) return '3 (always)';
    return String(mode);
};

/**
 * 底部控制条的实际几何。
 *
 * 「控制条跑到画面中间」有两种完全不同的成因，光看设置值分不出来：
 * 1. 持久化的基线偏移量被调大了（值就在 `player_bottom_bar_offset`）；
 * 2. 那层 `absolute` 的包含块不是整屏（包含块被压扁后，`bottom: 32px` 也会落在画面中间）。
 * 所以这里把控制条矩形、它所在的绝对定位层、以及该层的包含块一并导出。
 */
const readBottomBarGeometry = (): string[] => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return ['  (no dom)'];
    }
    try {
        const bar = document.querySelector('[data-ponder="player-bar"]') as HTMLElement | null;
        if (!bar) return ['  bar: not mounted'];

        const rect = bar.getBoundingClientRect();

        const findAncestor = (
            start: HTMLElement | null,
            match: (element: HTMLElement) => boolean,
        ): HTMLElement | null => {
            let node: HTMLElement | null = start?.parentElement ?? null;
            while (node && node !== document.body) {
                if (match(node)) return node;
                node = node.parentElement;
            }
            return null;
        };

        // 实际定位层：最近的 absolute 祖先，它的 bottom 就是这条控制条的定位值。
        const layer = findAncestor(bar, element => getComputedStyle(element).position === 'absolute');
        const layerStyle = layer ? getComputedStyle(layer) : null;

        // 包含块：定位层之下的最近定位祖先，它的高度决定 bottom 是从哪里算起。
        const containingBlock = findAncestor(layer, element => getComputedStyle(element).position !== 'static');
        const blockRect = containingBlock?.getBoundingClientRect() ?? null;

        return [
            `  viewport: ${window.innerWidth}x${window.innerHeight}`,
            `  bar rect: top=${Math.round(rect.top)} bottom=${Math.round(rect.bottom)}`
                + ` height=${Math.round(rect.height)} gapToViewportBottom=${Math.round(window.innerHeight - rect.bottom)}`,
            `  layer: position=${layerStyle?.position ?? 'n/a'} bottom=${layerStyle?.bottom ?? 'n/a'}`,
            `  containing block: ${containingBlock?.tagName ?? 'none'}`
                + ` height=${blockRect ? Math.round(blockRect.height) : 'n/a'}`
                + ` top=${blockRect ? Math.round(blockRect.top) : 'n/a'}`
                + ` position=${containingBlock ? getComputedStyle(containingBlock).position : 'n/a'}`,
        ];
    } catch (error) {
        return [`  geometry unavailable: ${error instanceof Error ? error.message : String(error)}`];
    }
};

/**
 * AI 主题生成现场：provider、模型、触发方式、请求状态、原始错误与耗时。
 *
 * 「偶尔报错」最难查的是它不可复现，所以这里把最近几次调用（含成功的）都留一份，
 * 失败时还能看到失败前一次是否成功、耗时是否异常。只导出错误原文，不导出提示词或 Key。
 */
const readAiThemeGenerationLines = (): string[] => {
    const settings = readAiSettings();
    const attempts = readAiThemeAttempts();
    const last = readLastAiThemeAttempt();
    const failed = readFailedAiThemeAttempts();
    const hostOf = (rawUrl: string): string => {
        if (!rawUrl) return '(default)';
        try {
            return new URL(rawUrl).hostname || '(default)';
        } catch {
            return '(invalid url)';
        }
    };
    const lines: string[] = [
        `  provider: ${settings.provider}`
            + ` configured=${isAiConfigured(settings) ? 'yes' : 'no'}`
            + ` model=${settings.provider === 'openai' ? (settings.openaiApiModel.trim() || '(default)') : 'gemini-3-flash-preview'}`,
        `  endpoint host: ${settings.provider === 'openai' ? hostOf(settings.openaiApiUrl.trim()) : 'generativelanguage.googleapis.com'}`,
        `  attempts: total=${attempts.length} failed=${failed.length}`,
        `  last: ${last ? formatAiThemeAttempt(last) : '(no AI theme generation recorded)'}`,
    ];
    if (failed.length) {
        lines.push('  failed attempts:');
        failed.slice(-5).forEach((entry, index) => {
            lines.push(`    [${index + 1}] ${formatAiThemeAttempt(entry)}`);
        });
    }
    return lines;
};

const formatAiThemeAttempt = (entry: {
    at: number;
    provider: string;
    model: string;
    trigger: string;
    stage: string;
    ok: boolean;
    status?: number;
    error?: string;
    durationMs: number;
}): string => (
    `at=${new Date(entry.at).toISOString()}`
    + ` provider=${entry.provider}`
    + ` model=${entry.model}`
    + ` trigger=${entry.trigger}`
    + ` ok=${entry.ok ? 'yes' : 'no'}`
    + ` stage=${entry.stage}`
    + (entry.status ? ` status=${entry.status}` : '')
    + ` duration=${entry.durationMs}ms`
    + (entry.error ? ` error=${entry.error}` : '')
);

export const buildDiagnosticReport = async (): Promise<string> => {
    const appVersion = typeof __APP_VERSION__ === 'undefined' ? 'unknown' : __APP_VERSION__;
    const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }).Capacitor;
    const lines: string[] = [
        '### Folia diagnostics',
        '',
        '```text',
        `generated: ${new Date().toISOString()}`,
        `app: ${appVersion}`,
        `platform: ${capacitor?.getPlatform?.() ?? 'web'}${capacitor?.isNativePlatform?.() ? ' (native)' : ''}`,
        `user agent: ${typeof navigator === 'undefined' ? '' : navigator.userAgent}`,
        `viewport: ${typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`}`,
        '',
        // 挖孔/刘海适配的现场：cutout mode、是否有挖孔、安全区矩形。
        'display cutout:',
        ...(await readDisplayCutoutLines()),
        '',
        'session storage:',
        `  qq session: ${readLocalStorageFlag('online_provider:qq:cookie')}`,
        `  netease session: ${readLocalStorageFlag('online_provider:netease:cookie')}`,
        `  kugou session: ${readLocalStorageFlag('online_provider:kugou:cookie')}`,
        '',
        // 底部控制条被误改到画面中间时，这两个值就是原因，所以一并导出。
        'ui settings:',
        `  bottom bar offset: ${readLocalStorageValue('player_bottom_bar_offset')} (base 32, max scales with viewport height)`,
        `  phone fit: ${readLocalStorageValue('folia_android_phone_fit')}`,
        `  phone fit orientation: ${readLocalStorageValue('folia_android_phone_fit_orientation')}`,
        `  command palette auto hide: ${readLocalStorageValue('auto_hide_command_palette_button')}`,
        `  hide player progress bar: ${readLocalStorageValue('hide_player_progress_bar')}`,
        '',
        'playback continuity:',
        ...readPlaybackContinuityLines(),
        '',
        'bottom bar geometry:',
        ...readBottomBarGeometry(),
        '',
        'ai theme generation:',
        ...readAiThemeGenerationLines(),
        '',
        'library request trace:',
    ];

    const libraryLines = getLibraryTraceLines();
    lines.push(...(libraryLines.length ? libraryLines.map(line => `  ${line}`) : ['  (none)']));

    const qrLines = getQrLoginTraceLines('qq');
    if (qrLines.length) {
        lines.push('', 'last qq login trace:');
        lines.push(...qrLines.map(line => `  ${line}`));
    }

    const crashEntries = await readCrashDiagnostics().catch(() => []);
    lines.push('', 'crash diagnostics:');
    if (crashEntries.length === 0) {
        lines.push('  (none)');
    } else {
        crashEntries.slice(-5).forEach((entry, index) => {
            lines.push(
                `  [${index + 1}] at=${new Date(entry.at).toISOString()}`
                + ` source=${entry.source}`
                + ` thread=${entry.thread || 'unknown'}`
                + ` type=${entry.type}`,
                `      message=${entry.message || '(empty)'}`,
            );
            if (entry.stack) {
                const stackLines = entry.stack.split(/\r?\n/).slice(0, 8);
                lines.push(...stackLines.map(line => `      ${line}`));
            }
        });
    }

    const playbackDiagnostics = await readNativePlaybackDiagnostics();
    lines.push('', 'lock screen artwork:');
    if (!playbackDiagnostics) {
        lines.push('  (native diagnostics unavailable)');
    } else {
        lines.push(`  cover: ${playbackDiagnostics.cover || '(none)'}`);
        lines.push(`  status: ${playbackDiagnostics.status || 'unknown'}`);
        lines.push(`  detail: ${playbackDiagnostics.detail || '(empty)'}`);
        lines.push(`  applied: ${playbackDiagnostics.applied ? 'yes' : 'no'}`);
        lines.push(`  at: ${playbackDiagnostics.at ? new Date(playbackDiagnostics.at).toISOString() : '(not recorded)'}`);
    }

    lines.push('```');
    return lines.join('\n');
};

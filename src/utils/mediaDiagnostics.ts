import { noteLibraryStep } from '../nativeBridge/api/libraryTrace.js';

// src/utils/mediaDiagnostics.ts
// 播放链路的现场记录：搜索/取链成功之后，真正的失败点往往在 <audio> 加载这一步，而那里
// 既没有报错也没有日志。诊断报告里能区分「没拿到地址」和「拿到了但元素加载不了」。

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
    kind: 'error' | 'canplay' | 'stalled',
    target: HTMLAudioElement | null | undefined,
): void => {
    const element = target;
    if (!element) return;
    const src = element.currentSrc || element.getAttribute('src') || '';
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

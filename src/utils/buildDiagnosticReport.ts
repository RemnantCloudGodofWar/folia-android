import { getLibraryTraceLines } from '../nativeBridge/api/libraryTrace.js';
import { getQrLoginTraceLines } from '../nativeBridge/api/qrLoginTrace.js';

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
        'session storage:',
        `  qq session: ${readLocalStorageFlag('online_provider:qq:cookie')}`,
        `  netease session: ${readLocalStorageFlag('online_provider:netease:cookie')}`,
        `  kugou session: ${readLocalStorageFlag('online_provider:kugou:cookie')}`,
        '',
        // 底部控制条被误改到画面中间时，这两个值就是原因，所以一并导出。
        'ui settings:',
        `  bottom bar offset: ${readLocalStorageValue('player_bottom_bar_offset')} (base 32, max scales with viewport height)`,
        `  command palette auto hide: ${readLocalStorageValue('auto_hide_command_palette_button')}`,
        `  hide player progress bar: ${readLocalStorageValue('hide_player_progress_bar')}`,
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

    lines.push('```');
    return lines.join('\n');
};

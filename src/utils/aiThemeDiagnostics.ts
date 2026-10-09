// src/utils/aiThemeDiagnostics.ts
// AI 主题生成的最近记录。给「设置 → 帮助 → 复制诊断数据」导出用，只保留可公开的字段：
// provider、模型、触发方式、阶段、HTTP 状态、截断后的错误原文与耗时。
// 不记录提示词、歌词原文、请求体、API Key 或 cookie。

const MAX_ENTRIES = 12;
const MAX_ERROR_LENGTH = 300;

export type AiThemeTrigger = 'manual' | 'auto' | 'unknown';

export type AiThemeStage =
    | 'request'
    | 'empty-response'
    | 'parse'
    | 'sanitize'
    | 'web-endpoint'
    | 'unknown';

export type AiThemeDiagnosticsEntry = {
    at: number;
    provider: string;
    model: string;
    trigger: AiThemeTrigger;
    stage: AiThemeStage;
    ok: boolean;
    status?: number;
    error?: string;
    durationMs: number;
};

const entries: AiThemeDiagnosticsEntry[] = [];

const truncate = (value: string): string => (
    value.length > MAX_ERROR_LENGTH ? `${value.slice(0, MAX_ERROR_LENGTH)}…` : value
);

export const recordAiThemeAttempt = (entry: {
    provider: string;
    model?: string;
    trigger?: AiThemeTrigger;
    stage?: AiThemeStage;
    ok: boolean;
    status?: number;
    error?: string;
    durationMs: number;
}): void => {
    entries.push({
        at: Date.now(),
        provider: entry.provider || 'unknown',
        model: entry.model || '(default)',
        trigger: entry.trigger ?? 'unknown',
        stage: entry.stage ?? 'unknown',
        ok: entry.ok,
        status: entry.status,
        error: entry.error ? truncate(entry.error) : undefined,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
    });
    if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES);
    }
};

/** 最近一次记录，无论成功还是失败；没有记录时返回 null。 */
export const readLastAiThemeAttempt = (): AiThemeDiagnosticsEntry | null => (
    entries.length ? entries[entries.length - 1] : null
);

/** 最近若干条记录，按时间从早到晚。 */
export const readAiThemeAttempts = (): AiThemeDiagnosticsEntry[] => [...entries];

/** 只保留失败记录，便于报告里直接看「偶尔报错」的那几次。 */
export const readFailedAiThemeAttempts = (): AiThemeDiagnosticsEntry[] => (
    entries.filter(entry => !entry.ok)
);

export const clearAiThemeDiagnostics = (): void => {
    entries.length = 0;
};

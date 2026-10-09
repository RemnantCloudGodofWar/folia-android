import { describe, expect, it, beforeEach } from 'vitest';
import {
    clearAiThemeDiagnostics,
    readAiThemeAttempts,
    readFailedAiThemeAttempts,
    readLastAiThemeAttempt,
    recordAiThemeAttempt,
    recordAiThemeSkip,
} from '@/utils/aiThemeDiagnostics';

// test/unit/diagnostics/aiThemeDiagnostics.test.ts

describe('aiThemeDiagnostics', () => {
    beforeEach(() => {
        clearAiThemeDiagnostics();
    });

    it('returns null before anything is recorded', () => {
        expect(readLastAiThemeAttempt()).toBeNull();
        expect(readAiThemeAttempts()).toEqual([]);
    });

    it('keeps the newest entry as the last attempt and separates failures', () => {
        recordAiThemeAttempt({ provider: 'gemini', trigger: 'manual', ok: true, durationMs: 120 });
        recordAiThemeAttempt({
            provider: 'gemini',
            trigger: 'manual',
            stage: 'request',
            ok: false,
            status: 429,
            error: 'Gemini API error (429): quota',
            durationMs: 340,
        });

        const last = readLastAiThemeAttempt();
        expect(last?.ok).toBe(false);
        expect(last?.status).toBe(429);
        expect(readAiThemeAttempts()).toHaveLength(2);
        expect(readFailedAiThemeAttempts()).toHaveLength(1);
    });

    it('caps the ring buffer and truncates very long errors', () => {
        const longError = 'x'.repeat(1000);
        for (let index = 0; index < 20; index += 1) {
            recordAiThemeAttempt({ provider: 'openai', ok: false, error: longError, durationMs: index });
        }

        const attempts = readAiThemeAttempts();
        expect(attempts).toHaveLength(12);
        expect(attempts[attempts.length - 1].error?.length).toBeLessThanOrEqual(301);
    });

    // 「按了生成按钮却什么都没发生」以前在报告里是空白（attempts=0），跳过也要留痕。
    it('records a skipped generation with its reason', () => {
        recordAiThemeSkip('source-cover', 'manual');
        recordAiThemeSkip('empty-prompt', 'auto');

        const attempts = readAiThemeAttempts();
        expect(attempts).toHaveLength(2);
        expect(attempts[0].stage).toBe('skipped');
        expect(attempts[0].provider).toBe('skipped');
        expect(attempts[0].error).toBe('source-cover');
        expect(attempts[0].trigger).toBe('manual');
        expect(attempts[1].error).toBe('empty-prompt');
        expect(attempts[1].durationMs).toBe(0);
    });
});

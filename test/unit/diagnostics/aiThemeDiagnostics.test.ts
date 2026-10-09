import { describe, expect, it, beforeEach } from 'vitest';
import {
    clearAiThemeDiagnostics,
    readAiThemeAttempts,
    readFailedAiThemeAttempts,
    readLastAiThemeAttempt,
    recordAiThemeAttempt,
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
});

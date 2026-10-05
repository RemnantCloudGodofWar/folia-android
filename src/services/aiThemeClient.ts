// src/services/aiThemeClient.ts
// 设备本地直连 AI 服务生成主题：安卓上请求经原生 OkHttp 桥转发（绕开 CORS），
// 其他平台用普通 fetch。提示词与 api/generate-theme.js 共用同一份。

import type { DualTheme } from '../types';
import { sanitizeDualTheme } from './themeSanitizer';
import { applyStoredAnimationIntensityToDualTheme } from './themePreferences';
import { parseAiThemeJsonInput } from '../utils/aiThemePrompts';
import { createAiFetch } from './aiNativeFetch';
import { readAiSettings } from './aiSettings';
// @ts-ignore -- 共享的纯 ESM 模块，无类型声明。
import { THEME_GENERATION_PROMPT_PREFIX, buildThemeSourcePrompt } from '../../shared/themeGenerationPrompt.mjs';
// @ts-ignore -- 共享的纯 ESM 模块，无类型声明。
import { detectOpenAICompatibleProvider, sendOpenAICompatibleRequest } from '../../shared/openAICompatibleRequest.mjs';

export const GEMINI_THEME_ENDPOINT =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_OPENAI_TEMPERATURE = 0.7;
const THEME_MAX_OUTPUT_TOKENS = 4096;

/** 用户填的可能是基址、`/v1` 或完整地址，统一补成 chat/completions。 */
export const normalizeChatCompletionsUrl = (rawUrl: string): string => {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return DEFAULT_OPENAI_CHAT_COMPLETIONS_URL;
    try {
        const parsed = new URL(trimmed);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');
        if (!normalizedPath || normalizedPath === '/') {
            parsed.pathname = '/v1/chat/completions';
            return parsed.toString();
        }
        if (/\/v\d+$/.test(normalizedPath)) {
            parsed.pathname = `${normalizedPath}/chat/completions`;
            return parsed.toString();
        }
        parsed.pathname = normalizedPath;
        return parsed.toString();
    } catch {
        return trimmed.replace(/\/+$/, '');
    }
};

const resolveOpenAiModel = (apiUrl: string, configuredModel: string): string => {
    const trimmed = String(configuredModel || '').trim();
    if (trimmed) return trimmed;
    try {
        const hostname = new URL(apiUrl).hostname.toLowerCase();
        if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
            return DEEPSEEK_DEFAULT_MODEL;
        }
    } catch {
        // 解析失败时用通用默认值。
    }
    return DEFAULT_OPENAI_MODEL;
};

const resolveTemperature = (value: string): number => {
    const temperature = Number.parseFloat(String(value ?? '').trim());
    return Number.isFinite(temperature) && temperature >= 0 && temperature <= 2
        ? temperature
        : DEFAULT_OPENAI_TEMPERATURE;
};

const readErrorDetail = async (response: Response): Promise<string> => {
    const rawText = await response.text().catch(() => '');
    try {
        const parsed = JSON.parse(rawText);
        const error = parsed?.error;
        if (typeof error === 'string') return error;
        if (typeof error?.message === 'string') return error.message;
        if (typeof parsed?.message === 'string') return parsed.message;
    } catch {
        // 非 JSON 响应原样返回。
    }
    return rawText.trim();
};

const extractOpenAiText = (message: unknown): string => {
    const messageRecord = (message ?? {}) as { content?: unknown };
    if (typeof messageRecord.content === 'string') return messageRecord.content;
    if (Array.isArray(messageRecord.content)) {
        return messageRecord.content
            .filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text')
            .map((part) => String((part as { text?: unknown }).text ?? ''))
            .join('');
    }
    return '';
};

const requestGeminiThemeJson = async (systemPrompt: string, sourcePrompt: string): Promise<string> => {
    const settings = readAiSettings();
    const apiKey = settings.geminiApiKey.trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

    const response = await createAiFetch()(GEMINI_THEME_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: sourcePrompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
        }),
    });

    if (!response.ok) {
        const detail = await readErrorDetail(response);
        throw new Error(`Gemini API error (${response.status})${detail ? `: ${detail}` : ''}`);
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
        ? parts.find((part: unknown) => part && typeof (part as { text?: unknown }).text === 'string')
        : null;
    const jsonText = text ? String((text as { text: string }).text) : '';
    if (!jsonText) throw new Error('Model returned an empty response');
    return jsonText;
};

const requestOpenAiThemeJson = async (systemPrompt: string, sourcePrompt: string): Promise<string> => {
    const settings = readAiSettings();
    const apiKey = settings.openaiApiKey.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

    const apiUrl = normalizeChatCompletionsUrl(settings.openaiApiUrl);
    const model = resolveOpenAiModel(apiUrl, settings.openaiApiModel);
    const provider = detectOpenAICompatibleProvider(apiUrl);

    const response = await sendOpenAICompatibleRequest({
        apiUrl,
        provider,
        body: {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: sourcePrompt },
            ],
            temperature: resolveTemperature(settings.openaiApiTemperature),
            max_tokens: THEME_MAX_OUTPUT_TOKENS,
            // 只有 OpenAI 自己接受 json_schema，其余兼容端点统一要普通 JSON 模式。
            response_format: { type: 'json_object' },
        },
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
        },
        fetchImpl: createAiFetch(),
    });

    if (!response.ok) {
        const detail = await readErrorDetail(response);
        throw new Error(`OpenAI compatible API error (${response.status})${detail ? `: ${detail}` : ''}`);
    }

    const data = await response.json();
    const text = extractOpenAiText(data?.choices?.[0]?.message);
    if (!text.trim()) throw new Error('Model returned an empty response');
    return text;
};

/**
 * 用用户自己配置的服务商生成主题。
 * 抛出的错误消息与桌面版一致，`isMissingAiApiKeyError` 才能识别「还没填 Key」。
 */
export const generateThemeWithConfiguredAi = async (
    lyricsText: string,
    options?: { isPureMusic?: boolean; songTitle?: string },
): Promise<DualTheme> => {
    const settings = readAiSettings();
    const snippet = String(lyricsText || '').slice(0, 2000);
    const sourcePrompt = buildThemeSourcePrompt(snippet, options?.isPureMusic === true, options?.songTitle);

    const rawJson = settings.provider === 'openai'
        ? await requestOpenAiThemeJson(THEME_GENERATION_PROMPT_PREFIX, sourcePrompt)
        : await requestGeminiThemeJson(THEME_GENERATION_PROMPT_PREFIX, sourcePrompt);

    const parsed = parseAiThemeJsonInput(rawJson);
    const theme = sanitizeDualTheme(parsed as DualTheme);
    return applyStoredAnimationIntensityToDualTheme(theme);
};

export interface AiConnectionTestResult {
    ok: boolean;
    durationMs: number;
    status?: number;
    model?: string;
    reply?: string;
    error?: string;
}

const summarizeError = (error: unknown): string => (
    error instanceof Error ? error.message : String(error ?? '')
);

/**
 * 「测试连接」：发一句 hello，回显模型回复或失败原因。
 * 读的是已保存的设置——表单是即改即存的，所以等价于测试当前填的内容。
 */
export const testConfiguredAiConnection = async (): Promise<AiConnectionTestResult> => {
    const startedAt = Date.now();
    const settings = readAiSettings();

    try {
        if (settings.provider === 'openai') {
            const apiKey = settings.openaiApiKey.trim();
            if (!apiKey) {
                return { ok: false, durationMs: 0, error: 'OPENAI_API_KEY is not configured' };
            }
            const apiUrl = normalizeChatCompletionsUrl(settings.openaiApiUrl);
            const model = resolveOpenAiModel(apiUrl, settings.openaiApiModel);
            const response = await sendOpenAICompatibleRequest({
                apiUrl,
                provider: detectOpenAICompatibleProvider(apiUrl),
                body: {
                    model,
                    messages: [{ role: 'user', content: 'hello' }],
                    max_tokens: 256,
                },
                init: {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`,
                    },
                },
                fetchImpl: createAiFetch(),
            });
            const durationMs = Date.now() - startedAt;
            if (!response.ok) {
                const detail = await readErrorDetail(response);
                return {
                    ok: false,
                    durationMs,
                    status: response.status,
                    model,
                    error: detail || `HTTP ${response.status}`,
                };
            }
            const data = await response.json();
            return {
                ok: true,
                durationMs,
                status: response.status,
                model,
                reply: extractOpenAiText(data?.choices?.[0]?.message).trim().slice(0, 200),
            };
        }

        const apiKey = settings.geminiApiKey.trim();
        if (!apiKey) {
            return { ok: false, durationMs: 0, error: 'GEMINI_API_KEY is not configured' };
        }
        const response = await createAiFetch()(GEMINI_THEME_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'hello' }] }] }),
        });
        const durationMs = Date.now() - startedAt;
        if (!response.ok) {
            const detail = await readErrorDetail(response);
            return {
                ok: false,
                durationMs,
                status: response.status,
                model: 'gemini-3-flash-preview',
                error: detail || `HTTP ${response.status}`,
            };
        }
        const data = await response.json();
        const parts = data?.candidates?.[0]?.content?.parts;
        const reply = Array.isArray(parts)
            ? parts
                .filter((part: unknown) => part && typeof (part as { text?: unknown }).text === 'string')
                .map((part: { text: string }) => part.text)
                .join('')
            : '';
        return {
            ok: true,
            durationMs,
            status: response.status,
            model: 'gemini-3-flash-preview',
            reply: reply.trim().slice(0, 200),
        };
    } catch (error) {
        return { ok: false, durationMs: Date.now() - startedAt, error: summarizeError(error) };
    }
};

import { describe, expect, it } from 'vitest';
import { extractOpenAiText } from '@/services/aiThemeClient';

// test/unit/theme/aiThemeClientText.test.ts
// 现场报告里 AI 主题 6 次全部失败在「Model returned an empty response」，而响应是 HTTP 200。
// 这里固定住「有响应但 content 为空」的三种形态：推理字段、内容分片、老式 completions 形状。

const THEME_JSON = '{"light":{"name":"a"},"dark":{"name":"b"}}';

describe('extractOpenAiText', () => {
    it('reads a plain string content', () => {
        expect(extractOpenAiText({ content: THEME_JSON }, {})).toBe(THEME_JSON);
    });

    it('joins text parts of a content array', () => {
        expect(extractOpenAiText({
            content: [{ type: 'text', text: '{"light":' }, { type: 'text', text: '{"name":"a"}}' }],
        }, {})).toBe('{"light":{"name":"a"}}');
    });

    // 推理型模型/网关会把答案放在 reasoning 字段里，content 整个为空 —— 这正是「空响应」的常见来源。
    it('falls back to the reasoning fields when content is empty', () => {
        expect(extractOpenAiText({ content: '', reasoning_content: THEME_JSON }, {})).toBe(THEME_JSON);
        expect(extractOpenAiText({ content: '   ', reasoning: THEME_JSON }, {})).toBe(THEME_JSON);
        expect(extractOpenAiText({ reasoning_content: '先想想……' }, {})).toBe('先想想……');
    });

    it('accepts the legacy completions shape', () => {
        expect(extractOpenAiText(undefined, { text: THEME_JSON })).toBe(THEME_JSON);
    });

    it('returns an empty string when nothing usable is present', () => {
        expect(extractOpenAiText({}, { finish_reason: 'length' })).toBe('');
        expect(extractOpenAiText(null, null)).toBe('');
    });
});

import { describe, expect, it } from 'vitest';
import { resolveKgQrTimeoutAsWaiting } from '@/nativeBridge/api/kugou.js';

// test/unit/onlineMusic/kugouQrTimeout.test.ts
// 现场报告：酷狗扫码轮询被安卓桥的 15 秒上限误杀（`Bridged request timed out after 15000ms`
// @ login-user.kugou.com/v2/get_userinfo_qrcode），前端直接判成 check-error、会话作废。
// 这个端点本来就是长轮询，超时只代表「还没扫码」，前几次要按等待处理。

describe('KuGou QR long-poll timeout policy', () => {
    it('keeps polling through the first consecutive timeouts', () => {
        expect(resolveKgQrTimeoutAsWaiting(1)).toBe(true);
        expect(resolveKgQrTimeoutAsWaiting(2)).toBe(true);
    });

    it('reports a real failure once the budget is exhausted', () => {
        expect(resolveKgQrTimeoutAsWaiting(3)).toBe(false);
        expect(resolveKgQrTimeoutAsWaiting(9)).toBe(false);
    });

    it('honours an explicit budget', () => {
        expect(resolveKgQrTimeoutAsWaiting(0, 1)).toBe(true);
        expect(resolveKgQrTimeoutAsWaiting(1, 1)).toBe(false);
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmNeteaseSessionLoss } from '@/services/onlineMusic/neteaseSessionLoss';
import type { ProviderUser } from '@/types/onlineMusic';

// test/unit/services/neteaseSessionLoss.test.ts
// 「网易云自己退出登录」：一次 login_status 没拿到 profile 不足以判定掉登录（清会话要重新扫码），
// 必须再确认一次；第二次也没有才允许调用方清。

const user = { id: '42', nickname: 'tester' } as ProviderUser;

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('confirmNeteaseSessionLoss', () => {
    it('treats a successful re-check as still logged in', async () => {
        const readStatus = vi.fn(async () => user);

        await expect(confirmNeteaseSessionLoss(readStatus, 0)).resolves.toBe(user);
        expect(readStatus).toHaveBeenCalledTimes(1);
    });

    it('confirms the loss only when the re-check also reports nothing', async () => {
        const readStatus = vi.fn(async () => null);

        await expect(confirmNeteaseSessionLoss(readStatus, 0)).resolves.toBeNull();
    });

    it('does not confirm a loss when the re-check fails with an error', async () => {
        const readStatus = vi.fn(async () => { throw new Error('network down'); });

        await expect(confirmNeteaseSessionLoss(readStatus, 0)).resolves.toBeNull();
    });

    it('waits before re-checking so a momentary blip can pass', async () => {
        vi.useFakeTimers();
        const readStatus = vi.fn(async () => user);
        const pending = confirmNeteaseSessionLoss(readStatus, 500);

        await Promise.resolve();
        expect(readStatus).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(500);
        await expect(pending).resolves.toBe(user);
        expect(readStatus).toHaveBeenCalledTimes(1);
    });
});

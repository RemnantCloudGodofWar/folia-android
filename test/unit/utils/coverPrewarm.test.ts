import { afterEach, describe, expect, it, vi } from 'vitest';
import { prewarmCoverImage, resetCoverPrewarmCache } from '@/utils/coverPrewarm';

// test/unit/utils/coverPrewarm.test.ts
// 「一打开专辑封面就卡一下」的预处理：换歌时先解码要显示的封面，把解码/首次纹理上传的代价
// 从「用户点开那一帧」挪到「换歌那一刻」。

type FakeImageInstance = { src: string; decoding: string; fetchPriority?: string; decoded: boolean };

const stubImage = ({ withDecode = true } = {}) => {
    const created: FakeImageInstance[] = [];
    class FakeImage {
        src = '';
        decoding = '';
        fetchPriority = '';
        decoded = false;
        decode?: () => Promise<void>;

        constructor() {
            if (withDecode) this.decode = () => { this.decoded = true; return Promise.resolve(); };
            created.push(this as unknown as FakeImageInstance);
        }
    }
    vi.stubGlobal('Image', FakeImage);
    return created;
};

afterEach(() => {
    vi.unstubAllGlobals();
    resetCoverPrewarmCache();
});

describe('cover prewarm', () => {
    it('decodes a cover once per url, asynchronously and at low priority', () => {
        const created = stubImage();

        prewarmCoverImage('https://p1.music.126.net/cover.jpg?param=512y512');
        prewarmCoverImage('https://p1.music.126.net/cover.jpg?param=512y512');

        // 同一张封面重复调用只解码一次
        expect(created).toHaveLength(1);
        expect(created[0].src).toContain('p1.music.126.net');
        expect(created[0].decoding).toBe('async');
        expect(created[0].fetchPriority).toBe('low');
    });

    it('ignores empty urls', () => {
        const created = stubImage();

        prewarmCoverImage(null);
        prewarmCoverImage(undefined);
        prewarmCoverImage('');

        expect(created).toHaveLength(0);
    });

    it('does not throw when the runtime has no decode()', () => {
        const created = stubImage({ withDecode: false });

        expect(() => prewarmCoverImage('https://p1.music.126.net/cover.jpg')).not.toThrow();
        expect(created).toHaveLength(1);
        expect(created[0].src).toContain('music.126.net');
    });

    it('keeps the remembered url list bounded', () => {
        const created = stubImage();

        for (let index = 0; index < 40; index += 1) {
            prewarmCoverImage(`https://p1.music.126.net/cover-${index}.jpg`);
        }
        // 40 张都解码过（上限只限制「记住多少张」，不影响预热）
        expect(created).toHaveLength(40);

        // 最早的已被淘汰，可再次预热；最近的仍在记忆里，不会重复。
        prewarmCoverImage('https://p1.music.126.net/cover-0.jpg');
        prewarmCoverImage('https://p1.music.126.net/cover-39.jpg');
        expect(created).toHaveLength(41);
    });
});

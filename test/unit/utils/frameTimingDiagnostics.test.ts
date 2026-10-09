import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    classifyRenderHealth,
    computeFrameStats,
    describeCpuIndex,
    describeDeviceClass,
    estimateRefreshRateHz,
    readFrameTimingSnapshot,
    resetFrameTimingDiagnostics,
    runCpuProbe,
} from '@/utils/frameTimingDiagnostics';

afterEach(() => {
    vi.restoreAllMocks();
    resetFrameTimingDiagnostics();
});

describe('frameTimingDiagnostics', () => {
    it('summarises frame intervals into percentiles and dropped-frame buckets', () => {
        const intervals = [
            ...Array.from({ length: 90 }, () => 16.7),
            ...Array.from({ length: 8 }, () => 40),
            140,
        ];

        const stats = computeFrameStats(intervals);

        expect(stats.count).toBe(99);
        expect(stats.p50Ms).toBe(16.7);
        expect(stats.maxMs).toBe(140);
        // 40ms 与 140ms 都超过 32ms，但只有 140ms 超过 50 和 100。
        expect(stats.slowCount).toBe(9);
        expect(stats.jankCount).toBe(1);
        expect(stats.freezeCount).toBe(1);
    });

    it('reads an empty sample set as unknown instead of zero', () => {
        const stats = computeFrameStats([]);

        expect(stats.count).toBe(0);
        expect(stats.p95Ms).toBeNull();
        expect(classifyRenderHealth(stats, 60)).toBe('unknown');
    });

    it('guesses the display refresh rate from the typical interval', () => {
        const atSixty = Array.from({ length: 120 }, () => 16.7);
        const atOneTwenty = Array.from({ length: 120 }, () => 8.3);

        expect(estimateRefreshRateHz(atSixty)).toBe(60);
        expect(estimateRefreshRateHz(atOneTwenty)).toBe(120);
        expect(estimateRefreshRateHz([16.7, 16.8])).toBeNull();
    });

    it('separates smooth rendering from heavy jank at the display budget', () => {
        const smooth = computeFrameStats(Array.from({ length: 300 }, () => 16.7));
        const heavy = computeFrameStats([
            ...Array.from({ length: 260 }, () => 16.7),
            ...Array.from({ length: 40 }, () => 70),
        ]);

        expect(classifyRenderHealth(smooth, 60)).toBe('smooth');
        expect(classifyRenderHealth(heavy, 60)).toBe('heavy');
    });

    it('classifies device capability from cores and memory', () => {
        expect(describeDeviceClass(8, 8)).toBe('high');
        expect(describeDeviceClass(8, 4)).toBe('mid');
        expect(describeDeviceClass(4, 2)).toBe('low');
        expect(describeDeviceClass(null, null)).toBe('unknown');
    });

    it('runs the cpu probe and reports a comparable index', () => {
        const result = runCpuProbe(40);

        expect(result.ops).toBeGreaterThan(0);
        expect(result.durationMs).toBeGreaterThan(0);
        expect(result.opsPerSecond).toBeGreaterThan(0);
        expect(['fast', 'moderate', 'slow']).toContain(result.index);
        expect(describeCpuIndex(200e6)).toBe('fast');
        expect(describeCpuIndex(50e6)).toBe('moderate');
        expect(describeCpuIndex(10e6)).toBe('slow');
        expect(describeCpuIndex(Number.NaN)).toBe('unknown');
    });

    it('reports an uninstalled sampler without throwing off the browser', () => {
        // 单测跑在 node 环境：没有 window / requestAnimationFrame，安装应当直接跳过。
        const snapshot = readFrameTimingSnapshot();

        expect(snapshot.installed).toBe(false);
        expect(snapshot.frameCount).toBe(0);
        expect(snapshot.renderHealth).toBe('unknown');
        expect(snapshot.longTasks.count).toBe(0);
    });
});

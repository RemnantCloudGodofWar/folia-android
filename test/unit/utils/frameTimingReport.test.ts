// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetFrameTimingDiagnostics } from '@/utils/frameTimingDiagnostics';
import { notePlaybackStreamInfo } from '@/utils/mediaDiagnostics';
import { buildDiagnosticReport } from '@/utils/buildDiagnosticReport';

afterEach(() => {
    vi.restoreAllMocks();
    resetFrameTimingDiagnostics();
    localStorage.clear();
});

describe('diagnostic report frame timing section', () => {
    it('exports the frame timing evidence and its attribution', async () => {
        notePlaybackStreamInfo({
            provider: 'netease',
            requestedLevel: 'exhigh',
            resolvedLevel: 'exhigh',
            bitrateKbps: 320,
            format: 'mp3',
            host: 'm801.music.126.net',
        });
        const report = await buildDiagnosticReport();
        const lines = report.split('\n');

        expect(lines).toContain('frame timing:');
        const section = lines.slice(lines.indexOf('frame timing:'));
        const lineFor = (prefix: string): string => (
            section.find(line => line.trimStart().startsWith(prefix)) ?? ''
        );

        expect(lineFor('sampler:')).toContain('frames=');
        expect(lineFor('device:')).toMatch(/cores=.*memory=.*class=(low|mid|high|unknown)/);
        expect(lineFor('frame time:')).toContain('p95=');
        expect(lineFor('dropped frames:')).toContain('jank>50ms=');
        expect(lineFor('long tasks')).toContain('count=');
        expect(lineFor('cpu probe:')).toContain('index=');
        expect(lineFor('render health:')).toMatch(/smooth|mild|heavy|unknown/);
        expect(lineFor('attribution:')).toContain('cpu=');

        // 「歌卡」排查需要的音频侧证据：解析到的流、播放中被改过位置/速率、解码进度。
        const continuity = lines.slice(lines.indexOf('playback continuity:'), lines.indexOf('frame timing:'));
        const continuityLine = (prefix: string) => continuity.find(line => line.trimStart().startsWith(prefix)) ?? '';
        expect(continuityLine('stream:')).toContain('level=');
        expect(continuityLine('element events:')).toContain('seeking=');
        expect(continuityLine('decode:')).toContain('bytes=');
    });
});

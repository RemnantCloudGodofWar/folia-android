// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetFrameTimingDiagnostics } from '@/utils/frameTimingDiagnostics';
import { buildDiagnosticReport } from '@/utils/buildDiagnosticReport';

afterEach(() => {
    vi.restoreAllMocks();
    resetFrameTimingDiagnostics();
    localStorage.clear();
});

describe('diagnostic report frame timing section', () => {
    it('exports the frame timing evidence and its attribution', async () => {
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
    });
});

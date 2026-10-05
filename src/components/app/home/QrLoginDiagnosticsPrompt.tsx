import { useState } from 'react';
import { Check, ClipboardCopy, ExternalLink, Loader2 } from 'lucide-react';

// src/components/app/home/QrLoginDiagnosticsPrompt.tsx
// 扫码登录失败后出现在登录弹窗底部：复制诊断报告，或带着报告去 GitHub 开 issue。
// 报告要等用户点了才生成——里面有一次对主进程的 IPC，失败时自动生成没有意义。

export type QrLoginDiagnosticsPromptProps = {
    prompt: string;
    privacyNote: string;
    copyLabel: string;
    copiedLabel: string;
    copyFailedLabel: string;
    reportLabel: string;
    buildReport: () => Promise<string>;
    buildIssueUrl: (report: string) => string;
    // 紧凑模式只留一个复制按钮，用于扫码等待中也能随时导出诊断。
    compact?: boolean;
};

type CopyState = 'idle' | 'working' | 'copied' | 'failed';

// Electron 里 <a target="_blank"> 会开一个新的 BrowserWindow，必须走主进程交给系统浏览器。
const openExternal = (url: string) => {
    if (window.electron?.openExternalUrl) {
        void window.electron.openExternalUrl(url);
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
};

const QrLoginDiagnosticsPrompt = ({
    prompt,
    privacyNote,
    copyLabel,
    copiedLabel,
    copyFailedLabel,
    reportLabel,
    buildReport,
    buildIssueUrl,
    compact = false,
}: QrLoginDiagnosticsPromptProps) => {
    const [copyState, setCopyState] = useState<CopyState>('idle');

    // 复制与反馈都先把报告放进剪贴板：链接放不下完整报告时，用户在 issue 页直接粘贴即可。
    const copyReport = async (): Promise<string | null> => {
        setCopyState('working');
        let report: string | null = null;
        try {
            report = await buildReport();
            await navigator.clipboard.writeText(report);
            setCopyState('copied');
        } catch (error) {
            console.warn('[ProviderQrLogin] diagnostics:copy-failed', error);
            setCopyState('failed');
        }
        return report;
    };

    const handleReport = async () => {
        const report = await copyReport();
        openExternal(buildIssueUrl(report ?? ''));
    };

    const copyText = copyState === 'copied' ? copiedLabel : copyState === 'failed' ? copyFailedLabel : copyLabel;
    const CopyIcon = copyState === 'working' ? Loader2 : copyState === 'copied' ? Check : ClipboardCopy;

    const copyButton = (
        <button
            type="button"
            onClick={() => void copyReport()}
            disabled={copyState === 'working'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-default"
        >
            <CopyIcon size={12} className={copyState === 'working' ? 'animate-spin' : undefined} />
            {copyText}
        </button>
    );

    if (compact) {
        return (
            <div className="mt-3 flex justify-center">
                {copyButton}
            </div>
        );
    }

    return (
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left">
            <p className="text-[11px] leading-snug opacity-75" style={{ color: 'var(--text-primary)' }}>{prompt}</p>
            <p className="text-[10px] leading-snug opacity-45 mt-1" style={{ color: 'var(--text-secondary)' }}>{privacyNote}</p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
                {copyButton}
                <button
                    type="button"
                    onClick={() => void handleReport()}
                    disabled={copyState === 'working'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-semibold opacity-80 transition-colors disabled:opacity-50 disabled:cursor-default"
                >
                    <ExternalLink size={12} />
                    {reportLabel}
                </button>
            </div>
        </div>
    );
};

export default QrLoginDiagnosticsPrompt;

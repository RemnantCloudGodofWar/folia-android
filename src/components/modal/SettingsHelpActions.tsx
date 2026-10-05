import React, { useState } from 'react';
import { Check, ClipboardCopy, Lightbulb, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// src/components/modal/SettingsHelpActions.tsx

type SettingsHelpActionsProps = {
    onOpenReleaseNotes: () => void;
    onOpenPonder: () => void;
    onCopyDiagnostics: () => Promise<string>;
};

type CopyState = 'idle' | 'working' | 'copied' | 'failed';

const SettingsHelpActions: React.FC<SettingsHelpActionsProps> = ({
    onOpenReleaseNotes,
    onOpenPonder,
    onCopyDiagnostics,
}) => {
    const { t } = useTranslation();
    const [copyState, setCopyState] = useState<CopyState>('idle');

    const handleCopyDiagnostics = async () => {
        setCopyState('working');
        try {
            const report = await onCopyDiagnostics();
            await navigator.clipboard.writeText(report);
            setCopyState('copied');
        } catch (error) {
            console.warn('[Settings] diagnostics:copy-failed', error);
            setCopyState('failed');
        }
    };

    const CopyIcon = copyState === 'working' ? Loader2 : copyState === 'copied' ? Check : ClipboardCopy;

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
                type="button"
                data-testid="help-release-notes"
                onClick={onOpenReleaseNotes}
                className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-left transition-colors hover:bg-white/10"
                style={{ color: 'var(--text-primary)' }}
            >
                <Sparkles size={19} className="shrink-0 opacity-75" aria-hidden="true" />
                <span>
                    <span className="block text-sm font-semibold">{t('help.releaseNotes')}</span>
                    <span className="mt-0.5 block text-xs opacity-55">{t('help.releaseNotesDescription')}</span>
                </span>
            </button>
            <button
                type="button"
                data-testid="help-page-ponder"
                onClick={onOpenPonder}
                className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-left transition-colors hover:bg-white/10"
                style={{ color: 'var(--text-primary)' }}
            >
                <Lightbulb size={19} className="shrink-0 opacity-75" aria-hidden="true" />
                <span>
                    <span className="block text-sm font-semibold">{t('help.ponder')}</span>
                    <span className="mt-0.5 block text-xs opacity-55">{t('help.ponderDescription')}</span>
                </span>
            </button>
            <button
                type="button"
                data-testid="help-copy-diagnostics"
                onClick={() => void handleCopyDiagnostics()}
                disabled={copyState === 'working'}
                className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-left transition-colors hover:bg-white/10 disabled:opacity-50 disabled:cursor-default sm:col-span-2"
                style={{ color: 'var(--text-primary)' }}
            >
                <CopyIcon
                    size={19}
                    className={`shrink-0 opacity-75 ${copyState === 'working' ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                />
                <span>
                    <span className="block text-sm font-semibold">
                        {copyState === 'copied'
                            ? t('help.copyDiagnosticsCopied')
                            : copyState === 'failed'
                                ? t('help.copyDiagnosticsFailed')
                                : t('help.copyDiagnostics')}
                    </span>
                    <span className="mt-0.5 block text-xs opacity-55">{t('help.copyDiagnosticsDescription')}</span>
                </span>
            </button>
        </div>
    );
};

export default SettingsHelpActions;

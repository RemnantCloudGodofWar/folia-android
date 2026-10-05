import type { OnlineProviderId, QrLoginFailureKind } from '../../../types/onlineMusic';
import { buildQrLoginIssueUrl } from '../../../utils/qrLoginDiagnosticReport';
import type { QrLoginDiagnosticsPromptProps } from './QrLoginDiagnosticsPrompt';

// src/components/app/home/buildQrLoginDiagnosticsProps.ts
// 把扫码登录失败的诊断入口翻译成登录弹窗要的 props，Grid3D 只负责在失败时传进来。

export const buildQrLoginDiagnosticsProps = ({
    t,
    providerId,
    failure,
    buildReport,
}: {
    t: (key: string) => string;
    providerId: OnlineProviderId;
    failure: QrLoginFailureKind | null;
    buildReport: () => Promise<string>;
}): QrLoginDiagnosticsPromptProps => ({
    prompt: t(failure === 'expired-after-scan' ? 'home.qrDiagnosticsPromptScanned' : 'home.qrDiagnosticsPrompt'),
    privacyNote: t('home.qrDiagnosticsPrivacy'),
    copyLabel: failure ? t('home.qrDiagnosticsCopy') : t('home.qrDiagnosticsCopyAnytime'),
    copiedLabel: t('home.qrDiagnosticsCopied'),
    copyFailedLabel: t('home.qrDiagnosticsCopyFailed'),
    reportLabel: t('home.qrDiagnosticsReport'),
    // 没失败就只留一个常驻复制按钮，失败时才展开完整说明。
    compact: !failure,
    buildReport,
    buildIssueUrl: report => buildQrLoginIssueUrl({
        providerId,
        report,
        pasteHint: t('home.qrDiagnosticsPasteHint'),
    }),
});

import { Buffer } from 'buffer';
import { installGlobalVisualizerFrameRateLimiter } from './utils/frameRateLimiter';
import { installConsoleLogCapture } from './utils/consoleLogBuffer';
import { installCrashDiagnostics } from './utils/crashDiagnostics';
import { installDebugModule } from './services/debug/debugModule';
import { installMemorySampleFeed } from './services/debug/memorySamples';
import { installFrameTimingDiagnostics } from './utils/frameTimingDiagnostics';
import { installNativeAndroidBridge } from './services/nativeAndroidBridge';
import { installAndroidPhoneFitPreference } from './services/androidPhoneLayout';
import { installKeepScreenOnPreference } from './services/androidKeepScreenOn';
// import { installCoverSizeAudit } from './services/debug/coverSizeSamples';
// @ts-ignore
globalThis.Buffer = Buffer;
// First, so the debug overlay's console tab has the startup lines too - they are where a failure
// to reach a library or restore a session shows up.
installConsoleLogCapture();
installCrashDiagnostics();
// Right after it, so the startup lines reach the runtime log file too and not only the in-memory
// buffer. Both no-op off Electron. See services/debug/debugModule.ts.
installDebugModule();
installMemorySampleFeed();
// 帧耗时 / 长任务采样，供设置里的「复制诊断数据」判断卡顿是渲染开销还是设备性能。
installFrameTimingDiagnostics();
// Cover size audit, left wired but switched off: it answered whether the provider CDNs honour the
// size in a cover URL - they do - and that is not a question worth re-asking every session. The
// collector and its panel are still in the tree, and `?probe=coverSizeAudit` still reaches them.
// To bring the tab back, uncomment this line and the four sites in DevDebugOverlay.tsx. It was dev
// only even then: a packaged build has nothing to do with the answer, so it should not pay the
// observer or the rows it retains.
// if (import.meta.env.DEV) installCoverSizeAudit();
installGlobalVisualizerFrameRateLimiter();
installAndroidPhoneFitPreference();
// 屏幕常亮：启动时套用保存的开关状态（安卓走原生窗口标志）。
installKeepScreenOnPreference();
void installNativeAndroidBridge();

void import('./bootstrap');

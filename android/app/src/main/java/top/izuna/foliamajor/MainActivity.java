package top.izuna.foliamajor;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        CrashDiagnostics.install(getApplicationContext());
        registerPlugin(FoliaNativePlugin.class);
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Let the WebView close its own settings/effects layer first; only a Back with
                // nothing left to close exits the activity.
                if (FoliaNativePlugin.emitBackPressed()) return;
                finish();
            }
        });
        PhoneLayoutOrientation.apply(this);
        PhoneFitCutout.applyFromPreference(this);
        restoreAdaptiveLayout(webView);
        // 启动时窗口焦点和系统栏状态还会变一次，只应用一遍会被后面的 inset 恢复覆盖。
        webView.postDelayed(() -> restoreAdaptiveLayout(webView), 500);
        webView.postDelayed(() -> restoreAdaptiveLayout(webView), 1500);
        webView.postDelayed(() -> PhoneFitCutout.applyFromPreference(this), 500);
        webView.postDelayed(() -> PhoneFitCutout.applyFromPreference(this), 1500);
    }

    @Override
    public void onResume() {
        super.onResume();
        if (getBridge() != null) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.postDelayed(() -> restoreAdaptiveLayout(webView), 100);
            }
        }
        PhoneFitCutout.applyFromPreference(this);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && getBridge() != null) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.post(() -> restoreAdaptiveLayout(webView));
                webView.post(() -> PhoneFitCutout.applyFromPreference(this));
            }
        }
    }

    // 用户在设置里开过「自适应屏幕分辨率」的话，恢复沉浸式全屏。失败时回滚，避免反复启动就崩。
    private void restoreAdaptiveLayout(WebView webView) {
        // 自适应布局的 inset 操作可能重置 cutout 模式，这里统一补一次手机适配的绘制到挖孔区。
        PhoneFitCutout.applyFromPreference(this);
        if (!AdaptiveLayout.isEnabled(this)) return;
        if (!AdaptiveLayout.apply(this, webView, true)) {
            AdaptiveLayout.setEnabled(this, false);
        }
    }
}

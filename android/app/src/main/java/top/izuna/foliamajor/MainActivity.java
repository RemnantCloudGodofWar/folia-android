package top.izuna.foliamajor;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FoliaNativePlugin.class);
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // 用户在设置里开过「自适应屏幕分辨率」的话，启动时就恢复沉浸式全屏。
        // 万一这台设备上应用失败，直接回滚开关，避免每次启动都卡在同一处。
        if (AdaptiveLayout.isEnabled(this) && !AdaptiveLayout.apply(this, webView, true)) {
            AdaptiveLayout.setEnabled(this, false);
        }
    }
}

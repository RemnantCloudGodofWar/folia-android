package top.izuna.foliamajor;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

/**
 * 手机适配模式的「绘制到挖孔区」实现。
 *
 * 安卓默认把内容限制在挖孔/刘海的安全区里，所以屏幕顶部会出现一圈黑边。
 * 手机适配打开的布局已经按紧凑模式排过，允许内容延伸到挖孔区不会压到控件上，
 * 因此这里把窗口的 cutout mode 设为 shortEdges，让 WebView 真正铺满整块屏幕。
 *
 * 只在手机适配开启时生效；关闭时恢复系统默认（never），保持平板/桌面布局的原样。
 */
final class PhoneFitCutout {
    private static final String TAG = "FoliaPhoneFitCutout";

    private PhoneFitCutout() {
    }

    /** 按当前手机适配偏好应用 cutout 模式；返回是否成功。 */
    static boolean apply(Activity activity, boolean enabled) {
        if (activity == null) {
            return false;
        }
        try {
            Window window = activity.getWindow();
            if (window == null) {
                return false;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams attributes = window.getAttributes();
                attributes.layoutInDisplayCutoutMode = enabled
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER;
                window.setAttributes(attributes);
            }
            if (enabled) {
                // 黑边来自窗口背景，不只是 WebView。decor 也铺上应用底色，缺口区域才不会是纯黑。
                View decor = window.getDecorView();
                if (decor != null) {
                    decor.setBackgroundColor(Color.BLACK);
                }
            }
            return true;
        } catch (Throwable error) {
            Log.w(TAG, "apply cutout mode failed (enabled=" + enabled + ")", error);
            return false;
        }
    }

    /** 从偏好里读取手机适配状态后应用。 */
    static boolean applyFromPreference(Activity activity) {
        return apply(activity, PhoneLayoutOrientation.isEnabled(activity));
    }
}

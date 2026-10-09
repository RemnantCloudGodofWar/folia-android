package top.izuna.foliamajor;

import android.app.Activity;
import android.graphics.Rect;
import android.os.Build;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * 适配手机厂商的屏幕顶部显示（挖孔 / 刘海 / 曲面）。
 *
 * 安卓默认把窗口限制在「安全区」里，遇到挖孔屏时顶部会留一条黑边。这里把窗口的
 * cutout mode 设为 shortEdges，允许窗口延伸到挖孔两边，让 WebView 铺满整块屏幕。
 *
 * 这条适配不跟「手机适配」开关绑定：挖孔是设备固有的屏幕特征，跟应用内选的布局模式无关。
 * 布局本身仍由应用内的安全区变量避让，所以不会把控件画进挖孔里。
 *
 * 同时提供 {@link #describe(Activity)}，把 cutout mode 与挖孔矩形导出到诊断报告，
 * 方便在「还有黑边」时直接看到系统上报了什么。
 */
final class PhoneFitCutout {
    private static final String TAG = "FoliaPhoneFitCutout";

    private PhoneFitCutout() {
    }

    /**
     * 允许窗口绘制到挖孔两边。
     *
     * 只做这一步，不做「有没有挖孔」的判断：判断要等 root window insets 就绪，启动阶段
     * 拿不到就会漏掉；android:windowLayoutInDisplayCutoutMode 只在 API 35+ 的 manifest
     * 属性才可靠，代码里设置 shortEdges 在没有挖孔的设备上也是安全 no-op。
     */
    static boolean apply(Activity activity) {
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
                attributes.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                window.setAttributes(attributes);
            }
            // 黑边来自窗口背景，不只是 WebView。decor 也铺上应用底色，缺口区域才不会是纯黑。
            View decor = window.getDecorView();
            if (decor != null) {
                decor.setBackgroundColor(0xFF09090B);
            }
            return true;
        } catch (Throwable error) {
            Log.w(TAG, "apply cutout mode failed", error);
            return false;
        }
    }

    /** 挖孔现场，供诊断报告导出。字段固定为英文。 */
    static JSONObject describe(Activity activity) {
        JSONObject result = new JSONObject();
        try {
            result.put("sdk", Build.VERSION.SDK_INT);
            View decor = activity == null || activity.getWindow() == null
                ? null
                : activity.getWindow().getDecorView();
            if (decor == null) {
                result.put("available", false);
                return result;
            }
            result.put("available", true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                result.put(
                    "layoutInDisplayCutoutMode",
                    activity.getWindow().getAttributes().layoutInDisplayCutoutMode
                );
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowInsets insets = decor.getRootWindowInsets();
                DisplayCutout cutout = insets == null ? null : insets.getDisplayCutout();
                result.put("hasCutout", cutout != null);
                if (cutout != null) {
                    result.put(
                        "safeInsets",
                        rect(cutout.getSafeInsetLeft(), cutout.getSafeInsetTop(),
                            cutout.getSafeInsetRight(), cutout.getSafeInsetBottom())
                    );
                    JSONArray rects = new JSONArray();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        List<Rect> bounding = cutout.getBoundingRects();
                        if (bounding != null) {
                            for (Rect rect : bounding) {
                                rects.put(rect(rect.left, rect.top, rect.right, rect.bottom));
                            }
                        }
                    }
                    result.put("boundingRects", rects);
                }
            }
        } catch (Throwable error) {
            Log.w(TAG, "describe cutout failed", error);
        }
        return result;
    }

    private static JSONObject rect(int left, int top, int right, int bottom) throws Exception {
        JSONObject rect = new JSONObject();
        rect.put("left", left);
        rect.put("top", top);
        rect.put("right", right);
        rect.put("bottom", bottom);
        return rect;
    }
}

package top.izuna.foliamajor;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Rect;
import android.os.Build;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

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
 *
 * 只开 cutout mode 还不够：系统栏仍然占着顶部那一条，窗口也只是「允许」画到挖孔区，
 * 并不会主动铺过去。所以这里同时做三件事：
 * 1. layoutInDisplayCutoutMode = shortEdges，允许窗口覆盖挖孔；
 * 2. FLAG_LAYOUT_NO_LIMITS + setDecorFitsSystemWindows(false)，不再为系统栏留位；
 * 3. 状态栏/导航栏透明并隐藏，顶部整条交给 WebView。
 *
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
     * 让窗口铺满整块屏幕，包括系统栏与挖孔所在的顶部区域。
     *
     * 不做「有没有挖孔」的判断：判断要等 root window insets 就绪，启动阶段拿不到就会漏掉；
     * 代码里设置 shortEdges 在没有挖孔的设备上也是安全 no-op。
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
            // 不再为系统栏留位：这是「顶部仍有一条」的直接原因。
            WindowCompat.setDecorFitsSystemWindows(window, false);
            window.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            // 系统栏透明，避免它们在顶部画出一条不透明色带。
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            // 直接隐藏，把整块屏幕交给 WebView；用户从边缘划入时临时显示。
            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            // 黑边来自窗口背景，不只是 WebView。decor 也铺上应用底色，缺口区域才不会是纯黑。
            View decor = window.getDecorView();
            if (decor != null) {
                decor.setBackgroundColor(0xFF09090B);
                // 部分 ROM 会把 inset 写进 decor 的 padding，清掉它窗口才真的铺到顶。
                decor.setPadding(0, 0, 0, 0);
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
            // 窗口/屏幕高度对比：相差多少就是顶部那条黑边（状态栏 + 挖孔）的高度。
            android.util.DisplayMetrics metrics = activity.getResources().getDisplayMetrics();
            result.put("screenHeightDp", metrics.heightPixels);
            result.put("decorHeightPx", decor.getHeight());
            android.graphics.Rect windowFrame = new android.graphics.Rect();
            activity.getWindow().getDecorView().getWindowVisibleDisplayFrame(windowFrame);
            result.put("visibleFrame", rect(windowFrame.left, windowFrame.top, windowFrame.right, windowFrame.bottom));
            View content = decor.findViewById(android.R.id.content);
            if (content != null) {
                result.put("contentHeightPx", content.getHeight());
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

package top.izuna.foliamajor;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Keeps a small, bounded crash trail for the diagnostics report.
 *
 * The default Android handler still receives the exception after this recorder runs. This class
 * only persists enough context for the next app launch; it never swallows the crash.
 */
public final class CrashDiagnostics {
    private static final String PREFS = "folia_crash_diagnostics";
    private static final String KEY_HISTORY = "history";
    private static final int MAX_RECORDS = 5;
    private static final int MAX_STACK_CHARS = 12_000;
    private static volatile boolean installed = false;

    private CrashDiagnostics() {}

    public static synchronized void install(Context context) {
        if (installed || context == null) return;
        installed = true;
        Context appContext = context.getApplicationContext();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            record(appContext, "native-uncaught", thread == null ? "unknown" : thread.getName(), error);
            if (previous != null) {
                previous.uncaughtException(thread, error);
            } else {
                android.os.Process.killProcess(android.os.Process.myPid());
            }
        });
    }

    public static void record(Context context, String source, String threadName, Throwable error) {
        if (error == null) return;
        StringWriter writer = new StringWriter();
        error.printStackTrace(new PrintWriter(writer));
        recordText(
            context,
            source,
            threadName,
            error.getClass().getName(),
            error.getMessage(),
            writer.toString()
        );
    }

    public static void recordText(
        Context context,
        String source,
        String threadName,
        String type,
        String message,
        String stack
    ) {
        if (context == null) return;
        try {
            SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray previous = new JSONArray(preferences.getString(KEY_HISTORY, "[]"));
            JSONArray next = new JSONArray();
            int start = Math.max(0, previous.length() - (MAX_RECORDS - 1));
            for (int index = start; index < previous.length(); index += 1) {
                next.put(previous.opt(index));
            }

            JSONObject entry = new JSONObject();
            entry.put("at", isoNow());
            entry.put("source", limit(source, 80));
            entry.put("thread", limit(threadName, 120));
            entry.put("type", limit(type, 240));
            entry.put("message", limit(message, 2_000));
            entry.put("stack", limit(stack, MAX_STACK_CHARS));
            entry.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            entry.put("sdk", Build.VERSION.SDK_INT);
            next.put(entry);

            preferences.edit().putString(KEY_HISTORY, next.toString()).apply();
        } catch (Exception ignored) {
            // Crash recording must never become a second crash.
        }
    }

    public static String read(Context context) {
        if (context == null) return "[]";
        try {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_HISTORY, "[]");
        } catch (Exception ignored) {
            return "[]";
        }
    }

    public static void clear(Context context) {
        if (context == null) return;
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_HISTORY)
                .apply();
        } catch (Exception ignored) {}
    }

    private static String isoNow() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private static String limit(String value, int maxLength) {
        if (value == null) return "";
        String text = value.replace('\u0000', ' ').trim();
        return text.length() <= maxLength ? text : text.substring(0, maxLength) + "...";
    }
}

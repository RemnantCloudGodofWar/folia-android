package top.izuna.foliamajor;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 本地音频流服务器。
 *
 * 两种来源：
 *   /audio/<MediaStore id>          系统媒体库里的文件
 *   /audio/imported-<file name>     通过系统文件管理器挑选后复制进 App 私有目录的文件
 *
 * 只监听 127.0.0.1，支持 Range 请求，供 WebView 的 <audio> 直接播放。
 */
final class LocalAudioServer {
    private static final String AUDIO_PATH_PREFIX = "/audio/";
    private static final String IMPORTED_PREFIX = "imported-";
    private final Context context;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private ServerSocket serverSocket;
    private int port;

    LocalAudioServer(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized int start() throws IOException {
        if (serverSocket != null && !serverSocket.isClosed()) return port;
        serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        executor.execute(() -> {
            while (!serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    executor.execute(() -> handle(socket));
                } catch (IOException ignored) {
                    break;
                }
            }
        });
        return port;
    }

    int getPort() {
        return port;
    }

    /** 复制进私有目录的音频存放位置。 */
    File importedAudioDirectory() {
        File dir = new File(context.getFilesDir(), "imported-audio");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private void handle(Socket socket) {
        try (Socket client = socket;
             BufferedInputStream input = new BufferedInputStream(client.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(client.getOutputStream())) {
            String requestLine = readLine(input);
            if (requestLine == null) return;
            String[] requestParts = requestLine.split(" ");
            if (requestParts.length < 2) return;

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(input)) != null && !line.isEmpty()) {
                int separator = line.indexOf(':');
                if (separator > 0) {
                    headers.put(
                        line.substring(0, separator).trim().toLowerCase(),
                        line.substring(separator + 1).trim()
                    );
                }
            }

            String path = requestParts[1];
            int query = path.indexOf('?');
            if (query >= 0) path = path.substring(0, query);
            if (!path.startsWith(AUDIO_PATH_PREFIX)) {
                writeStatus(output, 404, "Not Found");
                return;
            }

            String token = URLDecoder.decode(path.substring(AUDIO_PATH_PREFIX.length()), "UTF-8");
            if (token.startsWith(IMPORTED_PREFIX)) {
                streamImportedFile(output, requestParts, headers, token.substring(IMPORTED_PREFIX.length()));
                return;
            }
            streamMediaStoreFile(output, requestParts, headers, token);
        } catch (Exception ignored) {
        }
    }

    private void streamMediaStoreFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String mediaId
    ) throws IOException {
        Uri uri = Uri.withAppendedPath(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId);
        ContentResolver resolver = context.getContentResolver();
        long size = -1;
        String mime = "audio/*";
        try (Cursor cursor = resolver.query(uri, new String[]{
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.MIME_TYPE
        }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                size = cursor.getLong(0);
                String queriedMime = cursor.getString(1);
                if (queriedMime != null && !queriedMime.isEmpty()) mime = queriedMime;
            }
        }
        writeResponse(output, requestParts, headers, size, mime, () -> resolver.openInputStream(uri));
    }

    private void streamImportedFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String fileName
    ) throws IOException {
        File target = new File(importedAudioDirectory(), fileName);
        if (!target.isFile()) {
            writeStatus(output, 404, "Not Found");
            return;
        }
        writeResponse(
            output,
            requestParts,
            headers,
            target.length(),
            guessMimeType(fileName),
            () -> new FileInputStream(target)
        );
    }

    private interface StreamSupplier {
        InputStream open() throws IOException;
    }

    private void writeResponse(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        long size,
        String mime,
        StreamSupplier supplier
    ) throws IOException {
        long start = 0;
        long end = size > 0 ? size - 1 : -1;
        String range = headers.get("range");
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String[] parts = range.substring(6).split("-", -1);
            try {
                if (!parts[0].isEmpty()) start = Long.parseLong(parts[0]);
                if (parts.length > 1 && !parts[1].isEmpty()) end = Long.parseLong(parts[1]);
                if (size > 0) end = Math.min(end, size - 1);
                partial = true;
            } catch (NumberFormatException ignored) {
                start = 0;
                end = size > 0 ? size - 1 : -1;
                partial = false;
            }
        }

        long contentLength = end >= start ? end - start + 1 : -1;
        StringBuilder response = new StringBuilder();
        response.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        response.append("Content-Type: ").append(mime).append("\r\n");
        response.append("Accept-Ranges: bytes\r\n");
        response.append("Access-Control-Allow-Origin: *\r\n");
        response.append("Connection: close\r\n");
        if (size > 0) {
            response.append("Content-Length: ").append(contentLength).append("\r\n");
            if (partial) {
                response.append("Content-Range: bytes ")
                    .append(start).append('-').append(end).append('/').append(size).append("\r\n");
            }
        }
        response.append("\r\n");
        output.write(response.toString().getBytes(StandardCharsets.US_ASCII));

        if ("GET".equals(requestParts[0])) {
            try (InputStream audio = supplier.open()) {
                if (audio != null) {
                    if (start > 0) audio.skip(start);
                    byte[] buffer = new byte[64 * 1024];
                    long remaining = contentLength;
                    int read;
                    while ((read = audio.read(buffer)) != -1 && (remaining < 0 || remaining > 0)) {
                        int writeLength = remaining < 0 ? read : (int) Math.min(read, remaining);
                        output.write(buffer, 0, writeLength);
                        if (remaining > 0) remaining -= writeLength;
                    }
                }
            }
        }
        output.flush();
    }

    static String guessMimeType(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase();
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
        if (lower.endsWith(".opus")) return "audio/opus";
        if (lower.endsWith(".aac")) return "audio/aac";
        if (lower.endsWith(".ape")) return "audio/ape";
        if (lower.endsWith(".wma")) return "audio/x-ms-wma";
        return "audio/mpeg";
    }

    private static String readLine(InputStream input) throws IOException {
        StringBuilder line = new StringBuilder();
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (value != '\r') line.append((char) value);
        }
        return value == -1 && line.length() == 0 ? null : line.toString();
    }

    private static void writeStatus(OutputStream output, int status, String message) throws IOException {
        String response = "HTTP/1.1 " + status + " " + message + "\r\n"
            + "Content-Length: 0\r\nConnection: close\r\n\r\n";
        output.write(response.getBytes(StandardCharsets.US_ASCII));
        output.flush();
    }
}

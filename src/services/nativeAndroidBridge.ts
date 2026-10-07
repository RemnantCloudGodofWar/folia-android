// Android-only shim that makes the bundled Folia Bridge API modules believe they
// are running inside a browser extension while all privileged work is delegated
// to the native Capacitor plugin.

const PAGE_SOURCE = 'folia-web-page';
const BRIDGE_SOURCE = 'folia-extension-bridge';
const BRIDGE_VERSION = 'android-0.1.0';

const API_HOSTS = [
  'music.163.com',
  'interface.music.163.com',
  'interface3.music.163.com',
  'c.y.qq.com',
  'u.y.qq.com',
  'ssl.ptlogin2.qq.com',
  'xui.ptlogin2.qq.com',
  'graph.qq.com',
  // KuGou spreads its API over many hosts (songsearch, complexsearch, trackercdn, vip, ...) and the
  // set keeps moving, so match the whole domain instead of listing hosts one by one. Only requests
  // that stay inside the WebView are subject to CORS; anything the bridge calls has to be proxied
  // here, which is why a missing host silently returns an empty result rather than an error.
  'kugou.com',
  'api.qrserver.com',
];

type NativePlugin = {
  cookiesGetAll: (options: Record<string, unknown>) => Promise<{ cookies?: unknown[] }>;
  cookiesGet: (options: Record<string, unknown>) => Promise<{ cookie?: unknown }>;
  cookiesSet: (options: Record<string, unknown>) => Promise<{ ok?: boolean }>;
  cookiesRemove: (options: Record<string, unknown>) => Promise<{ ok?: boolean }>;
  httpRequest: (options: Record<string, unknown>) => Promise<{
    status: number;
    headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
    bodyBase64?: string;
  }>;
};

type ApiHandler = (input: Record<string, unknown>) => Promise<unknown>;

let apiHandler: ApiHandler | null = null;
const queuedRequests = new Map<string, Record<string, unknown>>();

const getPlugin = (): NativePlugin | null => {
  const capacitor = (window as any).Capacitor;
  return capacitor?.Plugins?.FoliaNative ?? null;
};

const postToPage = (payload: Record<string, unknown>) => {
  window.postMessage({ source: BRIDGE_SOURCE, ...payload }, '*');
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};

const base64ToBytes = (value?: string): Uint8Array => {
  if (!value) return new Uint8Array();
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/** True when a request must go through the native OkHttp proxy instead of the WebView's fetch. */
export const isBridgedApiUrl = (url: string): boolean => {
  try {
    const { hostname } = new URL(url, location.href);
    return API_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
};

const serializeBody = async (body: BodyInit | null | undefined): Promise<{
  bodyText?: string;
  bodyBase64?: string;
  contentType?: string;
}> => {
  if (body == null) return {};
  if (typeof body === 'string') return { bodyText: body };
  if (body instanceof URLSearchParams) {
    return {
      bodyText: body.toString(),
      contentType: 'application/x-www-form-urlencoded',
    };
  }
  const response = new Response(body as BodyInit);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bodyBase64: bytesToBase64(bytes),
    contentType: response.headers.get('content-type') || undefined,
  };
};

const installCookieShim = (plugin: NativePlugin) => {
  const chromeObject = ((globalThis as any).chrome ??= {});
  chromeObject.runtime = {
    id: 'folia-native-android',
    getManifest: () => ({ version: BRIDGE_VERSION }),
  };
  chromeObject.storage = {
    local: {
      get: async (keys?: string | string[] | null) => {
        const result: Record<string, unknown> = {};
        const requested = keys == null
          ? Object.keys(localStorage)
          : Array.isArray(keys)
            ? keys
            : [keys];
        requested.forEach((key) => {
          const value = localStorage.getItem(String(key));
          if (value != null) {
            try {
              result[String(key)] = JSON.parse(value);
            } catch {
              result[String(key)] = value;
            }
          }
        });
        return result;
      },
      set: async (values: Record<string, unknown>) => {
        Object.entries(values || {}).forEach(([key, value]) => {
          localStorage.setItem(key, JSON.stringify(value));
        });
      },
      remove: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((key) => localStorage.removeItem(key));
      },
    },
  };
  chromeObject.cookies = {
    getAll: async (details: Record<string, unknown> = {}) => {
      const response = await plugin.cookiesGetAll(details);
      return response.cookies || [];
    },
    get: async (details: Record<string, unknown>) => {
      const response = await plugin.cookiesGet(details);
      return response.cookie || null;
    },
    set: async (details: Record<string, unknown>) => {
      await plugin.cookiesSet(details);
      return details;
    },
    remove: async (details: Record<string, unknown>) => {
      const response = await plugin.cookiesRemove(details);
      return response.ok ? details : null;
    },
  };
  chromeObject.declarativeNetRequest = {
    RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' },
    updateSessionRules: async () => undefined,
  };
  chromeObject.tabs = {
    create: async ({ url }: { url?: string } = {}) => {
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return {};
    },
    query: async () => [],
    onRemoved: { addListener: () => undefined },
    onUpdated: { addListener: () => undefined },
  };
};

const installFetchShim = (plugin: NativePlugin) => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const rawUrl = request?.url ?? String(input);
    if (!isBridgedApiUrl(rawUrl)) {
      return originalFetch(input, init);
    }

    const method = (init?.method || request?.method || 'GET').toUpperCase();
    const headers = new Headers(request?.headers || init?.headers || {});
    const serialized = await serializeBody(init?.body ?? null);
    if (serialized.contentType && !headers.has('content-type')) {
      headers.set('content-type', serialized.contentType);
    }

    const result = await plugin.httpRequest({
      url: rawUrl,
      method,
      headers: Object.fromEntries(headers.entries()),
      bodyText: serialized.bodyText || '',
      bodyBase64: serialized.bodyBase64 || '',
      redirect: init?.redirect || request?.redirect || 'follow',
    });
    const responseBytes = base64ToBytes(result.bodyBase64);
    const responseBuffer = responseBytes.buffer.slice(
      responseBytes.byteOffset,
      responseBytes.byteOffset + responseBytes.byteLength,
    ) as ArrayBuffer;
    const responseHeaders = new Headers();
    if (Array.isArray(result.headers)) {
      result.headers.forEach((entry) => {
        if (!entry?.name || entry.value == null) return;
        // Headers.set() collapses repeats, so append Set-Cookie individually
        // to keep every cookie the server sent.
        if (entry.name.toLowerCase() === 'set-cookie') {
          responseHeaders.append(entry.name, String(entry.value));
        } else {
          responseHeaders.set(entry.name, String(entry.value));
        }
      });
    } else if (result.headers) {
      Object.entries(result.headers).forEach(([name, value]) => {
        if (value != null) responseHeaders.set(name, String(value));
      });
    }
    return new Response(responseBuffer, {
      status: result.status,
      headers: responseHeaders,
    });
  };
};

const flushQueuedRequests = () => {
  if (!apiHandler) return;
  queuedRequests.forEach((payload, id) => {
    void handleApiRequest(id, payload);
  });
  queuedRequests.clear();
};

const handleApiRequest = async (id: string, payload: Record<string, unknown>) => {
  if (!apiHandler) {
    queuedRequests.set(id, payload);
    return;
  }
  try {
    const data = await apiHandler(payload);
    postToPage({ type: 'FOLIA_API_RESPONSE', id, ok: true, data });
  } catch (error) {
    postToPage({
      type: 'FOLIA_API_RESPONSE',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const installMessageBridge = () => {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as Record<string, any> | null;
    if (!data || data.source !== PAGE_SOURCE) return;

    if (data.type === 'FOLIA_BRIDGE_PING') {
      postToPage({
        type: 'FOLIA_BRIDGE_PONG',
        ready: true,
        version: BRIDGE_VERSION,
        extId: 'folia-native-android',
      });
      return;
    }

    if (data.type === 'FOLIA_API_REQUEST' && typeof data.id === 'string') {
      void handleApiRequest(data.id, data.payload || {});
    }
  });
};

export const installNativeAndroidBridge = async (): Promise<void> => {
  if (typeof window === 'undefined') return;
  const capacitor = (window as any).Capacitor;
  if (!capacitor?.isNativePlatform?.() && capacitor?.getPlatform?.() !== 'android') return;

  const plugin = getPlugin();
  if (!plugin) {
    console.error('[FoliaNativeBridge] FoliaNative Capacitor plugin is not registered');
    return;
  }

  installCookieShim(plugin);
  installFetchShim(plugin);
  installMessageBridge();
  const { installNativePlaybackBridge } = await import('./nativePlaybackBridge');
  await installNativePlaybackBridge(plugin as any);

  // @ts-ignore The bundled extension module is plain JavaScript.
  const module = await import('../nativeBridge/api/folia.js');
  apiHandler = module.handleFoliaApiRequest as ApiHandler;
  postToPage({
    type: 'FOLIA_BRIDGE_READY',
    ready: true,
    version: BRIDGE_VERSION,
    extId: 'folia-native-android',
  });
  flushQueuedRequests();
};

import type { LocalSong } from '../types';
import { saveLocalSongs } from './db';
import { buildImportedMetadataSnapshot } from '../utils/localSongMetadata';
import { parseEmbeddedMetadataAsync } from '../utils/localMetadataWorkerClient';
import { noteLibraryStep } from '../nativeBridge/api/libraryTrace.js';

type NativeAudioTrack = {
  id: string;
  fileName: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  fileSize?: number;
  mimeType?: string;
  url: string;
};

type NativePlugin = {
  scanLocalAudio: () => Promise<{ tracks?: NativeAudioTrack[] }>;
  pickAudioFiles: () => Promise<{
    tracks?: NativeAudioTrack[];
    port?: number;
    cancelled?: boolean;
    picked?: number;
    copied?: number;
    failures?: Array<{ uri?: string; message?: string }>;
  }>;
  localAudioServerPort: () => Promise<{ port?: number }>;
};

export const isAndroidNativeRuntime = (): boolean => (
  typeof window !== 'undefined'
  && (window as any).Capacitor?.getPlatform?.() === 'android'
);

const getPlugin = (): NativePlugin | null => (
  (window as any).Capacitor?.Plugins?.FoliaNative ?? null
);

const titleFromFileName = (fileName: string): string => (
  String(fileName || 'Unknown Song').replace(/\.[^.]+$/, '')
);

export const ANDROID_IMPORTED_FOLDER_NAME = 'Android 文件导入';

let resolvedAudioServerPort = 0;

/** Resolves (and caches) the localhost port the native audio server listens on. */
export const resolveNativeAudioServerPort = async (): Promise<number> => {
  if (resolvedAudioServerPort > 0) return resolvedAudioServerPort;
  const plugin = getPlugin();
  if (!plugin?.localAudioServerPort) return 0;
  try {
    const response = await plugin.localAudioServerPort();
    const port = Number(response?.port) || 0;
    if (port > 0) resolvedAudioServerPort = port;
    return port;
  } catch {
    return 0;
  }
};

export const nativeAudioUrlForRef = async (ref: string): Promise<string | null> => {
  if (!ref) return null;
  const port = await resolveNativeAudioServerPort();
  if (port <= 0) return null;
  return `http://127.0.0.1:${port}/audio/${encodeURIComponent(ref)}`;
};

export const importAndroidLocalMusic = async (): Promise<LocalSong[]> => {
  const plugin = getPlugin();
  if (!plugin?.scanLocalAudio) {
    throw new Error('Android local music plugin is unavailable');
  }

  const response = await plugin.scanLocalAudio();
  const now = Date.now();
  const songs = (response.tracks || []).map((track): LocalSong => {
    const fileName = track.fileName || `track-${track.id}`;
    const title = track.title || titleFromFileName(fileName);
    return {
      id: `android-media-${track.id}`,
      fileName,
      filePath: `Android/MediaStore/${track.id}`,
      nativeAudioUrl: track.url,
      duration: Number(track.duration) || 0,
      fileSize: Number(track.fileSize) || 0,
      fileLastModified: now,
      mimeType: track.mimeType || 'audio/*',
      addedAt: now,
      title,
      titleOrigin: 'import',
      importedMetadata: buildImportedMetadataSnapshot({
        fileName,
        fallbackTitle: title,
        fallbackArtist: track.artist || '',
        fallbackAlbum: track.album || '',
      }),
      folderName: 'Android 本地音乐',
      hasManualLyricSelection: false,
      noAutoMatch: false,
    };
  });

  if (songs.length > 0) {
    await saveLocalSongs(songs);
  }
  return songs;
};

/**
 * 用系统文件管理器（Storage Access Framework）挑选音频文件。
 *
 * 选中的文件由原生侧复制进 App 私有目录，之后通过本机回环地址流式播放，
 * 所以不依赖 MediaStore 是否收录过这些文件，也不需要整盘存储权限。
 */
export const pickAndroidLocalMusic = async (): Promise<LocalSong[]> => {
  const plugin = getPlugin();
  if (!plugin?.pickAudioFiles) {
    noteLibraryStep('local', 'pick:no-plugin', {
      hasPlugin: Boolean(plugin),
      methods: plugin ? Object.keys(plugin).join(',') : 'none',
    });
    throw new Error('Android audio picker is unavailable');
  }

  noteLibraryStep('local', 'pick:start');
  let response: Awaited<ReturnType<NativePlugin['pickAudioFiles']>>;
  try {
    response = await plugin.pickAudioFiles();
  } catch (error) {
    noteLibraryStep('local', 'pick:error', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const failures = Array.isArray((response as { failures?: unknown }).failures)
    ? (response as { failures: Array<{ uri?: string; message?: string }> }).failures
    : [];
  noteLibraryStep('local', 'pick:result', {
    cancelled: response.cancelled === true,
    picked: (response as { picked?: number }).picked ?? (response.tracks || []).length,
    copied: (response as { copied?: number }).copied ?? (response.tracks || []).length,
    tracks: (response.tracks || []).length,
    failures: failures.length,
    firstFailure: failures[0]?.message,
    port: response.port,
  });

  if (response.cancelled) return [];
  resolvedAudioServerPort = Number(response.port) || resolvedAudioServerPort;

  const now = Date.now();
  const songs: LocalSong[] = [];

  for (const track of response.tracks || []) {
    const fileName = track.fileName || `track-${track.id}`;
    const fallbackTitle = titleFromFileName(fileName);
    let metadata: Awaited<ReturnType<typeof parseEmbeddedMetadataAsync>> = null;
    let metadataError: string | undefined;
    try {
      const blob = await (await fetch(track.url)).blob();
      metadata = await parseEmbeddedMetadataAsync(new File([blob], fileName, {
        type: track.mimeType || 'audio/*',
      }), true);
    } catch (error) {
      metadataError = error instanceof Error ? error.message : String(error);
      console.warn('[NativeLocalMusic] Failed to parse embedded metadata', fileName, error);
    }
    noteLibraryStep('local', 'pick:track', {
      fileName,
      fileSize: track.fileSize,
      urlHost: track.url?.replace(/^https?:\/\//, '').split('/')[0],
      metadata: metadata ? 'ok' : 'none',
      metadataError,
    });

    const title = metadata?.title || fallbackTitle;
    songs.push({
      id: `android-imported-${track.id}`,
      fileName,
      filePath: `Android/Imported/${track.id}`,
      nativeAudioRef: track.id,
      nativeAudioUrl: track.url,
      duration: Number(metadata?.duration) || Number(track.duration) || 0,
      fileSize: Number(track.fileSize) || 0,
      fileLastModified: now,
      mimeType: track.mimeType || 'audio/*',
      addedAt: now,
      title,
      titleOrigin: 'import',
      importedMetadata: buildImportedMetadataSnapshot({
        fileName,
        embeddedTitle: metadata?.title,
        fallbackTitle,
        embeddedArtist: metadata?.artist,
        embeddedArtists: metadata?.artists,
        fallbackArtist: track.artist || '',
        embeddedAlbum: metadata?.album,
        fallbackAlbum: track.album || '',
      }),
      folderName: ANDROID_IMPORTED_FOLDER_NAME,
      hasManualLyricSelection: false,
      noAutoMatch: false,
    });
  }

  if (songs.length > 0) {
    await saveLocalSongs(songs);
    noteLibraryStep('local', 'pick:saved', { songs: songs.length });
  } else if (failures.length > 0) {
    // 选了文件却一个都没进来：把原生侧的原因抛出去，界面至少会报错，
    // 而不是像以前那样静默什么都不做。
    throw new Error(`Imported 0 of ${failures.length} picked file(s): ${failures[0]?.message || 'unknown error'}`);
  }
  return songs;
};

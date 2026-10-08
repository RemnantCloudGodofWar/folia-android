import { PlayerState } from '../types';
import { currentTime } from '../stores/motionSignals';
import {
  selectDisplayDuration,
  selectDisplayPlayerState,
  selectDisplaySong,
  usePlaybackStore,
} from '../stores/usePlaybackStore';

type NativePlaybackPlugin = {
  updatePlaybackState: (state: Record<string, unknown>) => Promise<unknown>;
  clearPlaybackState: () => Promise<unknown>;
  addListener: (
    eventName: string,
    listener: (event: { action?: string }) => void,
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
};

let installed = false;

const pushState = (plugin: NativePlaybackPlugin) => {
  const state = usePlaybackStore.getState();
  const song = selectDisplaySong(state);
  if (!song) {
    void plugin.clearPlaybackState().catch(() => undefined);
    return;
  }
  const playerState = selectDisplayPlayerState(state);
  const playing = playerState === PlayerState.PLAYING;
  const coverUrl = song.album?.coverUrl || (song as any).coverUrl || '';
  void plugin.updatePlaybackState({
    title: song.name || 'Unknown Song',
    artist: song.artists?.map((artist) => artist.name).filter(Boolean).join(' / ') || '',
    album: song.album?.name || '',
    coverUrl,
    playing,
    position: Math.max(0, Math.round(currentTime.get() * 1000)),
    duration: Math.max(0, Math.round(selectDisplayDuration(state) * 1000)),
  }).catch(() => undefined);
};

export const installNativePlaybackBridge = async (
  plugin: NativePlaybackPlugin,
): Promise<void> => {
  if (installed) return;
  installed = true;

  try {
    await plugin.addListener('mediaAction', ({ action }) => {
      if (!action) return;
      window.dispatchEvent(new CustomEvent('folia-native-media-action', {
        detail: { action },
      }));
    });
  } catch (error) {
    console.warn('[FoliaNativePlayback] Failed to listen for media actions', error);
  }

  usePlaybackStore.subscribe(() => pushState(plugin));
  window.setInterval(() => {
    const state = usePlaybackStore.getState();
    if (selectDisplayPlayerState(state) === PlayerState.PLAYING) {
      pushState(plugin);
    }
  }, 1000);
  pushState(plugin);
};

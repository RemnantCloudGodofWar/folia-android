import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp, FolderOpen, Loader2, Music, ListMusic, User, Disc3, RefreshCw } from 'lucide-react';
import DesktopGrid3DSurface, { DesktopGrid3DAction } from '../../folia-grid/DesktopGrid3DSurface';
import { LocalLibraryGroup, LocalPlaylist, LocalSong, Theme } from '../../../types';
import { GridViewCollectionDescriptor, createLocalGridViewCollection } from './gridViewCollectionAdapters';
import { buildLocalGrid3DGroups } from './localGrid3DModel';
import { useDebouncedFocusSync } from '../../../hooks/useDebouncedFocusSync';
import { useLocalLibraryCatalog } from '../../../hooks/useLocalLibraryCatalog';
import { buildLocalQueue } from '../../../services/playbackAdapters';
import { createLocalPlaylist } from '../../../services/localPlaylistService';
import { clearFolderIgnore, deleteFolderSongs, deleteSongsByIds, removeImportedRoot, resyncFolder } from '../../../services/localMusicService';
import { loadLocalLibraryDirectoryTrees } from '../../../services/localLibraryDirectoryTree';
import type { GridMapBatchConfig, GridMapBatchContext, GridMapDirectoryNode } from '../../folia-grid/gridMapBatch';
import type { SongResult } from '../../../types';

// src/components/app/home/LocalGrid3DView.tsx
// Desktop-only local music Grid3D overview that opens GridView instead of legacy carousel details.

type LocalRow = 0 | 1 | 2 | 3;

interface LocalGrid3DViewProps {
    localSongs: LocalSong[];
    localPlaylists: LocalPlaylist[];
    activeRow: LocalRow;
    setActiveRow: (row: LocalRow) => void;
    focusedFolderIndex: number;
    setFocusedFolderIndex: (index: number) => void;
    focusedAlbumIndex: number;
    setFocusedAlbumIndex: (index: number) => void;
    focusedArtistIndex: number;
    setFocusedArtistIndex: (index: number) => void;
    focusedPlaylistIndex: number;
    setFocusedPlaylistIndex: (index: number) => void;
    onImportFolder: () => void;
    /** 安卓专有：直接扫描设备音乐库导入，不经过系统文件管理器。 */
    onScanDeviceMusic?: () => void;
    onImportPlaylistFile?: (file: File) => Promise<void> | void;
    onRefreshFolders?: () => void;
    importButtonDisabled?: boolean;
    isImporting?: boolean;
    isRefreshing?: boolean;
    isScanInProgress?: boolean;
    /** 安卓专有：正在扫描设备音乐库（MediaStore）。 */
    isScanningDevice?: boolean;
    isImportingPlaylist?: boolean;
    onOpenGridView?: (collection: GridViewCollectionDescriptor) => void;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[]) => void;
    onRefreshLocalSongs: () => Promise<void> | void;
    theme: Theme;
    isDaylight: boolean;
    hasFloatingPlayer?: boolean;
    isInteractive?: boolean;
}

export const LocalGrid3DView: React.FC<LocalGrid3DViewProps> = ({
    localSongs,
    localPlaylists,
    activeRow,
    setActiveRow,
    focusedFolderIndex,
    setFocusedFolderIndex,
    focusedAlbumIndex,
    setFocusedAlbumIndex,
    focusedArtistIndex,
    setFocusedArtistIndex,
    focusedPlaylistIndex,
    setFocusedPlaylistIndex,
    onImportFolder,
    onScanDeviceMusic,
    onImportPlaylistFile,
    onRefreshFolders,
    importButtonDisabled = false,
    isImporting = false,
    isRefreshing = false,
    isScanInProgress = false,
    isScanningDevice = false,
    isImportingPlaylist = false,
    onOpenGridView,
    onPlayAll,
    onAddAllToQueue,
    onRefreshLocalSongs,
    theme,
    isDaylight,
    hasFloatingPlayer = false,
    isInteractive = true,
}) => {
    const { t } = useTranslation();
    const playlistFileInputRef = useRef<HTMLInputElement>(null);
    const [directoryTrees, setDirectoryTrees] = useState<GridMapDirectoryNode[]>([]);
    const [directoryTreesLoaded, setDirectoryTreesLoaded] = useState(false);
    const catalog = useLocalLibraryCatalog(localSongs);

    const refreshDirectoryTrees = React.useCallback(async () => {
        try {
            const trees = await loadLocalLibraryDirectoryTrees(localSongs);
            setDirectoryTrees(trees);
        } catch (error) {
            console.warn('[LocalGrid3DView] Failed to load directory snapshots:', error);
            setDirectoryTrees([]);
        } finally {
            setDirectoryTreesLoaded(true);
        }
    }, [localSongs]);

    useEffect(() => {
        void refreshDirectoryTrees();
    }, [refreshDirectoryTrees]);
    const groups = useMemo(() => buildLocalGrid3DGroups(
        localSongs,
        localPlaylists,
        t,
        catalog.ready ? catalog : undefined,
    ), [catalog.assignments, catalog.entities, catalog.ready, localPlaylists, localSongs, t]);

    const [localFolderIndex, setLocalFolderIndex] = useDebouncedFocusSync(focusedFolderIndex, setFocusedFolderIndex);
    const [localAlbumIndex, setLocalAlbumIndex] = useDebouncedFocusSync(focusedAlbumIndex, setFocusedAlbumIndex);
    const [localArtistIndex, setLocalArtistIndex] = useDebouncedFocusSync(focusedArtistIndex, setFocusedArtistIndex);
    const [localPlaylistIndex, setLocalPlaylistIndex] = useDebouncedFocusSync(focusedPlaylistIndex, setFocusedPlaylistIndex);

    const sections = useMemo(() => [
        {
            key: 'folders',
            row: 0 as LocalRow,
            label: t('localMusic.foldersAndPlaylists'),
            icon: <FolderOpen size={13} />,
            items: groups.folders,
            focusedIndex: localFolderIndex,
            setFocusedIndex: setLocalFolderIndex,
            emptyMessage: t('localMusic.noFoldersFound'),
        },
        {
            key: 'albums',
            row: 1 as LocalRow,
            label: t('localMusic.albums'),
            icon: <Disc3 size={13} />,
            items: groups.albums,
            focusedIndex: localAlbumIndex,
            setFocusedIndex: setLocalAlbumIndex,
            emptyMessage: t('localMusic.noAlbumsFound'),
        },
        {
            key: 'artists',
            row: 2 as LocalRow,
            label: t('localMusic.artists'),
            icon: <User size={13} />,
            items: groups.artists,
            focusedIndex: localArtistIndex,
            setFocusedIndex: setLocalArtistIndex,
            emptyMessage: t('localMusic.noArtistsFound'),
        },
        {
            key: 'playlists',
            row: 3 as LocalRow,
            label: t('localMusic.customPlaylists') || t('home.playlists'),
            icon: <ListMusic size={13} />,
            items: groups.playlists,
            focusedIndex: localPlaylistIndex,
            setFocusedIndex: setLocalPlaylistIndex,
            emptyMessage: t('localMusic.noPlaylistsFound'),
        },
    ], [
        localAlbumIndex,
        localArtistIndex,
        localFolderIndex,
        localPlaylistIndex,
        groups,
        setLocalAlbumIndex,
        setLocalArtistIndex,
        setLocalFolderIndex,
        setLocalPlaylistIndex,
        t,
    ]);

    const activeSection = sections.find(section => section.row === activeRow) ?? sections[0];

    const resolveBatchSongs = React.useCallback((context: GridMapBatchContext) => {
        const songsById = new Map(localSongs.map(song => [song.id, song]));
        return context.trackIds
            .map(id => songsById.get(id))
            .filter((song): song is LocalSong => Boolean(song));
    }, [localSongs]);

    const localBatchConfig = useMemo<GridMapBatchConfig | undefined>(() => {
        if (!['folders', 'albums', 'artists'].includes(activeSection.key)) return undefined;

        const baseConfig: GridMapBatchConfig = {
            selectionType: activeSection.key as 'folders' | 'albums' | 'artists',
            ...(activeSection.key === 'folders' ? { directoryTrees } : {}),
            onPlay: context => {
                const queue = buildLocalQueue(resolveBatchSongs(context), undefined, catalog.ready ? catalog : undefined);
                if (queue.length > 0) onPlayAll?.(queue);
            },
            onAddToQueue: context => {
                const queue = buildLocalQueue(resolveBatchSongs(context), undefined, catalog.ready ? catalog : undefined);
                if (queue.length > 0) onAddAllToQueue?.(queue);
            },
            onCreatePlaylist: async (name, context) => {
                await createLocalPlaylist(name, resolveBatchSongs(context));
                await onRefreshLocalSongs();
            },
        };

        if (activeSection.key !== 'folders') return baseConfig;

        return {
            ...baseConfig,
            onRemove: async context => {
                const selectedIds = new Set(context.trackIds);
                // A direct-only selection must not ignore descendants that the user excluded.
                const folderPaths = context.items.filter(item => item.id !== 'folder-__all-songs__').map(item => item.path || item.name).filter(path =>
                    localSongs.every(song => !(song.folderName === path || song.folderName?.startsWith(`${path}/`)) || selectedIds.has(song.id)));
                for (const path of folderPaths.filter(path => !folderPaths.some(parent => path !== parent && path.startsWith(`${parent}/`)))) {
                    await deleteFolderSongs(path);
                }
                await deleteSongsByIds(context.trackIds);
                await onRefreshLocalSongs();
                await refreshDirectoryTrees();
            },
            onClearFolderIgnore: async folderPath => {
                await clearFolderIgnore(folderPath);
                await onRefreshLocalSongs();
                setDirectoryTrees(await loadLocalLibraryDirectoryTrees());
            },
            onRescanRoot: async rootPath => {
                await resyncFolder(rootPath);
                await onRefreshLocalSongs();
            },
            onRemoveRoot: async rootPath => {
                await removeImportedRoot(rootPath);
                await onRefreshLocalSongs();
            },
        };
    }, [activeSection.key, catalog, directoryTrees, localSongs, onAddAllToQueue, onPlayAll, onRefreshLocalSongs, refreshDirectoryTrees, resolveBatchSongs]);

    const tabs: DesktopGrid3DAction[] = sections.map(section => ({
        id: section.key,
        label: section.label,
        icon: section.icon,
        active: activeSection.row === section.row,
        onClick: () => setActiveRow(section.row),
    }));

    const actions: DesktopGrid3DAction[] = [
        {
            id: 'import-folder',
            label: isImporting ? t('localMusic.importing') : t('localMusic.importFolder'),
            icon: isImporting ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />,
            disabled: importButtonDisabled,
            onClick: onImportFolder,
            title: t('localMusic.importFolder'),
        },
        ...(onScanDeviceMusic ? [{
            id: 'scan-device-music',
            label: isScanningDevice ? t('options.scanning') : t('localMusic.scanDeviceMusic'),
            icon: isScanningDevice ? <Loader2 size={13} className="animate-spin" /> : <Music size={13} />,
            disabled: importButtonDisabled,
            onClick: onScanDeviceMusic,
            title: t('localMusic.scanDeviceMusic'),
        }] : []),
        {
            id: 'refresh-folders',
            label: (isScanInProgress || isRefreshing) ? t('options.scanning') : t('options.refresh'),
            icon: (isScanInProgress || isRefreshing) ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />,
            disabled: importButtonDisabled,
            onClick: onRefreshFolders || (() => {}),
            title: t('options.refresh'),
        },
        {
            id: 'import-playlist',
            label: isImportingPlaylist ? t('localMusic.importingPlaylist') : t('localMusic.importPlaylist'),
            icon: isImportingPlaylist ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />,
            disabled: importButtonDisabled || isImportingPlaylist,
            onClick: () => playlistFileInputRef.current?.click(),
            title: t('localMusic.importPlaylist'),
        },
    ];

    if (directoryTreesLoaded && localSongs.length === 0 && directoryTrees.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 opacity-60">
                <Music size={64} />
                <p className="text-lg">{t('localMusic.noLocalMusic')}</p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                    onClick={onImportFolder}
                    disabled={importButtonDisabled}
                    className="px-6 py-3 rounded-full transition-colors text-sm flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {importButtonDisabled ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                    {isScanInProgress ? t('options.scanning') : isImporting ? t('localMusic.importing') : t('localMusic.importFolder')}
                </button>
                {onScanDeviceMusic && (
                    <button
                        onClick={onScanDeviceMusic}
                        disabled={importButtonDisabled}
                        className="px-6 py-3 rounded-full transition-colors text-sm flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isScanningDevice ? <Loader2 size={16} className="animate-spin" /> : <Music size={16} />}
                        {isScanningDevice ? t('options.scanning') : t('localMusic.scanDeviceMusic')}
                    </button>
                )}
                </div>
            </div>
        );
    }

    return (
        <>
            <input
                ref={playlistFileInputRef}
                type="file"
                accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void onImportPlaylistFile?.(file);
                }}
            />
            <DesktopGrid3DSurface
                focusMemoryScope={JSON.stringify(['local', activeSection.key])}
                title={String(activeSection.label)}
                mapButtonLabel={t('home.allAlbums')}
                items={activeSection.items.map((item: any) => ({
                    id: item.id,
                    name: item.name,
                    coverUrl: item.coverUrl,
                    description: item.description,
                    trackCount: item.trackCount,
                    type: item.type,
                    trackIds: item.songs.map((song: LocalSong) => song.id),
                }))}
                focusedIndex={activeSection.focusedIndex}
                onFocusedIndexChange={activeSection.setFocusedIndex}
                onSelect={(_, index) => {
                    const group = activeSection.items[index];
                    if (group) {
                        onOpenGridView?.(createLocalGridViewCollection(group));
                    }
                }}
                tabs={tabs}
                actions={actions}
                emptyMessage={activeSection.emptyMessage}
                theme={theme}
                isDaylight={isDaylight}
                isInteractive={isInteractive}
                hasFloatingPlayer={hasFloatingPlayer}
                playlistVisibilityScope="local"
                batchConfig={localBatchConfig}
                ponderControls="local-grid-controls"
                gridMapPonderScope="local-grid-map-page"
            />
        </>
    );
};

export default LocalGrid3DView;

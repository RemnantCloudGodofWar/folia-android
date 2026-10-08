import { Cpu, FileText, Keyboard, QrCode, Tags, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// src/components/modal/newFeaturesRelease.ts

type NewFeatureCard = {
    id: string;
    icon: LucideIcon;
    daylightIconClassName: string;
    darkIconClassName: string;
};

type NewFeaturesRelease = {
    i18nKey: string;
    features: NewFeatureCard[];
};

// Defines the current release's cards; their localized text lives under i18nKey in every locale.
export const NEW_FEATURES_RELEASE: NewFeaturesRelease = {
    i18nKey: 'releaseNotes.v0_7_15',
    features: [
        { id: 'localLyrics', icon: FileText, daylightIconClassName: 'text-amber-600', darkIconClassName: 'text-amber-400' },
        { id: 'mp3Tags', icon: Tags, daylightIconClassName: 'text-rose-600', darkIconClassName: 'text-rose-400' },
        { id: 'qrLogin', icon: QrCode, daylightIconClassName: 'text-violet-600', darkIconClassName: 'text-violet-400' },
        { id: 'injectedShortcuts', icon: Keyboard, daylightIconClassName: 'text-cyan-600', darkIconClassName: 'text-cyan-400' },
        { id: 'collectionNav', icon: Undo2, daylightIconClassName: 'text-emerald-600', darkIconClassName: 'text-emerald-400' },
        { id: 'appleSiliconTranscode', icon: Cpu, daylightIconClassName: 'text-sky-600', darkIconClassName: 'text-sky-400' },
    ],
};

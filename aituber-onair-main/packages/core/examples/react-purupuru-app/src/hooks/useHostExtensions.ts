import { useMemo } from 'react';
import { useTyphoonSkill } from './useTyphoonSkill';
import {
  createTyphoonBossRadarExtension,
  TYPHOON_BOSS_RADAR_EXTENSION_ID,
} from '../host-extensions/typhoonBossRadar';
import {
  enrichWithHostExtensions,
  type HostExtensionInput,
} from '../host-extensions/types';

export function useHostExtensions(options: {
  installedSkillIds: readonly string[] | undefined;
  canUseVision: boolean;
}) {
  const typhoonEnabled = options.installedSkillIds?.includes(
    TYPHOON_BOSS_RADAR_EXTENSION_ID,
  ) ?? false;
  const typhoonSkill = useTyphoonSkill(typhoonEnabled);

  const extensions = useMemo(
    () => [
      createTyphoonBossRadarExtension({
        enabled: typhoonEnabled,
        enrichTyphoon: typhoonSkill.enrich,
        canUseVision: options.canUseVision,
      }),
    ],
    [options.canUseVision, typhoonEnabled, typhoonSkill.enrich],
  );

  return useMemo(
    () => ({
      enrich: (input: HostExtensionInput) =>
        enrichWithHostExtensions(extensions, input),
      activeExtensionIds: extensions.filter((extension) => extension.id === TYPHOON_BOSS_RADAR_EXTENSION_ID && typhoonEnabled).map((extension) => extension.id),
    }),
    [extensions, typhoonEnabled],
  );
}

import type { ContentSkillDefinition } from './types';

/**
 * Content skills are selected per digital human. Runtime paths and endpoints
 * belong to deployment configuration, not this registry or persona data.
 */
export const CONTENT_SKILLS = [
  {
    id: 'typhoon-boss-radar',
    name: '台风专业主播',
    summary: '回答台风实况、路径、风力、预警与 Typhoon Boss 雷达界面问题。',
  },
] as const satisfies readonly ContentSkillDefinition[];

export type ContentSkillId = (typeof CONTENT_SKILLS)[number]['id'];

export function hasContentSkill(
  installedSkillIds: readonly string[] | undefined,
  skillId: ContentSkillId,
): boolean {
  return installedSkillIds?.includes(skillId) ?? false;
}

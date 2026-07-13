export const AVATAR_MOTIONS = [
  'idle_cold',
  'side_glance',
  'lean_in',
  'smirk',
  'restrained_laugh',
  'serious_report',
  'thank_gift',
  'dismissive',
] as const;

export type AvatarMotion = (typeof AVATAR_MOTIONS)[number];
const MOTION_SET = new Set<string>(AVATAR_MOTIONS);

export function normalizeAvatarMotion(value: unknown): AvatarMotion {
  return typeof value === 'string' && MOTION_SET.has(value)
    ? (value as AvatarMotion)
    : 'idle_cold';
}

export function getPersonaLiveClipUrl(_motion: AvatarMotion): string {
  void _motion;
  // Production has one canonical Linglan visual. Motion labels remain useful
  // for future renderers, but must never select archived video variants.
  return `${import.meta.env.BASE_URL}avatar/linglan-current/idle.webm?v=1`;
}

const REACT_RUNTIME_SEGMENTS = [
  '/node_modules/react/',
  '/node_modules/react-dom/',
  '/node_modules/scheduler/',
];

const WORKSPACE_RUNTIME_CHUNKS = [
  ['/packages/chat/dist/', 'chat-runtime'],
  ['/packages/soul/dist/', 'soul-runtime'],
  ['/packages/manneri/dist/', 'host-runtime'],
  ['/packages/comment-intelligence/dist/', 'host-runtime'],
  ['/packages/live-companion/dist/', 'host-runtime'],
] as const;

const APPLICATION_RUNTIME_CHUNKS = [
  ['/react-purupuru-app/src/config/characterprofile.ts', 'profile-runtime'],
  ['/react-purupuru-app/src/config/memoryarchiveseed.ts', 'profile-runtime'],
  ['/react-purupuru-app/src/components/avatarpanel.tsx', 'avatar-runtime'],
  ['/react-purupuru-app/src/lib/purupuru', 'avatar-runtime'],
  ['/react-purupuru-app/src/lib/avatarmotion.ts', 'avatar-runtime'],
  ['/react-purupuru-app/src/lib/digitalhumanavatarstore.ts', 'avatar-runtime'],
] as const;

export function resolveClientChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\', '/').toLowerCase();
  if (
    REACT_RUNTIME_SEGMENTS.some((segment) => normalizedId.includes(segment))
  ) {
    return 'react-runtime';
  }
  return [...WORKSPACE_RUNTIME_CHUNKS, ...APPLICATION_RUNTIME_CHUNKS].find(
    ([segment]) => normalizedId.includes(segment),
  )?.[1];
}

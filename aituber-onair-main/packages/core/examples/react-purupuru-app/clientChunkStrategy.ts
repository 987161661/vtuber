const REACT_RUNTIME_SEGMENTS = [
  '/node_modules/react/',
  '/node_modules/react-dom/',
  '/node_modules/scheduler/',
];

const WORKSPACE_RUNTIME_CHUNKS = [
  ['/packages/chat/', 'chat-runtime'],
  ['/packages/soul/', 'soul-runtime'],
  ['/packages/manneri/', 'host-runtime'],
  ['/packages/comment-intelligence/', 'host-runtime'],
  ['/packages/live-companion/', 'host-runtime'],
] as const;

const APPLICATION_RUNTIME_CHUNKS = [
  ['/react-purupuru-app/src/components/controlroom.tsx', 'control-room'],
  ['/react-purupuru-app/src/components/settingspanel.tsx', 'settings-panel'],
  ['/react-purupuru-app/src/lib/liveoperation.ts', 'host-runtime'],
  ['/react-purupuru-app/src/lib/runtimerecovery.ts', 'host-runtime'],
  ['/react-purupuru-app/src/lib/livesessionauthority.ts', 'host-runtime'],
  ['/react-purupuru-app/src/lib/livesessionlifecycle.ts', 'host-runtime'],
  ['/react-purupuru-app/src/lib/livestartupguide.ts', 'host-runtime'],
  [
    '/react-purupuru-app/src/lib/operatorconfigurationprofile.ts',
    'profile-runtime',
  ],
  ['/react-purupuru-app/src/lib/operatorpreflight.ts', 'profile-runtime'],
  [
    '/react-purupuru-app/src/lib/viewerinteractionaccounting.ts',
    'host-runtime',
  ],
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

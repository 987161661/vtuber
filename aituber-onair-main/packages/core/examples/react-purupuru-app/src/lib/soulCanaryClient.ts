import type { SoulScopeV1 } from '@aituber-onair/soul';

export type SoulCanaryActiveSummary = {
  runId: string;
  scope: SoulScopeV1;
  startedAt: number;
  runtimeOwnerClaimedAt?: number;
};

export type SoulCanaryOperatorCredential = SoulCanaryActiveSummary & {
  version: 1;
  operatorToken: string;
};

export type SoulCanaryRuntimeCredential = SoulCanaryActiveSummary & {
  eventToken: string;
  ownerId: string;
};

type RequestPort = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const OPERATOR_SESSION_KEY = 'aituber:soul-canary-operator:v1';
const PRIVATE_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;

export function createSoulCanaryClient(options: {
  request: RequestPort;
  storage: StoragePort;
}) {
  const clearPersistedOperatorCredential = () => {
    try {
      options.storage.removeItem(OPERATOR_SESSION_KEY);
    } catch {
      // Session storage is an optional convenience, not the authority source.
    }
  };

  const readOperatorCredential = (): SoulCanaryOperatorCredential | null => {
    try {
      const parsed = JSON.parse(
        options.storage.getItem(OPERATOR_SESSION_KEY) || 'null',
      ) as unknown;
      if (!isOperatorCredential(parsed)) {
        clearPersistedOperatorCredential();
        return null;
      }
      return parsed;
    } catch {
      clearPersistedOperatorCredential();
      return null;
    }
  };

  const persistOperatorCredential = (
    credential: SoulCanaryOperatorCredential | null,
  ) => {
    try {
      if (credential) {
        options.storage.setItem(
          OPERATOR_SESSION_KEY,
          JSON.stringify(credential),
        );
      } else {
        clearPersistedOperatorCredential();
      }
    } catch {
      // Keep the server-validated credential usable for the current render.
    }
  };

  const listActive = async (): Promise<SoulCanaryActiveSummary[]> => {
    const response = await options.request(
      '/api/acceptance-ledger?activeCanary=1',
      { cache: 'no-store' },
    );
    const payload = await readJsonObject(response);
    if (!response.ok) {
      throw new Error(errorFrom(payload, 'soul_canary_list_failed'));
    }
    return Array.isArray(payload.activeCanaries)
      ? payload.activeCanaries.filter(isActiveSummary)
      : [];
  };

  return {
    readOperatorCredential,

    clearOperatorCredential() {
      persistOperatorCredential(null);
    },

    listActive,

    async start(scope: SoulScopeV1): Promise<SoulCanaryOperatorCredential> {
      const response = await options.request('/api/acceptance-ledger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runtime-Settings-Role': 'producer',
        },
        body: JSON.stringify({ action: 'start-soul-canary', scope }),
      });
      const payload = await readJsonObject(response);
      if (!response.ok || !isStartResponse(payload)) {
        throw new Error(errorFrom(payload, 'soul_canary_start_failed'));
      }
      const credential: SoulCanaryOperatorCredential = {
        version: 1,
        runId: payload.runId,
        operatorToken: payload.operatorToken,
        scope: payload.scope,
        startedAt: payload.startedAt,
      };
      persistOperatorCredential(credential);
      return credential;
    },

    async claimRuntimeForScope(
      scope: SoulScopeV1,
      ownerId: string,
      current?: SoulCanaryRuntimeCredential | null,
    ): Promise<SoulCanaryRuntimeCredential | null> {
      const active = (await listActive()).find((candidate) =>
        sameSoulScope(candidate.scope, scope),
      );
      if (!active) return null;
      if (current?.runId === active.runId && current.ownerId === ownerId) {
        return current;
      }
      const response = await options.request('/api/acceptance-ledger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runtime-Owner-Id': ownerId,
        },
        body: JSON.stringify({
          action: 'claim-soul-canary-runtime',
          scope,
        }),
      });
      const payload = await readJsonObject(response);
      if (
        !response.ok ||
        !isRuntimeClaimResponse(payload) ||
        payload.runId !== active.runId ||
        !sameSoulScope(payload.scope, scope)
      ) {
        throw new Error(errorFrom(payload, 'soul_canary_runtime_claim_failed'));
      }
      return {
        runId: payload.runId,
        eventToken: payload.eventToken,
        scope: payload.scope,
        startedAt: payload.startedAt,
        ownerId,
      };
    },

    runtimeEventHeaders(
      credential: SoulCanaryRuntimeCredential | null,
      scope: SoulScopeV1,
      ownerId: string,
    ): Record<string, string> {
      if (
        !credential ||
        credential.ownerId !== ownerId ||
        !sameSoulScope(credential.scope, scope)
      ) {
        return {};
      }
      return {
        'X-Soul-Canary-Run': credential.runId,
        'X-Soul-Canary-Token': credential.eventToken,
        'X-Runtime-Owner-Id': ownerId,
      };
    },

    async finish(credential: SoulCanaryOperatorCredential): Promise<void> {
      await closeCanary('finish', credential, options.request);
      persistOperatorCredential(null);
    },

    async abort(credential: SoulCanaryOperatorCredential): Promise<void> {
      await closeCanary('abort', credential, options.request);
      persistOperatorCredential(null);
    },
  };
}

export function sameSoulScope(left: SoulScopeV1, right: SoulScopeV1): boolean {
  return (
    left.personaId === right.personaId &&
    left.platform === right.platform &&
    left.roomId === right.roomId &&
    left.sessionId === right.sessionId
  );
}

async function closeCanary(
  action: 'finish' | 'abort',
  credential: SoulCanaryOperatorCredential,
  request: RequestPort,
) {
  const response = await request('/api/acceptance-ledger', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Runtime-Settings-Role': 'producer',
      'X-Soul-Canary-Operator-Token': credential.operatorToken,
    },
    body: JSON.stringify({
      action: `${action}-soul-canary`,
      runId: credential.runId,
      ...(action === 'abort'
        ? { reasonCode: 'operator-aborted-from-soul-inspector' }
        : {}),
    }),
  });
  const payload = await readJsonObject(response);
  if (!response.ok) {
    throw new Error(errorFrom(payload, `soul_canary_${action}_failed`));
  }
}

function isOperatorCredential(
  value: unknown,
): value is SoulCanaryOperatorCredential {
  if (!isActiveSummary(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.operatorToken === 'string' &&
    PRIVATE_TOKEN_PATTERN.test(candidate.operatorToken)
  );
}

function isActiveSummary(value: unknown): value is SoulCanaryActiveSummary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.runId === 'string' &&
    candidate.runId.length > 0 &&
    typeof candidate.startedAt === 'number' &&
    Number.isFinite(candidate.startedAt) &&
    isSoulScope(candidate.scope) &&
    (candidate.runtimeOwnerClaimedAt === undefined ||
      (typeof candidate.runtimeOwnerClaimedAt === 'number' &&
        Number.isFinite(candidate.runtimeOwnerClaimedAt)))
  );
}

function isStartResponse(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  runId: string;
  operatorToken: string;
  scope: SoulScopeV1;
  startedAt: number;
} {
  if (!isActiveSummary(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.operatorToken === 'string' &&
    PRIVATE_TOKEN_PATTERN.test(candidate.operatorToken)
  );
}

function isRuntimeClaimResponse(
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  runId: string;
  eventToken: string;
  scope: SoulScopeV1;
  startedAt: number;
} {
  if (!isActiveSummary(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.eventToken === 'string' &&
    PRIVATE_TOKEN_PATTERN.test(candidate.eventToken)
  );
}

function isSoulScope(value: unknown): value is SoulScopeV1 {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Record<string, unknown>;
  return ['personaId', 'platform', 'roomId', 'sessionId'].every(
    (key) => typeof scope[key] === 'string' && scope[key].length > 0,
  );
}

async function readJsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const payload = (await response.json().catch(() => ({}))) as unknown;
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function errorFrom(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.error === 'string' ? payload.error : fallback;
}

import type { AppSettings } from '../types/settings';

export type ImprovementExperimentContext = {
  id: string;
  label: string;
};

type ImprovementExperimentScope = {
  personaId: string;
  platform: string;
  roomId: string;
};

const CONTEXT_SCHEMA_VERSION = 1;
const SECRET_FIELD_PATTERN =
  /(?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|authorization)/iu;

function canonicalize(value: unknown, key = ''): unknown {
  if (SECRET_FIELD_PATTERN.test(key)) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entryKey, entryValue]) => [
        entryKey,
        canonicalize(entryValue, entryKey),
      ])
      .filter((entry) => entry[1] !== undefined),
  );
}

function compactFingerprint(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193);
    djb = Math.imul(djb, 33) ^ code;
  }
  return `${(fnv >>> 0).toString(36)}-${(djb >>> 0).toString(36)}`;
}

export function createImprovementExperimentContext(input: {
  settings: AppSettings;
  scope: ImprovementExperimentScope;
  autoBroadcastEnabled: boolean;
}): ImprovementExperimentContext {
  const { settings, scope } = input;
  const profile = settings.digitalHumans.profiles.find(
    ({ id }) => id === scope.personaId,
  );
  const nativeDelivery =
    scope.platform === 'bilibili'
      ? {
          enabled: settings.stream.bilibiliEnabled,
          viewerReplies: settings.stream.bilibiliReplyEnabled,
        }
      : scope.platform === 'youtube'
        ? { enabled: settings.stream.youtubeEnabled }
        : scope.platform === 'twitch'
          ? { enabled: settings.stream.twitchEnabled }
          : scope.platform === 'custom-sse'
            ? { enabled: settings.stream.customSseEnabled }
            : undefined;
  const contextShape = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    persona: profile
      ? {
          id: profile.id,
          enabled: profile.enabled,
          displayName: profile.displayName,
          title: profile.title,
          description: profile.description,
          persona: profile.persona,
          memory: profile.memory,
          voiceSpeaker: profile.voiceSpeaker,
          installedSkillIds: [...profile.installedSkillIds].sort(),
        }
      : { id: scope.personaId, missing: true },
    soul: settings.soul,
    llm: {
      provider: settings.llm.provider,
      model: settings.llm.model,
      endpoint: settings.llm.endpoint,
      xaiReasoningEffort: settings.llm.xaiReasoningEffort,
    },
    tts: settings.tts,
    screenVision: {
      enabled: settings.screenVision.enabled,
      prompt: settings.screenVision.prompt,
      autoIntervalMs: settings.screenVision.autoIntervalMs,
    },
    commentIntelligence: settings.commentIntelligence,
    manneri: settings.manneri,
    emptyRoomAwareness: settings.emptyRoomAwareness,
    delivery: {
      autoBroadcastEnabled: input.autoBroadcastEnabled,
      native: nativeDelivery,
      ordinaryRoad:
        settings.liveConnectors.ordinaryRoad.platforms[scope.platform]
          ?.outbound,
      socialStreamNinja:
        settings.liveConnectors.socialStreamNinja.platforms[scope.platform]
          ?.outbound,
    },
  };
  const modelLabel =
    settings.llm.model.trim() || `${settings.llm.provider} 默认模型`;
  return {
    id: `experiment-v${CONTEXT_SCHEMA_VERSION}-${compactFingerprint(contextShape)}`,
    label: `${modelLabel} · ${settings.tts.engine} · ${
      input.autoBroadcastEnabled ? '自动播出' : '人工播出'
    }`,
  };
}

export function crossesImprovementExperimentContext(input: {
  actionContextId?: string;
  baseContextId?: string;
  nextContextId?: string;
}): boolean {
  const actionContextId = input.actionContextId?.trim();
  const baseContextId = input.baseContextId?.trim();
  const nextContextId = input.nextContextId?.trim();
  if (actionContextId) {
    return (
      baseContextId !== actionContextId || nextContextId !== actionContextId
    );
  }
  return Boolean(
    baseContextId && nextContextId && baseContextId !== nextContextId,
  );
}

export const SERVER_MANAGED_CREDENTIAL = '__server_managed__';

type UnknownRecord = Record<string, unknown>;

const SECRET_FIELD_PATTERN =
  /(?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|authorization)/i;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function redactValue(value: unknown, replacement: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, replacement));
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key === 'apiKeys' && isRecord(item)) {
        return [
          key,
          Object.fromEntries(
            Object.keys(item).map((provider) => [provider, replacement]),
          ),
        ];
      }
      if (SECRET_FIELD_PATTERN.test(key)) return [key, replacement];
      return [key, redactValue(item, replacement)];
    }),
  );
}

function configuredString(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim() !== SERVER_MANAGED_CREDENTIAL
  );
}

export function isServerManagedCredential(value: unknown): boolean {
  return (
    typeof value === 'string' && value.trim() === SERVER_MANAGED_CREDENTIAL
  );
}

function configuredCredential(value: unknown): boolean {
  return configuredString(value) || isServerManagedCredential(value);
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/u, '');
}

function isMiniMaxChatEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string' || !endpoint.trim()) return false;
  try {
    const url = new URL(endpoint);
    return (
      /(^|\.)minimaxi\.com$/iu.test(url.hostname) ||
      url.pathname.endsWith('/api/minimax-chat')
    );
  } catch {
    return false;
  }
}

/**
 * Produces the only settings shape that may cross the local HTTP boundary.
 * Real credentials remain in the server-held runtime snapshot. A non-secret
 * marker tells a playback client that the same-origin gateway is configured.
 */
export function sanitizeRuntimeSettingsForBrowser(
  settings: unknown,
  origin: string,
): unknown {
  const sanitized = redactValue(settings, '');
  if (!isRecord(settings) || !isRecord(sanitized)) return sanitized;

  const originalTts = isRecord(settings.tts) ? settings.tts : undefined;
  const sanitizedTts = isRecord(sanitized.tts) ? sanitized.tts : undefined;
  const originalLlm = isRecord(settings.llm) ? settings.llm : undefined;
  const sanitizedLlm = isRecord(sanitized.llm) ? sanitized.llm : undefined;
  const originalKeys = isRecord(originalLlm?.apiKeys)
    ? originalLlm.apiKeys
    : undefined;
  const sanitizedKeys = isRecord(sanitizedLlm?.apiKeys)
    ? sanitizedLlm.apiKeys
    : undefined;
  const miniMaxCredentialConfigured =
    configuredCredential(originalKeys?.['openai-compatible']) ||
    configuredCredential(originalTts?.minimaxApiKey);
  if (
    originalLlm?.provider === 'openai-compatible' &&
    miniMaxCredentialConfigured &&
    isMiniMaxChatEndpoint(originalLlm.endpoint) &&
    sanitizedLlm &&
    sanitizedKeys
  ) {
    sanitizedKeys['openai-compatible'] = SERVER_MANAGED_CREDENTIAL;
    sanitizedLlm.endpoint = `${normalizeOrigin(origin)}/api/minimax-chat`;
  }

  if (miniMaxCredentialConfigured && sanitizedTts) {
    sanitizedTts.minimaxApiKey = SERVER_MANAGED_CREDENTIAL;
  }

  return sanitized;
}

/**
 * Browser persistence is a public cache, never a credential store. Existing
 * server markers survive, but an unacknowledged raw value becomes empty so a
 * reload cannot invent managed status or resurrect a local credential.
 */
export function sanitizeRuntimeSettingsForBrowserStorage<T>(
  settings: T,
  origin: string,
): T {
  const sanitized = redactValue(settings, '') as T;
  if (!isRecord(settings) || !isRecord(sanitized)) return sanitized;

  const originalTts = isRecord(settings.tts) ? settings.tts : undefined;
  const sanitizedTts = isRecord(sanitized.tts) ? sanitized.tts : undefined;
  const originalLlm = isRecord(settings.llm) ? settings.llm : undefined;
  const sanitizedLlm = isRecord(sanitized.llm) ? sanitized.llm : undefined;
  const originalKeys = isRecord(originalLlm?.apiKeys)
    ? originalLlm.apiKeys
    : undefined;
  const sanitizedKeys = isRecord(sanitizedLlm?.apiKeys)
    ? sanitizedLlm.apiKeys
    : undefined;

  if (
    originalLlm?.provider === 'openai-compatible' &&
    isServerManagedCredential(originalKeys?.['openai-compatible']) &&
    isMiniMaxChatEndpoint(originalLlm.endpoint) &&
    sanitizedLlm &&
    sanitizedKeys
  ) {
    sanitizedKeys['openai-compatible'] = SERVER_MANAGED_CREDENTIAL;
    sanitizedLlm.endpoint = `${normalizeOrigin(origin)}/api/minimax-chat`;
  }
  if (
    isServerManagedCredential(originalTts?.minimaxApiKey) &&
    sanitizedTts
  ) {
    sanitizedTts.minimaxApiKey = SERVER_MANAGED_CREDENTIAL;
  }
  return sanitized;
}

/** Removes all transient credentials without manufacturing managed status. */
export function discardRuntimeCredentialsForBrowser<T>(settings: T): T {
  return redactValue(settings, '') as T;
}

/** True only for an actual credential, never for the public managed marker. */
export function hasRawRuntimeCredential(settings: unknown): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some((item) => visit(item));
    if (!isRecord(value)) return false;

    return Object.entries(value).some(([key, item]) => {
      if (key === 'apiKeys' && isRecord(item)) {
        return Object.values(item).some(configuredString);
      }
      if (SECRET_FIELD_PATTERN.test(key)) return configuredString(item);
      return visit(item);
    });
  };
  return visit(settings);
}

/** A marker proves server configuration, but must never authenticate a call. */
export function resolveBrowserCredential(value: unknown): string {
  if (isServerManagedCredential(value)) return '';
  return typeof value === 'string' ? value : '';
}

/**
 * A public server envelope is authoritative for server-managed credentials.
 * Credentials for providers that still run directly in the browser remain
 * memory-only until those providers gain a same-origin gateway; they are
 * never copied into browser persistence.
 */
export function mergeBrowserOnlyCredentialsAfterPublish<T>(
  published: T,
  transient: T,
): T {
  const merge = (
    publicValue: unknown,
    transientValue: unknown,
    credentialMap = false,
  ): unknown => {
    if (!isRecord(publicValue) || !isRecord(transientValue)) {
      return publicValue;
    }
    return Object.fromEntries(
      Object.entries(publicValue).map(([key, value]) => {
        const transientItem = transientValue[key];
        if (
          key === 'apiKeys' &&
          isRecord(value) &&
          isRecord(transientItem)
        ) {
          return [key, merge(value, transientItem, true)];
        }
        const isCredential = credentialMap || SECRET_FIELD_PATTERN.test(key);
        if (isCredential) {
          if (isServerManagedCredential(value)) return [key, value];
          return [
            key,
            configuredString(transientItem) ? transientItem : value,
          ];
        }
        if (isRecord(value) && isRecord(transientItem)) {
          return [key, merge(value, transientItem)];
        }
        return [key, value];
      }),
    );
  };

  return merge(published, transient) as T;
}

/** Returns a diagnostic-safe snapshot while retaining configuration shape. */
export function redactRuntimeSettingsForAudit(settings: unknown): unknown {
  return redactValue(settings, '[configured]');
}

function safeEndpointHost(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

/**
 * Produces a deliberately small audit record. Runtime settings can contain
 * large prompt/profile payloads and credentials, neither of which belongs in
 * an append-only operational log.
 */
export function summarizeRuntimeSettingsForAudit(settings: unknown): unknown {
  if (!isRecord(settings)) return null;

  const llm = isRecord(settings.llm) ? settings.llm : {};
  const apiKeys = isRecord(llm.apiKeys) ? llm.apiKeys : {};
  const tts = isRecord(settings.tts) ? settings.tts : {};
  const stream = isRecord(settings.stream) ? settings.stream : {};
  const digitalHumans = isRecord(settings.digitalHumans)
    ? settings.digitalHumans
    : {};
  const soul = isRecord(settings.soul) ? settings.soul : {};

  return {
    schemaVersion: 1,
    llm: {
      provider: typeof llm.provider === 'string' ? llm.provider : null,
      model: typeof llm.model === 'string' ? llm.model : null,
      endpointHost: safeEndpointHost(llm.endpoint),
      credentialConfigured: Object.values(apiKeys).some(configuredCredential),
    },
    tts: {
      engine: typeof tts.engine === 'string' ? tts.engine : null,
      speaker: typeof tts.speaker === 'string' ? tts.speaker : null,
      credentialConfigured: configuredCredential(tts.minimaxApiKey),
      groupConfigured: configuredCredential(tts.minimaxGroupId),
    },
    stream: {
      platform: typeof stream.platform === 'string' ? stream.platform : null,
      credentialConfigured: Object.entries(stream).some(
        ([key, value]) => SECRET_FIELD_PATTERN.test(key) && configuredCredential(value),
      ),
    },
    digitalHuman: {
      activeId:
        typeof digitalHumans.activeId === 'string'
          ? digitalHumans.activeId
          : null,
      profileCount: Array.isArray(digitalHumans.profiles)
        ? digitalHumans.profiles.length
        : 0,
    },
    soulRuntimeMode:
      typeof soul.runtimeMode === 'string' ? soul.runtimeMode : null,
  };
}

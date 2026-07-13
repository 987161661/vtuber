export interface HostExtensionInput {
  query: string;
  inheritedSkillIds: readonly string[];
  simulatedFaultIds?: readonly string[];
}

export interface HostExtensionVision {
  capture: () => Promise<string | null>;
  buildPrompt: (viewerText: string, context: string) => string;
}

export interface HostExtensionResult {
  context: string;
  skills: string[];
  isDomainSensitive?: boolean;
  fallbackReply?: string;
  forceFallback?: boolean;
  payload?: Record<string, unknown>;
  vision?: HostExtensionVision;
}

export interface HostExtension {
  id: string;
  enrich: (input: HostExtensionInput) => Promise<HostExtensionResult | null>;
}

export async function enrichWithHostExtensions(
  extensions: readonly HostExtension[],
  input: HostExtensionInput,
): Promise<HostExtensionResult> {
  const results = (await Promise.all(extensions.map((extension) => extension.enrich(input))))
    .filter((result): result is HostExtensionResult => result !== null);

  return {
    context: results.map((result) => result.context).filter(Boolean).join('\n\n'),
    skills: results.flatMap((result) => result.skills),
    isDomainSensitive: results.some((result) => result.isDomainSensitive),
    fallbackReply: results.find((result) => result.fallbackReply)?.fallbackReply,
    forceFallback: results.some((result) => result.forceFallback),
    payload: results.find((result) => result.payload)?.payload,
    vision: results.find((result) => result.vision)?.vision,
  };
}

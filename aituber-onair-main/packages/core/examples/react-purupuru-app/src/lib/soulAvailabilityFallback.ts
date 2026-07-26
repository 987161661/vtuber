import type { SoulActionPrimitive, SoulEventV1 } from '@aituber-onair/soul';

export interface SoulAvailabilityFallback {
  action: SoulActionPrimitive;
  utterance?: string;
  confidence: number;
  attribution: 'viewer' | 'unknown';
  reasonCode: string;
}

/**
 * Keeps provider availability policy identical in the server adapter and the
 * browser network fallback. Audience turns remain speakable; non-interactive
 * ticks may still deliberately wait.
 */
export function resolveSoulAvailabilityFallback(
  event: SoulEventV1,
): SoulAvailabilityFallback {
  if (event.kind === 'gift') {
    return {
      action: 'acknowledge',
      utterance: '心意我收到了，谢谢你。你不用因此有任何压力。',
      confidence: 0.55,
      attribution: 'viewer',
      reasonCode: 'provider-unavailable-safe-support-acknowledgement',
    };
  }
  if (event.urgency === 'high' || event.urgency === 'urgent') {
    return {
      action: 'acknowledge',
      utterance: '我先把安全放在前面，这条我会谨慎处理。',
      confidence: 0,
      attribution: 'unknown',
      reasonCode: 'provider-unavailable-safety-realizer-required',
    };
  }
  if (event.kind === 'audience-message') {
    return {
      action: 'acknowledge',
      utterance: '我在，听见了。这条我先接住，我们接着聊。',
      confidence: 0.35,
      attribution: event.actor?.kind === 'viewer' ? 'viewer' : 'unknown',
      reasonCode: 'provider-unavailable-safe-audience-acknowledgement',
    };
  }
  return {
    action: 'delay',
    confidence: 0,
    attribution: 'unknown',
    reasonCode: 'provider-unavailable-delay',
  };
}

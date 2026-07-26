export type AudioGraphResource = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  released: boolean;
};

/**
 * Break every edge that can keep a decoded speech buffer reachable from the
 * long-lived analyser graph. Safe to call from both stop and onended paths.
 */
export function releaseAudioGraphResource(
  resource: AudioGraphResource,
): boolean {
  if (resource.released) return false;
  resource.released = true;
  resource.source.onended = null;
  resource.source.buffer = null;
  try {
    resource.source.disconnect();
  } catch {
    // The source may already have been detached by the browser.
  }
  try {
    resource.gain.disconnect();
  } catch {
    // The gain may already have been detached by an interrupting stop.
  }
  return true;
}

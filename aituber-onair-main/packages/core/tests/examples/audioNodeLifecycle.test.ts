import { describe, expect, it, vi } from 'vitest';
import { releaseAudioGraphResource } from '../../examples/react-purupuru-app/src/lib/audioNodeLifecycle';

describe('audio node lifecycle', () => {
  it('releases every node and decoded buffer exactly once', () => {
    const source = {
      buffer: {} as AudioBuffer,
      disconnect: vi.fn(),
      onended: vi.fn(),
    };
    const gain = {
      disconnect: vi.fn(),
    };
    const resource = {
      source: source as unknown as AudioBufferSourceNode,
      gain: gain as unknown as GainNode,
      released: false,
    };

    expect(releaseAudioGraphResource(resource)).toBe(true);
    expect(releaseAudioGraphResource(resource)).toBe(false);
    expect(source.buffer).toBeNull();
    expect(source.onended).toBeNull();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
  });
});

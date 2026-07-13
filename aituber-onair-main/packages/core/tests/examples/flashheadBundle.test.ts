import { describe, expect, it } from 'vitest';
import { parseFlashHeadBundle } from '../../examples/react-purupuru-app/src/lib/flashheadBundle';

function createBundle(audio: number[], video: number[]): Uint8Array {
  const bundle = new Uint8Array(4 + audio.length + video.length);
  new DataView(bundle.buffer).setUint32(0, audio.length);
  bundle.set(audio, 4);
  bundle.set(video, 4 + audio.length);
  return bundle;
}

describe('parseFlashHeadBundle', () => {
  it('returns the renderer-aligned audio and video from an offset view', () => {
    const audio = [82, 73, 70, 70, 1, 2, 3];
    const video = [26, 69, 223, 163];
    const bundle = createBundle(audio, video);
    const backing = new Uint8Array(bundle.byteLength + 6);
    backing.set(bundle, 3);

    const parsed = parseFlashHeadBundle(
      backing.subarray(3, 3 + bundle.byteLength),
    );

    expect(Array.from(new Uint8Array(parsed.audioBuffer))).toEqual(audio);
    expect(Array.from(new Uint8Array(parsed.videoBuffer))).toEqual(video);
  });

  it.each([new Uint8Array(), createBundle([], [1]), createBundle([1], [])])(
    'rejects an incomplete media bundle',
    (payload) => {
      expect(() => parseFlashHeadBundle(payload)).toThrow(
        /Speaking avatar bundle/,
      );
    },
  );
});

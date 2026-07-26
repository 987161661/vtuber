import { describe, expect, it } from 'vitest';
import { resolveAvatarLayerVisibility } from '../../examples/react-purupuru-app/src/lib/speakingAvatarPresentation';

describe('speaking avatar presentation', () => {
  it('shows rendered speaking media even when the idle avatar uses the canvas', () => {
    expect(
      resolveAvatarLayerVisibility({
        usePersonaLiveAvatar: false,
        speakingAvatarVideoUrl: 'blob:http://localhost/rendered-speech',
      }),
    ).toEqual({
      showIdleVideo: false,
      showSpeakingVideo: true,
      showCanvas: true,
    });
  });

  it('keeps the speaking layer absent until rendered media is ready', () => {
    expect(
      resolveAvatarLayerVisibility({
        usePersonaLiveAvatar: true,
        speakingAvatarVideoUrl: null,
      }),
    ).toEqual({
      showIdleVideo: true,
      showSpeakingVideo: false,
      showCanvas: false,
    });
  });
});

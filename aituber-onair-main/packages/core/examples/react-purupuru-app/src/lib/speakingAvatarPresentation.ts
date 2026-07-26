export function resolveAvatarLayerVisibility(input: {
  usePersonaLiveAvatar: boolean;
  speakingAvatarVideoUrl: string | null;
}) {
  return {
    showIdleVideo: input.usePersonaLiveAvatar,
    showSpeakingVideo: Boolean(input.speakingAvatarVideoUrl),
    showCanvas: !input.usePersonaLiveAvatar,
  };
}

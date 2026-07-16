export type ParsedFlashHeadBundle = {
  audioBuffer: ArrayBuffer;
  videoBuffer: ArrayBuffer;
};

export function parseFlashHeadBundle(
  payload: Uint8Array,
): ParsedFlashHeadBundle {
  if (payload.byteLength < 5) {
    throw new Error('Speaking avatar bundle is empty');
  }

  const audioLength = new DataView(
    payload.buffer,
    payload.byteOffset,
    4,
  ).getUint32(0);
  const videoOffset = 4 + audioLength;
  if (audioLength === 0 || videoOffset >= payload.byteLength) {
    throw new Error('Speaking avatar bundle is invalid');
  }

  return {
    // FlashHead renders the video against this aligned WAV. Playing the
    // original compressed TTS input introduces encoder and duration drift.
    audioBuffer: new Uint8Array(payload.slice(4, videoOffset)).buffer,
    videoBuffer: new Uint8Array(payload.slice(videoOffset)).buffer,
  };
}

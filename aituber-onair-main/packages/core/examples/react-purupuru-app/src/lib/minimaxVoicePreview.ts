export interface MinimaxVoiceOption {
  voice_id: string;
  voice_name: string;
}

let activePreview: HTMLAudioElement | null = null;
let activePreviewUrl: string | null = null;

function clearPreview() {
  activePreview?.pause();
  activePreview = null;
  if (activePreviewUrl) URL.revokeObjectURL(activePreviewUrl);
  activePreviewUrl = null;
}

function decodeHexAudio(source: string): ArrayBuffer {
  if (!/^[\da-f]+$/i.test(source) || source.length % 2) {
    throw new Error('MiniMax returned an invalid preview audio payload');
  }
  const bytes = new Uint8Array(source.length / 2);
  for (let index = 0; index < source.length; index += 2) {
    bytes[index / 2] = Number.parseInt(source.slice(index, index + 2), 16);
  }
  return bytes.buffer;
}

export async function fetchMinimaxVoiceOptions(apiKey: string): Promise<MinimaxVoiceOption[]> {
  if (!apiKey.trim()) return [];
  const response = await fetch('https://api.minimaxi.com/v1/get_voice', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_type: 'all' }),
  });
  if (!response.ok) throw new Error(`MiniMax voice list request failed (${response.status})`);
  const payload = await response.json() as {
    base_resp?: { status_code?: number; status_msg?: string };
    system_voice?: MinimaxVoiceOption[];
    voice_cloning?: MinimaxVoiceOption[];
    voice_generation?: MinimaxVoiceOption[];
  };
  if (payload.base_resp?.status_code && payload.base_resp.status_code !== 0) {
    throw new Error(payload.base_resp.status_msg || 'MiniMax rejected the voice list request');
  }
  return [
    ...(payload.system_voice || []),
    ...(payload.voice_cloning || []),
    ...(payload.voice_generation || []),
  ].map((voice) => ({
    voice_id: voice.voice_id,
    voice_name: voice.voice_name || voice.voice_id,
  }));
}

export async function previewMinimaxVoice(
  apiKey: string,
  voiceId: string,
  text = '你好，我是你的数字人主播。现在正在进行音色试听。',
): Promise<void> {
  if (!apiKey.trim()) throw new Error('请先在运行配置中填写 MiniMax API 密钥。');
  if (!voiceId.trim()) throw new Error('请选择一个音色。');
  clearPreview();
  const response = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'speech-2.8-turbo',
      text: text.slice(0, 100),
      stream: false,
      voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 0, emotion: 'neutral' },
      audio_setting: { sample_rate: 44100, bitrate: 128000, format: 'mp3', channel: 1 },
      language_boost: 'Chinese',
    }),
  });
  if (!response.ok) throw new Error(`MiniMax试听请求失败（${response.status}）`);
  const payload = await response.json() as {
    base_resp?: { status_code?: number; status_msg?: string };
    data?: { audio?: string };
  };
  if (payload.base_resp?.status_code && payload.base_resp.status_code !== 0) {
    throw new Error(payload.base_resp.status_msg || 'MiniMax未能生成试听。');
  }
  if (!payload.data?.audio) throw new Error('MiniMax未返回试听音频。');
  activePreviewUrl = URL.createObjectURL(new Blob([decodeHexAudio(payload.data.audio)], { type: 'audio/mpeg' }));
  activePreview = new Audio(activePreviewUrl);
  activePreview.onended = clearPreview;
  await activePreview.play();
}

export function stopMinimaxVoicePreview() {
  clearPreview();
}

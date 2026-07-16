import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const baseUrl = process.env.MINIMAX_PROBE_URL ?? 'http://127.0.0.1:5173';
const outputDir = resolve(process.cwd(), '.runtime', 'minimax-emotion-probe');
const text = '我只是慢半拍，不是没听见。';

const nativeEmotionCases = [
  ['N01', 'neutral'],
  ['N02', 'happy'],
  ['N03', 'sad'],
  ['N04', 'angry'],
  ['N05', 'surprised'],
  ['N06', 'fearful'],
  ['N07', 'disgusted'],
  ['N08', 'calm'],
  ['N09', 'fluent'],
  ['N10', 'whisper'],
  ['N11', 'neutral'],
];

// These are the exact acoustic results the current eight-axis adapter would
// send to MiniMax for +1 on each axis, with the rest held at zero.
const prosodyCases = [
  ['P00', { speed: 1, vol: 1, pitch: 0 }],
  ['P01', { speed: 1.12, vol: 1, pitch: 0 }], // pace
  ['P02', { speed: 1, vol: 1, pitch: 2 }], // pitch
  ['P03', { speed: 1, vol: 1.12, pitch: 0 }], // volume
  ['P04', { speed: 1, vol: 1, pitch: 0 }], // warmth is currently a pitch delta at -1; pair below keeps it audible
  ['P05', { speed: 1.035, vol: 1, pitch: 1 }], // tension
  ['P06', { speed: 1.06, vol: 1.05, pitch: 0 }], // energy
  ['P07', { speed: 1, vol: 1.04, pitch: 0 }], // assertiveness
  ['P08', { speed: 0.975, vol: 0.96, pitch: 0 }], // breathiness
  ['P09', { speed: 1, vol: 1, pitch: 0 }], // warmth: current quantized result
  ['P10', { speed: 1, vol: 1, pitch: 0 }], // repeated baseline
];

async function synthesize(id, voiceSetting) {
  const response = await fetch(`${baseUrl}/api/minimax-tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'speech-2.8-turbo',
      text,
      stream: false,
      voice_setting: voiceSetting,
      audio_setting: {
        sample_rate: 44100,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
      language_boost: 'Chinese',
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.base_resp?.status_code || !payload.data?.audio) {
    return {
      id,
      error: payload.base_resp?.status_msg ?? `HTTP ${response.status}`,
    };
  }
  const audio = Buffer.from(payload.data.audio, 'hex');
  await writeFile(resolve(outputDir, `${id}.mp3`), audio);
  return {
    id,
    bytes: audio.length,
    sha256: createHash('sha256').update(audio).digest('hex'),
  };
}

await mkdir(outputDir, { recursive: true });
const results = [];
for (const [id, emotion] of nativeEmotionCases) {
  results.push(await synthesize(id, { voice_id: 'Chinese (Mandarin)_Wise_Women', speed: 1, vol: 1, pitch: 0, emotion }));
}
for (const [id, controls] of prosodyCases) {
  results.push(await synthesize(id, { voice_id: 'Chinese (Mandarin)_Wise_Women', ...controls }));
}
await writeFile(
  resolve(outputDir, 'README.txt'),
  [
    `Text: ${text}`,
    'N01-N11: native emotion parameter probe; N01 and N11 are repeated neutral baselines.',
    'P00-P10: prosody control probe; P00 and P10 are repeated baselines.',
    'Judge without labels first. Record whether samples differ from their repeated baseline and whether the distinction matches the desired feeling.',
    ...results.map((result) =>
      'error' in result
        ? `${result.id}: rejected (${result.error})`
        : `${result.id}: ${result.bytes} bytes, sha256=${result.sha256}`,
    ),
  ].join('\n'),
  'utf8',
);
console.log(JSON.stringify({ outputDir, results }, null, 2));

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptDirectory, '..');
const runtimeConfig = await readFile(
  path.join(appDirectory, 'public', 'runtime-config.js'),
  'utf8',
);
const apiKey = runtimeConfig.match(/sk-[A-Za-z0-9_-]{16,}/)?.[0];
if (!apiKey) throw new Error('MiniMax API key is missing.');

const candidates = {
  A: 'Chinese (Mandarin)_Wise_Women',
  B: 'female-chengshu-jingpin',
  C: 'Chinese (Mandarin)_News_Anchor',
  D: 'wumei_yujie',
  E: 'Arrogant_Miss',
};
const outputDirectory = path.join(appDirectory, 'public', 'voice-audition');
await mkdir(outputDirectory, { recursive: true });

for (const [label, voiceId] of Object.entries(candidates)) {
  const response = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'speech-2.8-turbo',
      text: '窗关好，别让我重复第二遍。路径还没定，你倒先替它登陆了？',
      stream: false,
      voice_setting: {
        voice_id: voiceId,
        speed: 0.86,
        vol: 1,
        pitch: -1,
        emotion: 'neutral',
      },
      audio_setting: {
        format: 'mp3',
        sample_rate: 32000,
        bitrate: 128000,
        channel: 1,
      },
      language_boost: 'Chinese',
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.base_resp?.status_code !== 0) {
    throw new Error(
      `${label} synthesis failed: ${payload.base_resp?.status_msg || response.status}`,
    );
  }
  const audioHex = payload.data?.audio;
  if (!audioHex) throw new Error(`${label} returned no audio.`);
  await writeFile(path.join(outputDirectory, `${label}.mp3`), audioHex, 'hex');
}

console.log(`Generated ${Object.keys(candidates).length} blind samples.`);

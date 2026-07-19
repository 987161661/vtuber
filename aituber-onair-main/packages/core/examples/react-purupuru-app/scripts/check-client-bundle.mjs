import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsDirectory = fileURLToPath(
  new URL('../dist/assets/', import.meta.url),
);
const maximumChunkBytes = 500 * 1024;
const requiredLazyChunks = [
  'ControlRoom-',
  'SettingsPanel-',
  'VoiceEngineFactory-',
  'SimulatorRoomConsole-',
  'LiveConnectorConsole-',
  'BroadcastTopologyPanel-',
  'SoulInspectorPanel-',
];

const assetNames = await readdir(assetsDirectory);
const javascriptChunks = await Promise.all(
  assetNames
    .filter((name) => name.endsWith('.js'))
    .map(async (name) => ({
      name,
      bytes: (await stat(join(assetsDirectory, name))).size,
    })),
);

const oversizedChunks = javascriptChunks.filter(
  ({ bytes }) => bytes > maximumChunkBytes,
);
if (oversizedChunks.length > 0) {
  throw new Error(
    `Client chunk budget exceeded: ${oversizedChunks
      .map(({ name, bytes }) => `${name}=${bytes} bytes`)
      .join(', ')}`,
  );
}

const missingLazyChunks = requiredLazyChunks.filter(
  (prefix) => !javascriptChunks.some(({ name }) => name.startsWith(prefix)),
);
if (missingLazyChunks.length > 0) {
  throw new Error(
    `Required lazy client chunks are missing: ${missingLazyChunks.join(', ')}`,
  );
}

const largestChunk = javascriptChunks.toSorted((a, b) => b.bytes - a.bytes)[0];
console.log(
  `Client bundle budget passed: ${javascriptChunks.length} chunks, largest ${largestChunk.name}=${largestChunk.bytes} bytes.`,
);

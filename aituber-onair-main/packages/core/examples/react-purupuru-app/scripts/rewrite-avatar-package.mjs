import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const [, , archiveArgument, characterName, description] = process.argv;

if (!archiveArgument || !characterName || !description) {
  throw new Error(
    'Usage: node rewrite-avatar-package.mjs <archive> <characterName> <description>',
  );
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptDirectory, '..');
const avatarDirectory = path.join(appDirectory, 'public', 'avatar');
const archivePath = path.resolve(appDirectory, archiveArgument);
const relativePath = path.relative(avatarDirectory, archivePath);

if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
  throw new Error('The avatar archive must stay inside public/avatar.');
}

const entries = unzipSync(new Uint8Array(await readFile(archivePath)));
const manifestEntry = entries['manifest.json'];
if (!manifestEntry) throw new Error('manifest.json is missing.');

const manifest = JSON.parse(strFromU8(manifestEntry));
manifest.characterName = characterName;
manifest.description = description;
entries['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

const temporaryPath = `${archivePath}.tmp`;
await writeFile(temporaryPath, zipSync(entries, { level: 0 }));
await rename(temporaryPath, archivePath);

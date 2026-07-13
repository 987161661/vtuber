const fs = require('node:fs/promises');
const path = require('node:path');
const {
  hasUnsafeSpeechArtifacts,
  sanitizeSpeechText,
} = require('../packages/voice/dist/cjs/index.js');

const root = path.resolve(__dirname, '..');
const logPath = path.join(root, 'logs', 'linglan-conversation-history.jsonl');
const archiveDir = path.join(root, 'logs', 'archive');

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function main() {
  await fs.mkdir(archiveDir, { recursive: true });
  const raw = await fs.readFile(logPath, 'utf8');
  const backupPath = path.join(
    archiveDir,
    `linglan-conversation-history-${stamp()}.raw.jsonl`,
  );
  await fs.writeFile(backupPath, raw, { encoding: 'utf8', flag: 'wx' });
  await fs.chmod(backupPath, 0o444);

  let changed = 0;
  let unsafeRemoved = 0;
  let probableDuplicates = 0;
  const recent = new Map();
  const records = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((record) => {
      let input = sanitizeSpeechText(String(record.input || ''));
      let reply = sanitizeSpeechText(String(record.reply || ''));
      const wasUnsafe =
        input !== String(record.input || '') ||
        reply !== String(record.reply || '') ||
        hasUnsafeSpeechArtifacts(input) ||
        hasUnsafeSpeechArtifacts(reply);
      if (!input) input = '[已清除异常输入]';
      if (!reply) reply = '[已清除异常回复]';
      if (wasUnsafe) unsafeRemoved += 1;
      if (input !== record.input || reply !== record.reply) changed += 1;

      const at = Number(record.commentAt || record.at || 0);
      const fingerprint = `${record.source || ''}:${record.viewerName || ''}:${input}`;
      const previousAt = recent.get(fingerprint) || 0;
      const isProbableDuplicate = previousAt > 0 && Math.abs(at - previousAt) < 120_000;
      recent.set(fingerprint, at);
      if (isProbableDuplicate) probableDuplicates += 1;

      return {
        ...record,
        input,
        reply,
        ...(isProbableDuplicate
          ? { dropReason: record.dropReason || 'duplicate_history_migration' }
          : {}),
        ...(wasUnsafe
          ? { sanitizedAt: Date.now(), sanitizerVersion: 2 }
          : {}),
      };
    });

  const cleaned = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  const readablePath = path.join(
    archiveDir,
    `linglan-conversation-history-${stamp()}.clean.jsonl`,
  );
  await fs.writeFile(readablePath, cleaned, 'utf8');
  await fs.writeFile(logPath, cleaned, 'utf8');
  const migration = {
    migratedAt: new Date().toISOString(),
    source: logPath,
    backupPath,
    readablePath,
    records: records.length,
    changed,
    unsafeRemoved,
    probableDuplicates,
    rollback: `copy the read-only backup back to ${logPath}`,
  };
  const migrationPath = path.join(
    archiveDir,
    `linglan-history-migration-${stamp()}.json`,
  );
  await fs.writeFile(migrationPath, `${JSON.stringify(migration, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...migration, migrationPath })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

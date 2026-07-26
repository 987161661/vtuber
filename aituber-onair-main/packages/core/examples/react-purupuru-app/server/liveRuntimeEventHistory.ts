import { open } from 'node:fs/promises';

type LiveRuntimeEventHistoryOptions = {
  limit: number;
  stagePrefix?: string;
};

type LiveRuntimeEventHistoryReadOptions = LiveRuntimeEventHistoryOptions & {
  chunkBytes?: number;
  maxScanBytes?: number;
};

const DEFAULT_HISTORY_CHUNK_BYTES = 64 * 1_024;
const DEFAULT_HISTORY_MAX_SCAN_BYTES = 8 * 1_024 * 1_024;

function parseEventLine(
  line: string,
  stagePrefix?: string,
): Record<string, unknown> | undefined {
  if (!line.trim()) return undefined;
  try {
    const event = JSON.parse(line) as unknown;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      return undefined;
    }
    const record = event as Record<string, unknown>;
    if (
      stagePrefix &&
      !String(record.stage ?? record.kind ?? '').startsWith(stagePrefix)
    ) {
      return undefined;
    }
    return record;
  } catch {
    // A partially written or legacy malformed line must not hide the rest of
    // the recoverable history.
    return undefined;
  }
}

export function selectLiveRuntimeEventHistory(
  raw: string,
  options: LiveRuntimeEventHistoryOptions,
): Record<string, unknown>[] {
  const limit = Math.max(1, Math.floor(options.limit));
  const stagePrefix = options.stagePrefix?.trim();
  const selected: Record<string, unknown>[] = [];

  for (const line of raw.split(/\r?\n/).reverse()) {
    const record = parseEventLine(line, stagePrefix);
    if (!record) continue;
    selected.push(record);
    if (selected.length >= limit) break;
  }

  return selected.reverse();
}

export async function readLiveRuntimeEventHistory(
  path: string,
  options: LiveRuntimeEventHistoryReadOptions,
): Promise<Record<string, unknown>[]> {
  const limit = Math.max(1, Math.floor(options.limit));
  const stagePrefix = options.stagePrefix?.trim();
  const chunkBytes = Math.max(
    1,
    Math.floor(options.chunkBytes ?? DEFAULT_HISTORY_CHUNK_BYTES),
  );
  const maxScanBytes = Math.max(
    chunkBytes,
    Math.floor(options.maxScanBytes ?? DEFAULT_HISTORY_MAX_SCAN_BYTES),
  );
  const selected: Record<string, unknown>[] = [];
  const handle = await open(path, 'r');

  try {
    const fileSize = (await handle.stat()).size;
    let cursor = fileSize;
    let scannedBytes = 0;
    let incompleteLeadingLine = Buffer.alloc(0);

    while (
      cursor > 0 &&
      scannedBytes < maxScanBytes &&
      selected.length < limit
    ) {
      const readLength = Math.min(
        chunkBytes,
        cursor,
        maxScanBytes - scannedBytes,
      );
      const start = cursor - readLength;
      const chunk = Buffer.allocUnsafe(readLength);
      const { bytesRead } = await handle.read(chunk, 0, readLength, start);
      if (bytesRead <= 0) break;

      cursor = start;
      scannedBytes += bytesRead;
      const data = Buffer.concat([
        chunk.subarray(0, bytesRead),
        incompleteLeadingLine,
      ]);
      let completeLines: Buffer;

      if (start === 0) {
        completeLines = data;
        incompleteLeadingLine = Buffer.alloc(0);
      } else {
        const firstNewline = data.indexOf(0x0a);
        if (firstNewline < 0) {
          incompleteLeadingLine = data;
          continue;
        }
        incompleteLeadingLine = data.subarray(0, firstNewline);
        completeLines = data.subarray(firstNewline + 1);
      }

      const lines = completeLines.toString('utf8').split(/\r?\n/);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const record = parseEventLine(lines[index]!, stagePrefix);
        if (!record) continue;
        selected.push(record);
        if (selected.length >= limit) break;
      }
    }
  } finally {
    await handle.close();
  }

  return selected.reverse();
}

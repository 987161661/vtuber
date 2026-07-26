import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WasiToolSandbox } from '../src/index.js';

// (module (func (export "_start")))
const NOOP_WASI_MODULE = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x13, 0x02,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
  0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x00,
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
]);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WasiToolSandbox', () => {
  it('runs with no ambient filesystem, environment, or network capability', async () => {
    const sandbox = new WasiToolSandbox();

    const result = await sandbox.run(NOOP_WASI_MODULE, {});

    expect(result).toMatchObject({ exitCode: 0, granted: { preopens: {}, environmentKeys: [], network: false } });
  });

  it('denies undeclared environment, preopen, and network requests', async () => {
    const sandbox = new WasiToolSandbox();

    await expect(
      sandbox.run(NOOP_WASI_MODULE, { environment: { SECRET: 'value' } }),
    ).rejects.toThrow(/environment capability/i);
    await expect(
      sandbox.run(NOOP_WASI_MODULE, { preopens: { '/data': 'C:\\private' } }),
    ).rejects.toThrow(/filesystem capability/i);
    await expect(
      sandbox.run(NOOP_WASI_MODULE, { network: true }),
    ).rejects.toThrow(/network capability/i);
  });

  it('grants only explicitly allowed directory and environment subsets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wasi-sandbox-'));
    roots.push(root);
    const sandbox = new WasiToolSandbox({
      allowedHostDirectories: [root],
      allowedEnvironmentKeys: ['LANG'],
    });

    const result = await sandbox.run(NOOP_WASI_MODULE, {
      environment: { LANG: 'zh_CN.UTF-8' },
      preopens: { '/workspace': root },
    });

    expect(result.granted).toEqual({
      preopens: { '/workspace': root },
      environmentKeys: ['LANG'],
      network: false,
    });
  });
});

import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve } from 'node:path';
import type { WASI as WasiType } from 'node:wasi';

const { WASI } = createRequire(import.meta.url)('node:wasi') as typeof import('node:wasi');

export interface WasiToolSandboxPolicyV1 {
  allowedHostDirectories?: readonly string[];
  allowedEnvironmentKeys?: readonly string[];
  maxModuleBytes?: number;
}

export interface WasiToolRunRequestV1 {
  args?: readonly string[];
  environment?: Readonly<Record<string, string>>;
  /** Guest absolute path -> host directory. */
  preopens?: Readonly<Record<string, string>>;
  /** Preview1 deliberately has no network adapter in this sandbox. */
  network?: boolean;
}

export interface WasiGrantedCapabilitiesV1 {
  preopens: Readonly<Record<string, string>>;
  environmentKeys: readonly string[];
  network: false;
}

export interface WasiToolRunResultV1 {
  exitCode: number;
  granted: WasiGrantedCapabilitiesV1;
}

/** Node-only WASI Preview1 adapter with no ambient capabilities. */
export class WasiToolSandbox {
  private readonly allowedHostDirectories: string[];
  private readonly allowedEnvironmentKeys: Set<string>;
  private readonly maxModuleBytes: number;

  constructor(policy: WasiToolSandboxPolicyV1 = {}) {
    this.allowedHostDirectories = (policy.allowedHostDirectories ?? []).map(
      (directory) => resolve(directory),
    );
    this.allowedEnvironmentKeys = new Set(policy.allowedEnvironmentKeys ?? []);
    this.maxModuleBytes = policy.maxModuleBytes ?? 16 * 1024 * 1024;
  }

  async run(
    moduleBytes: Uint8Array,
    request: WasiToolRunRequestV1,
  ): Promise<WasiToolRunResultV1> {
    if (moduleBytes.byteLength === 0 || moduleBytes.byteLength > this.maxModuleBytes) {
      throw new Error(`WASI module size must be between 1 and ${this.maxModuleBytes} bytes`);
    }
    if (request.network) {
      throw new Error('WASI network capability is not available');
    }
    const environment = this.authorizeEnvironment(request.environment ?? {});
    const preopens = this.authorizePreopens(request.preopens ?? {});
    const wasi: WasiType = new WASI({
      version: 'preview1',
      args: [...(request.args ?? [])],
      env: environment,
      preopens,
      returnOnExit: true,
    });
    const module = await WebAssembly.compile(moduleBytes);
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    const exitCode = wasi.start(instance);
    return {
      exitCode,
      granted: {
        preopens: { ...preopens },
        environmentKeys: Object.keys(environment).sort(),
        network: false,
      },
    };
  }

  private authorizeEnvironment(
    requested: Readonly<Record<string, string>>,
  ): Record<string, string> {
    for (const key of Object.keys(requested)) {
      if (!this.allowedEnvironmentKeys.has(key)) {
        throw new Error(`WASI environment capability is not granted: ${key}`);
      }
    }
    return { ...requested };
  }

  private authorizePreopens(
    requested: Readonly<Record<string, string>>,
  ): Record<string, string> {
    const granted: Record<string, string> = {};
    for (const [guestPath, hostPath] of Object.entries(requested)) {
      if (!guestPath.startsWith('/') || guestPath.includes('..')) {
        throw new Error(`Invalid WASI guest preopen path: ${guestPath}`);
      }
      const resolvedHost = resolve(hostPath);
      const allowed = this.allowedHostDirectories.some((root) => {
        const child = relative(root, resolvedHost);
        return child === '' || (!child.startsWith('..') && !isAbsolute(child));
      });
      if (!allowed) {
        throw new Error(`WASI filesystem capability is not granted: ${hostPath}`);
      }
      granted[guestPath] = resolvedHost;
    }
    return granted;
  }
}

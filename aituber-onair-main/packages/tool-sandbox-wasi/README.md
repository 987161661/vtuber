# @aituber-onair/tool-sandbox-wasi

A default-deny WASI Preview 1 runner for untrusted tool modules. By default a
module receives no environment variables, preopened directories, or network
access. Callers may grant explicit environment keys and host-directory subsets;
all preopen paths are checked against configured roots.

Requires Node.js 24.2 or newer. Node currently reports its built-in WASI API as
experimental, so pin and test the deployment runtime.

```ts
import { WasiToolSandbox } from '@aituber-onair/tool-sandbox-wasi';

const sandbox = new WasiToolSandbox({
  allowedEnvironmentKeys: ['LANG'],
  allowedHostDirectories: ['./workspace'],
});

const result = await sandbox.run(wasmBytes, {
  environment: { LANG: 'zh_CN.UTF-8' },
  preopens: { '/workspace': './workspace' },
});
```

The sandbox limits module size and does not add a socket capability. Application
policy should still apply CPU/time limits at the worker or process boundary.

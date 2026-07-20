import type { ConfigEnv, PreviewServer, UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  exposeRuntimePluginInPreview,
  shareRuntimeProxyWithPreview,
} from '../../examples/react-purupuru-app/server/runtimeVitePlugin';

describe('runtime Vite plugin adapter', () => {
  it('installs the same runtime middleware in preview mode', async () => {
    const registrations: string[] = [];
    const plugin = exposeRuntimePluginInPreview({
      name: 'runtime-example',
      configureServer(server) {
        server.middlewares.use('/api/runtime-example', (_req, _res, next) => {
          next();
        });
      },
    });
    const hook = plugin.configurePreviewServer;
    if (typeof hook !== 'function') {
      throw new Error('preview hook was not installed');
    }
    const previewServer = {
      middlewares: {
        use(route: string) {
          registrations.push(route);
        },
      },
    } as unknown as PreviewServer;

    await hook.call({} as never, previewServer);

    expect(registrations).toEqual(['/api/runtime-example']);
  });

  it('shares the runtime proxy table with preview mode', async () => {
    const proxy = { '/api/upstream': 'http://127.0.0.1:8196' };
    const hook = shareRuntimeProxyWithPreview().config;
    if (typeof hook !== 'function') {
      throw new Error('config hook was not installed');
    }

    const result = await hook.call(
      {} as never,
      { server: { proxy } } satisfies UserConfig,
      { command: 'serve', mode: 'production' } satisfies ConfigEnv,
    );

    expect(result).toMatchObject({ preview: { proxy } });
  });
});

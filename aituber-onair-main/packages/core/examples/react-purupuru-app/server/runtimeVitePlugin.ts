import type {
  Plugin,
  PreviewServerHook,
  ServerHook,
  ViteDevServer,
} from 'vite';

/**
 * Adapts a middleware-only Vite runtime plugin for both `vite dev` and
 * `vite preview`. The wrapped configureServer hook must use only the shared
 * `middlewares` interface; dev-only facilities such as HMR are not available
 * in preview mode.
 */
export function exposeRuntimePluginInPreview(plugin: Plugin): Plugin {
  if (plugin.configurePreviewServer) return plugin;
  const configureServer = plugin.configureServer;
  if (!configureServer) {
    throw new Error(`runtime_plugin_missing_configure_server:${plugin.name}`);
  }
  const handler: ServerHook =
    typeof configureServer === 'function'
      ? configureServer
      : configureServer.handler;
  const configurePreviewServer: PreviewServerHook = function (server) {
    return handler.call(this, server as unknown as ViteDevServer);
  };

  return { ...plugin, configurePreviewServer };
}

export function shareRuntimeProxyWithPreview(): Plugin {
  return {
    name: 'runtime-proxy-preview-parity',
    config(config) {
      const proxy = config.server?.proxy;
      if (!proxy || config.preview?.proxy) return;
      return { preview: { proxy } };
    },
  };
}

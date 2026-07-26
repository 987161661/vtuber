import {
  ToolDefinition,
  ToolUseBlock,
  ToolResultBlock,
  MCPServerConfig,
} from '@aituber-onair/chat';

type Handler<P = any, R = any> = (input: P) => Promise<R>;

type SecureMCPServerConfig = Omit<MCPServerConfig, 'tool_configuration'> & {
  tool_configuration?: {
    enabled?: boolean;
    allowed_tools?: string[];
    tool_permissions?: Record<
      string,
      { effect: 'read' | 'write'; require_approval?: boolean }
    >;
  };
  security?: { max_response_bytes?: number };
};

export interface ToolExecutionContext {
  /** One-shot approvals owned by the host, never by model tool arguments. */
  approvedToolCalls?: readonly string[];
}

export class ToolExecutor {
  private registry = new Map<string, { def: ToolDefinition; fn: Handler }>();
  private mcpServers: SecureMCPServerConfig[] = [];

  register<P, R>(definition: ToolDefinition, fn: Handler<P, R>) {
    if (this.registry.has(definition.name)) {
      throw new Error(`Tool '${definition.name}' already registered`);
    }
    this.registry.set(definition.name, { def: definition, fn });
  }

  setMCPServers(servers: MCPServerConfig[]) {
    this.mcpServers = servers as SecureMCPServerConfig[];
  }

  /**
   * Parse MCP tool name
   * @param toolName Tool name (e.g., "mcp_deepwiki_search")
   * @returns Parsed MCP tool parts or null for non-MCP tools
   */
  private parseMCPToolName(
    toolName: string,
  ): { serverName: string; toolName: string } | null {
    // Format: mcp_{serverName}_{toolName}
    if (!toolName.startsWith('mcp_')) {
      return null;
    }
    const parts = toolName.split('_');
    if (parts.length >= 3 && parts[0] === 'mcp') {
      return {
        serverName: parts[1],
        toolName: parts.slice(2).join('_'),
      };
    }
    throw new Error(`Invalid MCP tool name format: ${toolName}`);
  }

  /**
   * Execute MCP tool call
   * @param block Tool use block
   * @returns Tool result block
   */
  private async executeMCPTool(
    block: ToolUseBlock,
    mcpTool: { serverName: string; toolName: string },
    context: ToolExecutionContext,
  ): Promise<ToolResultBlock> {
    const { serverName, toolName } = mcpTool;
    const mcpServer = this.mcpServers.find(
      (server) => server.name === serverName,
    );

    if (!mcpServer) {
      throw new Error(`MCP server '${serverName}' not found`);
    }

    try {
      const configuration = mcpServer.tool_configuration;
      if (configuration?.enabled === false) {
        throw new Error(`MCP server '${serverName}' is disabled`);
      }
      if (!configuration?.allowed_tools?.includes(toolName)) {
        throw new Error(
          `MCP capability is not granted for ${serverName}/${toolName}`,
        );
      }
      const permission = configuration.tool_permissions?.[toolName];
      if (
        permission?.effect === 'write' &&
        permission.require_approval !== false &&
        !context.approvedToolCalls?.includes(`${serverName}/${toolName}`)
      ) {
        throw new Error(
          `MCP tool ${serverName}/${toolName} requires explicit approval`,
        );
      }

      // Prepare headers with optional authorization
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (mcpServer.authorization_token) {
        headers['Authorization'] = `Bearer ${mcpServer.authorization_token}`;
      }

      // Make HTTP request to MCP server using proper MCP protocol
      // Format: POST /tools/{toolName} with arguments in body
      const baseUrl = new URL(
        mcpServer.url.endsWith('/') ? mcpServer.url : `${mcpServer.url}/`,
      );
      const endpoint = new URL(`tools/${encodeURIComponent(toolName)}`, baseUrl);
      if (endpoint.origin !== baseUrl.origin) {
        throw new Error('MCP tool endpoint cannot change the configured origin');
      }
      const response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(stripInboundCredentials(block.input || {})),
      });

      if (!response.ok) {
        throw new Error(
          `MCP server responded with ${response.status}: ${response.statusText}`,
        );
      }

      const result = await response.json();
      const serialized =
        typeof result === 'string' ? result : JSON.stringify(result);
      const maxResponseBytes = mcpServer.security?.max_response_bytes ?? 1_000_000;
      if (new TextEncoder().encode(serialized).byteLength > maxResponseBytes) {
        throw new Error(`MCP response exceeds ${maxResponseBytes} bytes`);
      }

      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: serialized,
      };
    } catch (error: any) {
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `MCP tool execution failed: ${error.message}`,
      };
    }
  }

  async run(
    blocks: ToolUseBlock[],
    context: ToolExecutionContext = {},
  ): Promise<ToolResultBlock[]> {
    const tasks = blocks
      .filter((b): b is ToolUseBlock => b.type === 'tool_use')
      .map(async (b) => {
        // Check if this is an MCP tool
        const mcpTool = this.parseMCPToolName(b.name);
        if (mcpTool) {
          return this.executeMCPTool(b, mcpTool, context);
        }

        // Handle regular tools
        const entry = this.registry.get(b.name);
        if (!entry) {
          throw new Error(`Unhandled tool: ${b.name}`);
        }
        const { fn, def } = entry;

        const resPromise = fn(b.input);
        const result = def.config?.timeoutMs
          ? await Promise.race([
              resPromise,
              new Promise<never>((_, rej) =>
                setTimeout(
                  () => rej(new Error(`${b.name} timed out`)),
                  def.config!.timeoutMs,
                ),
              ),
            ])
          : await resPromise;

        return <ToolResultBlock>{
          type: 'tool_result',
          tool_use_id: b.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        };
      });

    return Promise.all(tasks);
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.registry.values()).map((r) => r.def);
  }
}

const CREDENTIAL_KEYS = new Set([
  'authorization',
  'authorization_token',
  'access_token',
  'refresh_token',
  'api_key',
  'api-key',
  'token',
]);

function stripInboundCredentials(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new Error('MCP tool input nesting is too deep');
  if (Array.isArray(value)) {
    return value.map((item) => stripInboundCredentials(item, depth + 1));
  }
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => {
        const normalized = key.toLowerCase();
        return (
          !CREDENTIAL_KEYS.has(normalized) &&
          normalized !== '__proto__' &&
          normalized !== 'prototype' &&
          normalized !== 'constructor'
        );
      })
      .map(([key, child]) => [
        key,
        stripInboundCredentials(child, depth + 1),
      ]),
  );
}

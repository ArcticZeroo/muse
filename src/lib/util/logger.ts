import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LoggingMessageNotification } from '@modelcontextprotocol/sdk/types.js';

type LogLevels = LoggingMessageNotification['params']['level'];

export class McpLogger {
    readonly #mcpServer: McpServer;

    constructor(server: McpServer) {
        this.#mcpServer = server;
    }

    #log(message: string, level: LogLevels, ifNotConnected: (message: string) => void) {
        if (!this.#mcpServer.isConnected()) {
            ifNotConnected(message);
            return;
        }

        this.#mcpServer.server.sendLoggingMessage({
            level,
            data: message
        }).catch(err => console.error('Failed to send log message to MCP server:', err));
    }

    info(message: string) {
        this.#log(message, 'info', console.log);
    }

    error(message: string) {
        this.#log(message, 'error', console.error);
    }

    debug(message: string) {
        this.#log(message, 'debug', console.debug);
    }

    warn(message: string) {
        this.#log(message, 'warning', console.warn);
    }
}
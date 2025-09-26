import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { SUMMARY_FILE_NAME, USER_FILE_NAME, VERSIONS_FILE_NAME } from './constants/files.js';
import TypedEventEmitter from './models/typed-emitter.js';
import { FileSystemEvents, MemoryEvents } from './events.js';
import EventEmitter from 'node:events';
import { getCategoryFilePath } from './util/category.js';
import { VersionManager } from './versioning.js';
import { IMemoryConfig } from './models/session.js';
import { serializeSummaryFromVersions } from './summary.js';
import { ensureGitignore } from './gitignore.js';
import { PromptManager } from './constants/prompts.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpLogger } from './util/mcp.js';

interface ICreateMemorySessionOptions {
    server: McpServer;
    memoryDirectory: string;
    contextFilePath?: string;
}

interface IConstructMemorySessionOptions {
    config: IMemoryConfig;
    memoryEvents: TypedEventEmitter<MemoryEvents>;
    fileSystemEvents: TypedEventEmitter<FileSystemEvents>;
    versionManager: VersionManager;
}

const createConfigAsync = async (server: McpServer, memoryDirectory: string, contextFilePath?: string): Promise<IMemoryConfig> => {
    if (!memoryDirectory) {
        throw new Error('Memory directory must be non-empty');
    }

    memoryDirectory = path.resolve(memoryDirectory);

    if (contextFilePath) {
        contextFilePath = path.resolve(memoryDirectory, contextFilePath);

        if (!fsSync.existsSync(contextFilePath)) {
            throw new Error(`Context file does not exist: ${contextFilePath}`);
        }
    }

    await fs.mkdir(memoryDirectory, { recursive: true });

    const summaryFilePath = path.resolve(memoryDirectory, SUMMARY_FILE_NAME);
    const userFilePath = path.resolve(memoryDirectory, USER_FILE_NAME);
    const versionsFilePath = path.resolve(memoryDirectory, VERSIONS_FILE_NAME);

    return {
        server,
        memoryDirectory,
        contextFilePath,
        summaryFilePath,
        userFilePath,
        versionsFilePath
    };
};

export class MemorySession {
    readonly #config: IMemoryConfig;
    readonly #memoryEvents: TypedEventEmitter<MemoryEvents>;
    readonly #fileSystemEvents: TypedEventEmitter<FileSystemEvents>;
    readonly #versionManager: VersionManager;
    readonly #prompts: PromptManager;
    readonly #logger: McpLogger;

    private constructor({ config, memoryEvents, fileSystemEvents, versionManager }: IConstructMemorySessionOptions) {
        this.#config = config;
        this.#memoryEvents = memoryEvents;
        this.#fileSystemEvents = fileSystemEvents;
        this.#versionManager = versionManager;
        this.#prompts = new PromptManager(config);
        this.#logger = new McpLogger(config.server);
    }

    static async createAsync({
                                 server,
                                 memoryDirectory,
                                 contextFilePath
                             }: ICreateMemorySessionOptions): Promise<MemorySession> {
        const config = await createConfigAsync(server, memoryDirectory, contextFilePath);

        const memoryEvents = new EventEmitter() as TypedEventEmitter<MemoryEvents>;
        const fileSystemEvents = new EventEmitter() as TypedEventEmitter<FileSystemEvents>;

        const versionManager = await VersionManager.createAsync(config, fileSystemEvents, memoryEvents);

        await ensureGitignore(config);

        return new MemorySession({
            config,
            memoryEvents,
            fileSystemEvents,
            versionManager
        });
    }

    get logger(): McpLogger {
        return this.#logger;
    }

    get config(): Readonly<IMemoryConfig> {
        return this.#config;
    }

    get fileSystemEvents(): TypedEventEmitter<FileSystemEvents> {
        return this.#fileSystemEvents;
    }

    get memoryEvents(): TypedEventEmitter<MemoryEvents> {
        return this.#memoryEvents;
    }

    get versionManager(): VersionManager {
        return this.#versionManager;
    }

    get prompts(): PromptManager {
        return this.#prompts;
    }

    async getSummary(): Promise<string> {
        return serializeSummaryFromVersions(await this.#versionManager.readVersions());
    }

    async readCategoryFile(categoryName: string): Promise<string> {
        const filePath = getCategoryFilePath(this.#config, categoryName);
        return fs.readFile(filePath, 'utf-8');
    }
}
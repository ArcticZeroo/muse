import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { SUMMARY_FILE_NAME, USER_FILE_NAME, VERSIONS_FILE_NAME } from './constants/files.js';
import TypedEventEmitter from './models/typed-emitter.js';
import { FileSystemEvents, MemoryEvents } from './events.js';
import EventEmitter from 'node:events';
import { getCategoryFilePath, getCategoryNameFromFilePath } from './util/category.js';
import { trackSpan } from './util/perf.js';
import { logError } from './util/mcp.js';
import { VersionManager } from './versioning.js';
import { IMemoryConfig } from './models/session.js';
import { serializeSummaryFromVersions } from './summary.js';
import { ensureGitignore } from './gitignore.js';

interface ICreateMemorySessionOptions {
    memoryDirectory: string;
    contextFilePath?: string;
}

interface IConstructMemorySessionOptions {
    config: IMemoryConfig;
    memoryEvents: TypedEventEmitter<MemoryEvents>;
    fileSystemEvents: TypedEventEmitter<FileSystemEvents>;
    versionManager: VersionManager;
}

const createConfigAsync = async (memoryDirectory: string, contextFilePath?: string): Promise<IMemoryConfig> => {
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

    private constructor({ config, memoryEvents, fileSystemEvents, versionManager }: IConstructMemorySessionOptions) {
        this.#config = config;
        this.#memoryEvents = memoryEvents;
        this.#fileSystemEvents = fileSystemEvents;
        this.#versionManager = versionManager;
    }

    static async createAsync({
                                 memoryDirectory,
                                 contextFilePath
                             }: ICreateMemorySessionOptions): Promise<MemorySession> {
        const config = await createConfigAsync(memoryDirectory, contextFilePath);

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

    async getSummary(): Promise<string> {
        return serializeSummaryFromVersions(await this.#versionManager.readVersions());
    }

    async readCategoryFile(categoryName: string): Promise<string> {
        const filePath = getCategoryFilePath(this.#config, categoryName);
        return fs.readFile(filePath, 'utf-8');
    }
}
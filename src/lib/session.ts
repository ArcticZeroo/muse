import fs from 'node:fs/promises';
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
import { ANSWER_TAG, CATEGORY_CONTENT_TAG, CATEGORY_REFERENCE_TAG, SKIP_TAG } from './constants/regex.js';
import { throwError } from './util/error.js';
import { getCategoriesForQuery, IQueryCategory, parseQueryCategories } from './sampling.js';
import { createConfigAsync } from './config.js';
import { retrieveSampledMessage } from './util/sampling.js';
import { McpLogger } from './util/logger.js';

const NO_MEMORY_RESPONSE = 'No relevant memory found for the query. Go search the codebase and once you\'re done, ingest your findings into memory for next time.';

interface IQueryCategoryResult {
    answer: string | undefined;
    references: Array<IQueryCategory>;
}

class CategoryQueryManager {
    readonly #session: MemorySession;
    readonly #query: string;
    readonly #results = new Map<string /*categoryName*/, string /*response*/>();
    readonly #registeredCategories: Set<string> = new Set();
    #completedCategoryCount: number = 0;
    #allQueriesDonePromise: Promise<void> = Promise.resolve();
    #resolveAllQueriesDonePromise: (() => void) | undefined = undefined;
    #rejectAllQueriesDonePromise: ((error: unknown) => void) | undefined = undefined;

    constructor(session: MemorySession, query: string) {
        this.#session = session;
        this.#query = query;
    }

    #resolve() {
        this.#resolveAllQueriesDonePromise?.();
        this.#resolveAllQueriesDonePromise = undefined;
        this.#rejectAllQueriesDonePromise = undefined;
    }

    #reject(error: unknown) {
        this.#rejectAllQueriesDonePromise?.(error);
        this.#resolveAllQueriesDonePromise = undefined;
        this.#rejectAllQueriesDonePromise = undefined;
    }

    async #queryCategory(category: IQueryCategory) {
        try {
            const result = await this.#session.queryCategory(category, this.#query);

            for (const reference of result.references) {
                this.addCategory(reference);
            }

            if (result.answer) {
                this.#results.set(category.categoryName, result.answer);
            }

            this.#completedCategoryCount += 1;
            if (this.#completedCategoryCount === this.#registeredCategories.size) {
                this.#resolve();
            }
        } catch (error) {
            this.#session.logger.error(`Error querying category (inner) ${category.categoryName}: ${error}`);
            this.#reject(error);
            return;
        }
    }

    addCategory(category: IQueryCategory) {
        if (this.#registeredCategories.has(category.categoryName)) {
            return;
        }

        this.#registeredCategories.add(category.categoryName);

        if (!this.#resolveAllQueriesDonePromise) {
            this.#allQueriesDonePromise = new Promise((resolve, reject) => {
                this.#resolveAllQueriesDonePromise = resolve;
                this.#rejectAllQueriesDonePromise = reject;
            });
        }

        this.#queryCategory(category)
            .catch(err => this.#session.logger.error(`Error querying category (outer) ${category.categoryName}: ${err}`));
    }

    async getResults() {
        await this.#allQueriesDonePromise;
        return new Map(this.#results);
    }
}

interface IIngestCategoryUpdateOptions {
    categoryName: string;
    reason: string;
    information: string;
}

interface ICreateMemorySessionOptions {
    server: McpServer;
    memoryDirectory: string;
    contextFilePath?: string;
}

interface IConstructMemorySessionOptions {
    config: IMemoryConfig;
    memoryEvents: TypedEventEmitter<MemoryEvents>;
    fileSystemEvents: TypedEventEmitter<FileSystemEvents>;
}


export class MemorySession {
    readonly #config: IMemoryConfig;
    readonly #memoryEvents: TypedEventEmitter<MemoryEvents>;
    readonly #fileSystemEvents: TypedEventEmitter<FileSystemEvents>;
    readonly #prompts: PromptManager;
    readonly #logger: McpLogger;
    readonly #versionManager: VersionManager;
    #isClosed: boolean = false;

    private constructor({ config, memoryEvents, fileSystemEvents }: IConstructMemorySessionOptions) {
        this.#config = config;
        this.#memoryEvents = memoryEvents;
        this.#fileSystemEvents = fileSystemEvents;
        this.#prompts = new PromptManager(config);
        this.#logger = new McpLogger(config.server);
        this.#versionManager = new VersionManager(this);

        this.#memoryEvents.on('permissionDenied', () => {
            if (this.#isClosed) {
                return;
            }

            this.logger.warn('Stopping memory due to permission denied event');
            this.#isClosed = true;
        });
    }

    static async createAsync({
                                 server,
                                 memoryDirectory,
                                 contextFilePath
                             }: ICreateMemorySessionOptions): Promise<MemorySession> {
        const config = await createConfigAsync(server, memoryDirectory, contextFilePath);

        const memoryEvents = new EventEmitter() as TypedEventEmitter<MemoryEvents>;
        const fileSystemEvents = new EventEmitter() as TypedEventEmitter<FileSystemEvents>;

        await ensureGitignore(config);

        return new MemorySession({
            config,
            memoryEvents,
            fileSystemEvents,
        });
    }

    get isClosed(): boolean {
        return this.#isClosed;
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

    get prompts(): PromptManager {
        return this.#prompts;
    }

    async initializeAfterMcpServerStarted() {
        await this.#versionManager.initialize();
    }

    async getSummary(): Promise<string> {
        return serializeSummaryFromVersions(await this.#versionManager.readVersions());
    }

    async readCategoryFile(categoryName: string): Promise<string> {
        const filePath = getCategoryFilePath(this.#config, categoryName);
        return fs.readFile(filePath, 'utf-8');
    }

    async #summarizeQueryResponse(query: string, responses: Record<string /*categoryName*/, string /*response*/>): Promise<string> {
        const prompt = await this.prompts.getSummarizeInformationFromManyCategoriesPrompt(query, responses);

        const response = await retrieveSampledMessage({
            session: this,
            messages: [prompt],
            maxTokens: 50_000
        });

        return ANSWER_TAG.matchOne(response) ?? throwError('Failed to parse answer from the response');
    }

    async #ingestCategoryUpdate({ categoryName, information, reason }: IIngestCategoryUpdateOptions) {
        const filePath = getCategoryFilePath(this.config, categoryName);
        const previousCategoryContent = await fs.readFile(filePath, 'utf-8').catch(() => '');

        const prompt = await this.prompts.getUpdateInSingleCategoryPrompt({
            categoryName,
            previousCategoryContent,
            information,
            reason
        });

        const response = await retrieveSampledMessage({
            session: this,
            messages: [prompt],
            maxTokens: 50_000
        });

        if (SKIP_TAG.isMatch(response)) {
            this.logger.info(`AI has skipped updating category ${categoryName}`);
            return undefined;
        }

        const newCategoryContent = CATEGORY_CONTENT_TAG.matchOne(response);
        if (!newCategoryContent) {
            this.logger.error(`AI was missing CATEGORY_CONTENT_TAG when updating category ${categoryName}. Response was:\n${response}`);
            return undefined;
        }

        this.memoryEvents.emit('categoryDirty', {
            name: categoryName,
            content: newCategoryContent,
        });
    }

    async queryCategory({ categoryName, reason }: IQueryCategory, query: string): Promise<IQueryCategoryResult> {
        const categoryContent = await this.readCategoryFile(categoryName);
        const prompt = await this.prompts.getInformationFromSingleCategoryPrompt({
            query,
            categoryName,
            reason,
            content: categoryContent
        });

        const response = await retrieveSampledMessage({
            session: this,
            messages: [prompt],
            maxTokens: 5_000
        });

        const answer = SKIP_TAG.isMatch(response) ? undefined : ANSWER_TAG.matchOne(response);
        const references = parseQueryCategories(this.config, CATEGORY_REFERENCE_TAG, response, true /*existingOnly*/);
        return { answer, references };
    }

    async ingestMemory(information: string): Promise<void> {
        const summary = await this.getSummary();

        const categories = await getCategoriesForQuery({
            summary,
            session: this,
            query: information,
            isIngestion: true
        });

        if (categories.length === 0) {
            this.logger.error('No categories found for ingestion, skipping.');
            return;
        }

        this.logger.info(`Ingesting information into ${categories.length} categories: ${categories.map(c => c.categoryName).join(', ')}`);
        await Promise.all(categories.map(({
                                              categoryName,
                                              reason
                                          }) => this.#ingestCategoryUpdate({
            categoryName,
            information,
            reason
        })));
    }

    async #queryMultipleCategories(categories: Array<IQueryCategory>, query: string) {
        const manager = new CategoryQueryManager(this, query);

        for (const category of categories) {
            manager.addCategory(category);
        }

        return Object.fromEntries(await manager.getResults());
    }

    async queryMemory(query: string): Promise<string> {
        const summary = await this.getSummary();

        if (!summary.trim()) {
            return NO_MEMORY_RESPONSE;
        }

        const categories = await getCategoriesForQuery({
            session: this,
            query,
            summary,
            isIngestion: false,
            existingOnly: true
        });

        if (categories.length === 0) {
            return NO_MEMORY_RESPONSE;
        }

        const categoryResponses = await this.#queryMultipleCategories(categories, query);
        const keys = Object.keys(categoryResponses);

        if (keys.length === 0) {
            return NO_MEMORY_RESPONSE;
        }

        if (keys.length === 1) {
            return categoryResponses[keys[0]]!;
        }

        return this.#summarizeQueryResponse(query, categoryResponses);
    }
}
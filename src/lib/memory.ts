import fs from 'node:fs/promises';
import { retrieveSampledMessage } from './util/mcp.js';
import { getCategoryFilePath } from './util/category.js';
import { ANSWER_TAG, CATEGORY_CONTENT_TAG, CATEGORY_REFERENCE_TAG, SKIP_TAG } from './constants/regex.js';
import { getCategoriesForQuery, IQueryCategory, parseQueryCategories } from './sampling.js';
import { throwError } from './util/error.js';
import { MemorySession } from './session.js';

const NO_MEMORY_RESPONSE = 'No relevant memory found for the query. Go search the codebase and once you\'re done, ingest your findings into memory for next time.';

const summarizeQueryResponse = async (session: MemorySession, query: string, responses: Record<string /*categoryName*/, string /*response*/>): Promise<string> => {
    const prompt = await session.prompts.getSummarizeInformationFromManyCategoriesPrompt(query, responses);

    const response = await retrieveSampledMessage({
        mcpServer: session.config.server,
        messages: [prompt],
        maxTokens: 50_000
    });

    return ANSWER_TAG.matchOne(response) ?? throwError('Failed to parse answer from the response');
};

interface IQueryCategoryResult {
    answer: string | undefined;
    references: Array<IQueryCategory>;
}

const queryCategory = async (session: MemorySession, {
    categoryName,
    reason
}: IQueryCategory, query: string): Promise<IQueryCategoryResult> => {
    const categoryContent = await session.readCategoryFile(categoryName);
    const prompt = await session.prompts.getInformationFromSingleCategoryPrompt({
        query,
        categoryName,
        reason,
        content: categoryContent
    });

    const response = await retrieveSampledMessage({
        mcpServer: session.config.server,
        messages: [prompt],
        maxTokens: 5_000
    });

    const answer = SKIP_TAG.isMatch(response) ? undefined : ANSWER_TAG.matchOne(response);
    const references = parseQueryCategories(session.config, CATEGORY_REFERENCE_TAG, response, true /*existingOnly*/);
    return { answer, references };
};

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
            const result = await queryCategory(this.#session, category, this.#query);

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

const queryMultipleCategories = async (session: MemorySession, categories: Array<IQueryCategory>, query: string): Promise<Record<string /*categoryName*/, string /*response*/>> => {
    const manager = new CategoryQueryManager(session, query);

    for (const category of categories) {
        manager.addCategory(category);
    }

    return Object.fromEntries(await manager.getResults());
};

export const queryMemory = async (session: MemorySession, query: string): Promise<string> => {
    const summary = await session.getSummary();

    if (!summary.trim()) {
        return NO_MEMORY_RESPONSE;
    }

    const categories = await getCategoriesForQuery({
        session,
        query,
        summary,
        isIngestion: false,
        existingOnly: true
    });

    if (categories.length === 0) {
        return NO_MEMORY_RESPONSE;
    }

    const categoryResponses = await queryMultipleCategories(session, categories, query);
    const keys = Object.keys(categoryResponses);

    if (keys.length === 0) {
        return NO_MEMORY_RESPONSE;
    }

    if (keys.length === 1) {
        return categoryResponses[keys[0]]!;
    }

    return summarizeQueryResponse(session, query, categoryResponses);
};

interface IIngestCategoryUpdateOptions {
    session: MemorySession,
    summary: string;
    categoryName: string;
    reason: string;
    information: string;
}

const ingestCategoryUpdate = async ({
                                        session,
                                        summary,
                                        categoryName,
                                        reason,
                                        information
                                    }: IIngestCategoryUpdateOptions) => {
    const filePath = getCategoryFilePath(session.config, categoryName);
    const previousCategoryContent = await fs.readFile(filePath, 'utf-8').catch(() => '');

    const prompt = await session.prompts.getUpdateInSingleCategoryPrompt({
        summary,
        categoryName,
        previousCategoryContent,
        information,
        reason
    });

    const response = await retrieveSampledMessage({
        mcpServer: session.config.server,
        messages: [prompt],
        maxTokens: 50_000
    });

    if (SKIP_TAG.isMatch(response)) {
        session.logger.info(`AI has skipped updating category ${categoryName}`);
        return undefined;
    }

    const newCategoryContent = CATEGORY_CONTENT_TAG.matchOne(response);
    if (!newCategoryContent) {
        session.logger.error(`AI was missing CATEGORY_CONTENT_TAG when updating category ${categoryName}. Response was:\n${response}`);
        return undefined;
    }

    session.memoryEvents.emit('categoryDirty', {
        name: categoryName,
        content: newCategoryContent,
    });
};

export const ingestMemory = async (session: MemorySession, information: string): Promise<void> => {
    const summary = await session.getSummary();

    const categories = await getCategoriesForQuery({
        session,
        summary,
        query: information,
        isIngestion: true
    });

    if (categories.length === 0) {
        session.logger.error('No categories found for ingestion, skipping.');
        return;
    }

    session.logger.info(`Ingesting information into ${categories.length} categories: ${categories.map(c => c.categoryName).join(', ')}`);
    await Promise.all(categories.map(({
                                          categoryName,
                                          reason
                                      }) => ingestCategoryUpdate({
        session,
        categoryName,
        information,
        summary,
        reason
    })));
};
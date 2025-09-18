import fs from 'node:fs/promises';
import {
    getInformationFromSingleCategoryPrompt,
    getSummarizeInformationFromManyCategoriesPrompt,
    getUpdateInSingleCategoryPrompt
} from './constants/prompts.js';
import { logError, logInfo, retrieveSampledMessage } from './util/mcp.js';
import { getSummary } from './summary.js';
import { getCategoryFilePath } from './util/category.js';
import { ANSWER_TAG, CATEGORY_CONTENT_TAG, CATEGORY_REFERENCE_TAG, SKIP_TAG } from './constants/regex.js';
import { getCategoriesForQuery, IQueryCategory, parseQueryCategories } from './sampling.js';
import { MEMORY_EVENTS } from './events.js';
import { throwError } from './util/error.js';

const NO_MEMORY_RESPONSE = 'No relevant memory found for the query. Go search the codebase and once you\'re done, ingest your findings into memory for next time.';

const readCategory = async (categoryName: string): Promise<string> => {
	return fs.readFile(getCategoryFilePath(categoryName), 'utf-8');
}

const summarizeQueryResponse = async (query: string, responses: Record<string /*categoryName*/, string /*response*/>): Promise<string> => {
	const prompt = getSummarizeInformationFromManyCategoriesPrompt(query, responses);

	const response = await retrieveSampledMessage({
		messages:  [prompt],
		maxTokens: 50_000
	});

	return ANSWER_TAG.matchOne(response) ?? throwError('Failed to parse answer from the response');
}

interface IQueryCategoryResult {
    answer: string | undefined;
    references: Array<IQueryCategory>;
}

const queryCategory = async ({ categoryName, reason }: IQueryCategory, query: string): Promise<IQueryCategoryResult> => {
    const categoryContent = await readCategory(categoryName);
    const prompt = getInformationFromSingleCategoryPrompt({
        query,
        categoryName,
        reason,
        content: categoryContent
    });

    const response = await retrieveSampledMessage({
        messages:  [prompt],
        maxTokens: 5_000
    });

    const answer = SKIP_TAG.isMatch(response) ? undefined : ANSWER_TAG.matchOne(response);
    const references = parseQueryCategories(CATEGORY_REFERENCE_TAG, response, true /*existingOnly*/);
    return { answer, references };
}

class CategoryQueryManager {
    readonly #query: string;
    readonly #results = new Map<string /*categoryName*/, string /*response*/>();
    readonly #registeredCategories: Set<string> = new Set();
    #completedCategoryCount: number = 0;
    #allQueriesDonePromise: Promise<void> = Promise.resolve();
    #resolveAllQueriesDonePromise: (() => void) | undefined = undefined;
    #rejectAllQueriesDonePromise: ((error: unknown) => void) | undefined = undefined;

    constructor(query: string) {
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
            const result = await queryCategory(category, this.#query);

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
            logError(`Error querying category (inner) ${category.categoryName}: ${error}`);
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
            .catch(err => logError(`Error querying category (outer) ${category.categoryName}: ${err}`));
    }

    async getResults() {
        await this.#allQueriesDonePromise;
        return new Map(this.#results);
    }
}

const queryMultipleCategories = async (categories: Array<IQueryCategory>, query: string): Promise<Record<string /*categoryName*/, string /*response*/>> => {
    const manager = new CategoryQueryManager(query);

    for (const category of categories) {
        manager.addCategory(category);
    }

    return Object.fromEntries(await manager.getResults());
}

export const queryMemory = async (query: string): Promise<string> => {
	const summary = await getSummary();

	if (!summary.trim()) {
		return NO_MEMORY_RESPONSE;
	}

	const categories = await getCategoriesForQuery({
		query,
		summary,
		isIngestion: false,
        existingOnly: true
	});

	if (categories.length === 0) {
		return NO_MEMORY_RESPONSE;
	}

	const categoryResponses = await queryMultipleCategories(categories, query);
	const keys = Object.keys(categoryResponses);

	if (keys.length === 0) {
		return NO_MEMORY_RESPONSE;
	}

	if (keys.length === 1) {
		return categoryResponses[keys[0]]!;
	}

	return summarizeQueryResponse(query, categoryResponses);
}

interface IIngestCategoryUpdateOptions {
	summary: string;
	categoryName: string;
	reason: string;
	information: string;
}

const ingestCategoryUpdate = async ({
								  summary,
								  categoryName,
								  reason,
								  information
							  }: IIngestCategoryUpdateOptions) => {
	const filePath = getCategoryFilePath(categoryName);
	const previousCategoryContent = await fs.readFile(filePath, 'utf-8').catch(() => '');

	const prompt = getUpdateInSingleCategoryPrompt({
		summary,
		categoryName,
		previousCategoryContent,
		information,
		reason
	});

	const response = await retrieveSampledMessage({
		messages:  [prompt],
		maxTokens: 50_000
	});

	if (SKIP_TAG.isMatch(response)) {
		logInfo(`AI has skipped updating category ${categoryName}`);
		return undefined;
	}

	const newCategoryContent = CATEGORY_CONTENT_TAG.matchOne(response);
	if (!newCategoryContent) {
		logError(`AI was missing CATEGORY_CONTENT_TAG when updating category ${categoryName}. Response was:\n${response}`);
		return undefined;
	}

	MEMORY_EVENTS.emit('categoryDirty', {
		name:    categoryName,
		content: newCategoryContent,
	});
}

export const ingestMemory = async (information: string): Promise<void> => {
	const summary = await getSummary();
	const categories = await getCategoriesForQuery({
		summary,
		query:       information,
		isIngestion: true
	});

	if (categories.length === 0) {
		logError('No categories found for ingestion, skipping.');
		return;
	}

	logInfo(`Ingesting information into ${categories.length} categories: ${categories.map(c => c.categoryName).join(', ')}`);
	await Promise.all(categories.map(({ categoryName, reason }) => ingestCategoryUpdate({
		categoryName,
		information,
		summary,
		reason
	})));
}
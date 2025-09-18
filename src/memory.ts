import fs from 'node:fs/promises';
import { SUMMARY_FILE_PATH } from './args.js';
import path from 'node:path';
import {
	getInformationFromSingleCategoryPrompt,
	getSummarizeInformationFromManyCategoriesPrompt,
	getUpdateInSingleCategoryPrompt
} from './constants/prompts.js';
import { logError, logInfo, logWarn, retrieveSampledMessage } from './util/mcp.js';
import { getSummary, summarizeCategory } from './summary.js';
import { getCategoryFilePath } from './util/category.js';
import { ANSWER_TAG, CATEGORY_CONTENT_TAG, RESPONSE_TAG, SKIP_TAG } from './constants/regex.js';
import { getCategoriesForQuery, IQueryCategory } from './sampling.js';
import { MEMORY_EVENTS } from './events.js';

const readCategory = async (categoryName: string): Promise<string> => {
	return fs.readFile(getCategoryFilePath(categoryName), 'utf-8');
}

const queryCategory = async ({ categoryName, reason }: IQueryCategory, query: string): Promise<string | undefined> => {
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

	if (SKIP_TAG.isMatch(categoryContent)) {
		return undefined;
	}

	return RESPONSE_TAG.matchOne(response);
}

const summarizeCategories = async (query: string, responses: Record<string /*categoryName*/, string /*response*/>): Promise<string> => {
	const prompt = getSummarizeInformationFromManyCategoriesPrompt(query, responses);

	const response = await retrieveSampledMessage({
		messages:  [prompt],
		maxTokens: 50_000
	});

	const match = ANSWER_TAG.matchOne(response);
	if (!match) {
		throw new Error('Failed to parse answer from the response');
	}

	return match.trim();
}

const NO_MEMORY_RESPONSE = 'No relevant memory found for the query. Go search the codebase and once you\'re done, ingest your findings into memory for next time.';

export const queryMemory = async (query: string): Promise<string> => {
	const summary = await getSummary();

	if (!summary.trim()) {
		return NO_MEMORY_RESPONSE;
	}

	const categories = await getCategoriesForQuery({
		query,
		summary,
		isIngestion: false
	});

	if (categories.length === 0) {
		return NO_MEMORY_RESPONSE;
	}

	const categoryResponses: Record<string /*categoryName*/, string /*response*/> = {};

	await Promise.all(categories.map(async (category) => {
		const response = await queryCategory(category, query);
		if (response) {
			categoryResponses[category.categoryName] = response;
		}
	}));

	const keys = Object.keys(categoryResponses);

	if (keys.length === 0) {
		return NO_MEMORY_RESPONSE;
	}

	if (keys.length === 1) {
		return categoryResponses[keys[0]]!;
	}

	return summarizeCategories(query, categoryResponses);
}

interface IUpdateCategoryOptions {
	summary: string;
	categoryName: string;
	reason: string;
	information: string;
}

const updateCategory = async ({
								  summary,
								  categoryName,
								  reason,
								  information
							  }: IUpdateCategoryOptions) => {
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

	const match = CATEGORY_CONTENT_TAG.matchOne(response);
	if (!match) {
		logError(`AI was missing CATEGORY_CONTENT_TAG when updating category ${categoryName}. Response was:\n${response}`);
		return undefined;
	}

	const newCategoryContent = match.trim();
	const summarizePromise = summarizeCategory(categoryName, newCategoryContent);

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const writeFilePromise = fs.writeFile(filePath, newCategoryContent, 'utf-8');

	await Promise.all([summarizePromise, writeFilePromise]);

	const description = await summarizePromise;

	MEMORY_EVENTS.emit('categoryDirty', {
		name:    categoryName,
		content: newCategoryContent,
		description
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
	await Promise.all(categories.map(({ categoryName, reason }) => updateCategory({
		categoryName,
		information,
		summary,
		reason
	})));
}
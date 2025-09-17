import fs from 'node:fs/promises';
import { SUMMARY_FILE_PATH } from './args.js';
import path from 'node:path';
import {
	getCategoriesFromQueryPrompt,
	getInformationFromSingleCategoryPrompt,
	getSummarizeInformationFromManyCategoriesPrompt,
	getUpdateInSingleCategoryPrompt
} from './constants/prompts.js';
import { retrieveSampledMessage } from './util/mcp.js';
import { getSummary, summarizeCategory, updateSummary } from './summary.js';
import { getCategoryFilePath } from './util/category.js';

const readCategory = async (categoryName: string): Promise<string> => {
	return fs.readFile(getCategoryFilePath(categoryName), 'utf-8');
}

interface IGetCategoriesForQueryOptions {
	summary: string;
	query: string;
	isIngestion: boolean;
}

const getCategoriesForQuery = async ({
										 summary,
										 query,
										 isIngestion
									 }: IGetCategoriesForQueryOptions): Promise<Array<string>> => {
	const prompt = getCategoriesFromQueryPrompt(summary, query, isIngestion);

	const response = await retrieveSampledMessage({
		messages:  [prompt],
		maxTokens: 5000
	});

	const matches = response.matchAll(CATEGORIES_REGEX);
	const categories: Array<string> = [];

	for (const match of matches) {
		const category = match.groups?.category?.trim();
		if (category) {
			// todo: ask the AI again?
			if (!CATEGORY_NAME_REGEX.test(category)) {
				throw new Error(`AI generated an invalid category name: ${category}`);
			}

			categories.push(category);
		}
	}

	return categories;
}

const SKIP_REGEX = /(<SKIP\/>|<SKIP>(?<reason>[\s\S]*?)<\/SKIP>)/;
const RESPONSE_REGEX = /<RESPONSE>(?<response>[\s\S]*?)<\/RESPONSE>/;

const isSkipped = (response: string) => SKIP_REGEX.test(response);

const queryCategory = async (categoryName: string, query: string): Promise<string | undefined> => {
	const categoryContent = await readCategory(categoryName);
	const prompt = getInformationFromSingleCategoryPrompt(query, categoryContent);

	const response = await retrieveSampledMessage({
		messages:  [prompt],
		maxTokens: 5_000
	});

	if (SKIP_REGEX.test(categoryContent)) {
		return undefined;
	}

	return response.match(RESPONSE_REGEX)?.groups?.response || undefined;
}

const ANSWER_REGEX = /<ANSWER>(?<answer>[\s\S]*?)<\/ANSWER>/;

const summarizeCategories = async (query: string, responses: Record<string /*categoryName*/, string /*response*/>): Promise<string> => {
	const prompt = getSummarizeInformationFromManyCategoriesPrompt(query, responses);

	const response = await retrieveSampledMessage({
		messages:  [prompt],
		maxTokens: 50_000
	});

	const match = response.match(ANSWER_REGEX)?.groups?.answer;
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
			categoryResponses[category] = response;
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

const CATEGORY_CONTENT_REGEX = /<CATEGORY_CONTENT>(?<content>[\s\S]*?)<\/CATEGORY_CONTENT>/;

interface IUpdateCategoryOptions {
	summary: string;
	categoryName: string;
	information: string;
}

const updateCategory = async ({
								  summary,
								  categoryName,
								  information
							  }: IUpdateCategoryOptions): Promise<string /*summary*/ | undefined> => {
	const filePath = getCategoryFilePath(categoryName);
	const previousCategoryContent = await fs.readFile(filePath, 'utf-8').catch(() => '');

	const prompt = getUpdateInSingleCategoryPrompt({
		summary,
		categoryName,
		previousCategoryContent,
		information
	});

	const response = await retrieveSampledMessage({
		messages:  [prompt],
		maxTokens: 50_000
	});

	if (isSkipped(response)) {
		return undefined;
	}

	const match = response.match(CATEGORY_CONTENT_REGEX)?.groups?.content;
	if (!match) {
		return undefined;
	}

	const newCategoryContent = match.trim();
	const summarizePromise = summarizeCategory(categoryName, newCategoryContent);

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const writeFilePromise = fs.writeFile(filePath, newCategoryContent, 'utf-8');

	await Promise.all([summarizePromise, writeFilePromise]);

	return summarizePromise;
}

export const ingestMemory = async (information: string): Promise<void> => {
	const summary = await getSummary();
	const categories = await getCategoriesForQuery({
		summary,
		query:       information,
		isIngestion: true
	});

	if (categories.length === 0) {
		return;
	}

	const updatedDescriptions: Record<string /*categoryName*/, string /*summary*/> = {};

	await Promise.all(categories.map(async (category) => updateCategory({
		categoryName: category,
		information,
		summary
	}).then(summary => {
		if (summary) {
			updatedDescriptions[category] = summary;
		}
	})));

	const summaryFile = await fs.readFile(SUMMARY_FILE_PATH, 'utf-8');
	await updateSummary(summaryFile, updatedDescriptions);
}
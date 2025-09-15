import fs from 'node:fs/promises';
import { MEMORY_DIRECTORY, SUMMARY_FILE_PATH } from './args.js';
import { SUMMARY_FILE_NAME, USER_CATEGORY_NAME, USER_FILE_NAME } from './constants/files.js';
import path from 'node:path';
import {
    getCategoriesFromQueryPrompt, getInformationFromSingleCategoryPrompt,
    getSummarizeInformationFromManyCategoriesPrompt, getUpdateInSingleCategoryPrompt
} from './constants/prompts.js';
import { retrieveSampledMessage } from './util/mcp.js';
import { summarizeCategory, updateSummary } from './summary.js';

export const readAllMemory = async (): Promise<Record<string /*categoryName*/, string /*content*/>> => {
    const memory: Record<string, string> = {};

    const readNode = async (nodePath: string, parents: string[] = []): Promise<void> => {
        const files = await fs.readdir(nodePath, { withFileTypes: true });

        for (const node of files) {
            if (node.isDirectory()) {
                await readNode(node.name, [...parents, node.name]);
                continue;
            }

            if (!node.isFile()) {
                continue;
            }

            if (!node.name.endsWith('.md')) {
                continue;
            }

            if (node.name === SUMMARY_FILE_NAME) {
                continue;
            }

            const content = await fs.readFile(path.join(nodePath, node.name), 'utf-8');

            const baseName = path.basename(node.name, '.md');
            const categoryName = `${parents.join('/')}/${baseName}`;

            memory[categoryName] = content;
        }
    }

    await readNode(MEMORY_DIRECTORY, []);

    return memory;
}

const getCategoryParts = (categoryName: string): string[] => {
    return categoryName === USER_CATEGORY_NAME
        ? [USER_FILE_NAME]
        : categoryName.split('/');
}

const ensureCategoryParentExists = async (categoryName: string): Promise<void> => {
    const parts = getCategoryParts(categoryName);
    parts.pop();
    await fs.mkdir(path.join(MEMORY_DIRECTORY, ...parts), { recursive: true });
}

const getCategoryFilePath = (categoryName: string): string => {
    const categoryParts = getCategoryParts(categoryName);
    const fileBaseName = path.join(MEMORY_DIRECTORY, ...categoryParts);
    return `${fileBaseName}.md`;
}

const readCategory = async (categoryName: string): Promise<string> => {
    return fs.readFile(getCategoryFilePath(categoryName), 'utf-8');
}

const CATEGORIES_REGEX = /<CATEGORY>(?<category>[\s\S]*?)<\/CATEGORY>/g;

const getCategoriesForQuery = async (query: string, isIngestion: boolean): Promise<Array<string>> => {
    const summaryFile = await fs.readFile(SUMMARY_FILE_PATH, 'utf-8');
    const prompt = getCategoriesFromQueryPrompt(summaryFile, query, isIngestion);

    const response = await retrieveSampledMessage({
        messages: [prompt],
        maxTokens: 5000
    });

    const matches = response.matchAll(CATEGORIES_REGEX);
    const categories: Array<string> = [];
    for (const match of matches) {
        if (match.groups?.category) {
            categories.push(match.groups.category.trim());
        }
    }
    return categories;
}

const SKIP_REGEX = /<SKIP>(?<reason>[\s\S]*?)<\/SKIP>/;
const RESPONSE_REGEX = /<RESPONSE>(?<response>[\s\S]*?)<\/RESPONSE>/;

const isSkipped = (response: string) => SKIP_REGEX.test(response);

const queryCategory = async (categoryName: string, query: string): Promise<string | undefined> => {
    const categoryContent = await readCategory(categoryName);
    const prompt = getInformationFromSingleCategoryPrompt(query, categoryContent);

    const response = await retrieveSampledMessage({
        messages: [prompt],
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
        messages: [prompt],
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
    const categories = await getCategoriesForQuery(query, false /*isIngestion*/);
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

const updateCategory = async (categoryName: string, information: string): Promise<string /*summary*/ | undefined> => {
    const filePath = getCategoryFilePath(categoryName);
    const previousCategoryContent = await fs.readFile(filePath, 'utf-8').catch(() => '');

    const prompt = getUpdateInSingleCategoryPrompt({
        categoryName,
        previousCategoryContent,
        information
    });

    const response = await retrieveSampledMessage({
        messages: [prompt],
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
    await ensureCategoryParentExists(newCategoryContent);
    const writeFilePromise = fs.writeFile(filePath, newCategoryContent, 'utf-8');

    await Promise.all([summarizePromise, writeFilePromise]);

    return summarizePromise;
}

export const ingestMemory = async (information: string): Promise<void> => {
    const categories = await getCategoriesForQuery(information, true /*isIngestion*/);

    if (categories.length === 0) {
        return;
    }

    const updatedDescriptions: Record<string /*categoryName*/, string /*summary*/> = {};

    await Promise.all(categories.map(async (category) => updateCategory(category, information).then(summary => {
        if (summary) {
            updatedDescriptions[category] = summary;
        }
    })));

    const summaryFile = await fs.readFile(SUMMARY_FILE_PATH, 'utf-8');
    await updateSummary(summaryFile, updatedDescriptions);
}
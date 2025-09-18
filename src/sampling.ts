import { getCategoriesFromQueryPrompt } from './constants/prompts.js';
import { CATEGORY_NAME_TAG, CATEGORY_TAG, REASON_TAG, TagRegexManager } from './constants/regex.js';
import { logError, retrieveSampledMessage } from './util/mcp.js';

interface IGetCategoriesForQueryOptions {
    summary: string;
    query: string;
    isIngestion: boolean;
}

export interface IQueryCategory {
	categoryName: string;
	reason: string;
}

export const parseQueryCategories = (tag: TagRegexManager, response: string): Array<IQueryCategory> => {
    const categories: Array<IQueryCategory> = [];

    tag.forEach(response, (categoryContent) => {
        const categoryName = CATEGORY_NAME_TAG.matchOne(categoryContent);
        const reason = REASON_TAG.matchOne(categoryContent);

        if (!categoryName || !reason) {
            logError(`Category name: ${categoryName}, reason: ${reason}, full content: ${categoryContent}`);
            throw new Error(`AI generated an invalid category block: ${categoryContent}`);
        }

        categories.push({ categoryName, reason });
    });

    return categories;
}

export const getCategoriesForQuery = async ({
                                         summary,
                                         query,
                                         isIngestion
                                     }: IGetCategoriesForQueryOptions): Promise<Array<IQueryCategory>> => {
    const prompt = getCategoriesFromQueryPrompt(summary, query, isIngestion);

    const response = await retrieveSampledMessage({
        messages:  [prompt],
        maxTokens: 5000
    });

    return parseQueryCategories(CATEGORY_TAG, response);
}

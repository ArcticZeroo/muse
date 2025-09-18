import { getCategoriesFromQueryPrompt } from './constants/prompts.js';
import { CATEGORY_TAG, CATEGORY_NAME_TAG, REASON_TAG } from './constants/regex.js';
import { logDebug, logError, logInfo, retrieveSampledMessage } from './util/mcp.js';

interface IGetCategoriesForQueryOptions {
    summary: string;
    query: string;
    isIngestion: boolean;
}

export interface IQueryCategory {
	categoryName: string;
	reason: string;
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

    const categories: Array<IQueryCategory> = [];

    CATEGORY_TAG.forEach(response, (categoryContent) => {
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

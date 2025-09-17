import { getCategoriesFromQueryPrompt } from './constants/prompts.js';
import {
    CATEGORIES_TAG,
    CATEGORIES_TAG_REGEX,
    CATEGORY_NAME_REGEX, CATEGORY_NAME_TAG,
    forEachTag,
    REASON_TAG
} from './constants/regex.js';
import { retrieveSampledMessage } from './util/mcp.js';

interface IGetCategoriesForQueryOptions {
    summary: string;
    query: string;
    isIngestion: boolean;
}

export const getCategoriesForQuery = async ({
                                         summary,
                                         query,
                                         isIngestion
                                     }: IGetCategoriesForQueryOptions): Promise<Array<string>> => {
    const prompt = getCategoriesFromQueryPrompt(summary, query, isIngestion);

    const response = await retrieveSampledMessage({
        messages:  [prompt],
        maxTokens: 5000
    });

    const categories: Array<[string /*categoryName*/, string /*reason*/]> = [];

    CATEGORIES_TAG.forEach(response, (categoryContent) => {
        const categoryName = CATEGORY_NAME_TAG.matchOne(categoryContent);
        const reason = REASON_TAG.matchOne(categoryContent);

        if (!categoryName || !reason) {
            throw new Error(`AI generated an invalid category block: ${categoryContent}`);
        }

        categories.push([categoryName, reason]);
    });

    return categories;
}

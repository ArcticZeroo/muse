import { VersionEntry } from './versioning.js';
import { DESCRIPTION_TAG } from './constants/regex.js';
import { MemorySession } from './session.js';
import { retrieveSampledMessage } from './util/sampling.js';

export const serializeSummaryFromVersions = (versions: Map<string /*categoryName*/, VersionEntry>): string => {
	const entriesInOrder = Array.from(versions.entries())
		// TS won't let me destructure in the parameters of the filter function for some reason
		.sort(([a], [b]) => a.localeCompare(b));
	return entriesInOrder.flatMap(([key, { description }]) => {
		return [
			`### ${key}`,
			`${description}`
		];
	}).join('\r\n\r\n');
}

export const retrieveCategoryDescriptionAsync = async (session: MemorySession, categoryName: string, content: string): Promise<string> => {
	const prompt = await session.prompts.getCategoryDescriptionPrompt(categoryName, content);

	const response = await retrieveSampledMessage({
        session,
		messages:  [prompt],
		maxTokens: 2000
	});

	const description = DESCRIPTION_TAG.matchOne(response);
	if (!description) {
		throw new Error('Unable to generate description.');
	}

	return description;
};
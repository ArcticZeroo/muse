import { ifTruthy } from '../util/string.js';

export class TagRegexManager {
	readonly tagName: string;
    readonly #globalRegex: RegExp;
	readonly #singleRegex: RegExp;
	readonly #allowEmpty: boolean;

    constructor(tagName: string, allowEmpty: boolean = false) {
		this. tagName = tagName;
		this.#allowEmpty = allowEmpty;

		const regexContent = `<${tagName}>(?<content>[\\s\\S]*?)<\\/${tagName}>${ifTruthy(allowEmpty, `<${tagName}/>`)}`;
        this.#globalRegex = new RegExp(regexContent, 'g');
		this.#singleRegex = new RegExp(regexContent);
    }

	#getContentFromMatch(match: RegExpMatchArray | null): string | undefined {
		// allowEmpty still requires the tag to exist.
		if (!match) {
			return undefined;
		}

		const result = match.groups?.content?.trim();
		if (!result && this.#allowEmpty) {
			return '';
		}

		return result;
	}

    matchOne(value: string): string | undefined {
        return this.#getContentFromMatch(value.match(this.#singleRegex));
    }

    matchAll(value: string): string[] {
        const matches: string[] = [];
        this.forEach(value, (tagValue) => {
            matches.push(tagValue);
        });
        return matches;
    }

    forEach(value: string, callback: (tagValue: string) => void) {
        const matches = value.matchAll(this.#globalRegex);
        for (const match of matches) {
            const group = this.#getContentFromMatch(match);
            if (group != null) {
                callback(group);
            }
        }
    }

	isMatch(value: string): boolean {
		return this.#globalRegex.test(value);
	}
}

export const CATEGORY_TAG = new TagRegexManager('CATEGORY');
export const CATEGORY_NAME_TAG = new TagRegexManager('CATEGORY_NAME');
export const REASON_TAG = new TagRegexManager('REASON');
export const SKIP_TAG = new TagRegexManager('SKIP', true /*allowEmpty*/);
export const CATEGORY_CONTENT_TAG = new TagRegexManager('CATEGORY_CONTENT');
export const ANSWER_TAG = new TagRegexManager('ANSWER');
export const DESCRIPTION_TAG = new TagRegexManager('DESCRIPTION');
export const CATEGORY_REFERENCE_TAG = new TagRegexManager('CATEGORY_REFERENCE');

export const CATEGORY_NAME_REGEX = /^([\w_-]+\/)*[\w_-]+$/;
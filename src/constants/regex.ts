class TagRegexManager {
    #regex: RegExp;

    constructor(tagName: string) {
        this.#regex = new RegExp(`<${tagName}>(?<content>[\\s\\S]*?)<\\/${tagName}>`, 'g');
    }

    matchOne(value: string): string | undefined {
        return value.match(this.#regex)?.groups?.content?.trim();
    }

    matchAll(value: string): string[] {
        const matches = [];
        this.forEach(value, (tagValue) => {
            matches.push(tagValue);
        });
        return matches;
    }

    forEach(value: string, callback: (tagValue: string) => void) {
        const matches = value.matchAll(this.#regex);
        for (const match of matches) {
            const group = match.groups?.content?.trim();
            if (group) {
                callback(group);
            }
        }
    }
}

export const CATEGORIES_TAG = new TagRegexManager('CATEGORY');
export const CATEGORY_NAME_TAG= new TagRegexManager('CATEGORY_NAME');
export const REASON_TAG= new TagRegexManager('REASON');

export const CATEGORY_NAME_REGEX = /^([\w_-]+\/)*[\w_-]+$/;
import { USER_CATEGORY_NAME, USER_FILE_NAME } from '../constants/files.js';

interface ITreeNode {
    categories: Set<string>;
    children: Map<string, ITreeNode>;
}

export const buildCategoryTree = (categoryNames: Iterable<string>) => {
    const root: ITreeNode = {
        categories: new Set(),
        children: new Map()
    };

    for (const categoryName of categoryNames) {
        const parts = categoryName.split('/');
        let currentNode = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i]!;
            if (!currentNode.children.has(part)) {
                currentNode.children.set(part, {
                    categories: new Set(),
                    children: new Map()
                });
            }
            currentNode = currentNode.children.get(part)!;
        }
        currentNode.categories.add(parts[parts.length - 1]);
    }

    return root;
}

const getTreeLines = (node: ITreeNode): string[] => {
    const lines: string[] = [];

    const categories = Array.from(node.categories)
        .map(category => category === USER_CATEGORY_NAME ? USER_FILE_NAME : `${category}.md`)
        .sort((a, b) => a.localeCompare(b))
        .join(', ');
    lines.push(`- ${categories}`);

    const childEntries = Array.from(node.children.entries())
        .sort(([a], [b]) => a.localeCompare(b));

    for (const [name, childNode] of childEntries) {
        const childLines = getTreeLines(childNode);
        lines.push(`- ${name}`);
        for (const line of childLines) {
            lines.push(`  |${line}`);
        }
    }

    return lines;
}

export const serializeCategoryTree = (node: ITreeNode): string => {
    return getTreeLines(node).join('\n');
}
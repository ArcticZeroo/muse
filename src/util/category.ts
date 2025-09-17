import { USER_CATEGORY_NAME, USER_FILE_NAME } from '../constants/files.js';
import path from 'node:path';
import { MEMORY_DIRECTORY } from '../args.js';

const getCategoryParts = (categoryName: string): string[] => {
	return categoryName === USER_CATEGORY_NAME
		? [USER_FILE_NAME]
		: categoryName.split('/');
}

export const getCategoryFilePath = (categoryName: string): string => {
	const categoryParts = getCategoryParts(categoryName);
	const fileBaseName = path.join(MEMORY_DIRECTORY, ...categoryParts);
	return `${fileBaseName}.md`;
}

export const getCategoryNameFromFilePath = (filePath: string): string => {
	const relativePath = path.relative(MEMORY_DIRECTORY, filePath);

	if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
		throw new Error(`File path is outside of memory directory: ${filePath}`);
	}

	const ext = path.extname(relativePath);

	if (ext !== '.md') {
		throw new Error(`Invalid file extension: ${ext}`);
	}

	const withoutExt = relativePath.slice(0, -ext.length);
	const parts = withoutExt.split(path.sep);
	if (parts.length === 1 && parts[0] === USER_FILE_NAME) {
		return USER_CATEGORY_NAME;
	}
	return parts.join('/');
}
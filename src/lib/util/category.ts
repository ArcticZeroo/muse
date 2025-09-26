import { USER_CATEGORY_NAME, USER_FILE_NAME } from '../constants/files.js';
import path from 'node:path';
import fsSync from 'node:fs';
import { IMemoryConfig } from '../models/session.js';

const getCategoryParts = (categoryName: string): string[] => {
	return categoryName === USER_CATEGORY_NAME
		? [USER_FILE_NAME]
		: categoryName.split('/');
}

export const getCategoryFilePath = (config: IMemoryConfig, categoryName: string): string => {
	const categoryParts = getCategoryParts(categoryName);
	const fileBaseName = path.join(config.memoryDirectory, ...categoryParts);
	return `${fileBaseName}.md`;
}

export const getCategoryNameFromFilePath = (config: IMemoryConfig, filePath: string): string => {
	const relativePath = path.relative(config.memoryDirectory, filePath);

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

export const isCategoryMissing = (config: IMemoryConfig, categoryName: string): boolean => {
    return categoryName !== USER_CATEGORY_NAME && !fsSync.existsSync(getCategoryFilePath(config, categoryName));
};
import fs from 'node:fs/promises';
import { jsonc } from 'jsonc';
import { VERSIONS_FILE_NAME } from './constants/files.js';
import z from 'zod';
import { CATEGORY_NAME_REGEX } from './memory.js';
import { LockedMap } from './util/map.js';
import { Lock } from './util/lock.js';

const versionEntrySchema = z.object({
	contentHash: z.string().nonempty(),
	description: z.string().nonempty(),
});

type VersionEntry = z.infer<typeof versionEntrySchema>;

const versionFileSchema = z.record(
	z.string().nonempty().regex(CATEGORY_NAME_REGEX).describe('Category name'),
	z.object({
		contentHash: z.string().nonempty(),
		description: z.string().nonempty(),
	})
);

type VersionRecord = z.infer<typeof  versionFileSchema>;

const getVersionsFromDisk = async (): Promise<VersionRecord> => {
	const fileContents = await fs.readFile(VERSIONS_FILE_NAME, 'utf-8');
	try {
		const result = jsonc.parse(fileContents);
		return  versionFileSchema.parse(result);
	} catch (err) {
		console.error('Failed to parse versions file, returning empty object:', err);
		return {};
	}
}

const VERSIONS = new Map<string /*categoryName*/, VersionEntry>();
const lock = new Lock();

// todo: newVersions is supposed to be a -diff- here, not the full set of versions
export const updateVersions = async (newVersions: Record<string, VersionEntry>) => {
	return lock.acquire(async () => {
	});
}

const watchFileForChanges = () => {
	const watcher = fs.watch(VERSIONS_FILE_NAME, { persistent: false });
	for await (const _ of watcher) {
		updateVersions(await getVersionsFromDisk());
	}
}
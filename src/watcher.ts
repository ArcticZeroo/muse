import fs from 'node:fs/promises';
import path from 'node:path';
import { MEMORY_DIRECTORY } from './args.js';
import { VERSIONS_FILE_NAME } from './constants/files.js';
import { FILE_SYSTEM_EVENTS } from './events.js';

export const watchForChanges = async () => {
	const watcher = fs.watch(MEMORY_DIRECTORY, { recursive: true, persistent: false });

	for await (const { filename, eventType } of watcher) {
		if (!filename) {
			FILE_SYSTEM_EVENTS.emit('unknownFileChanged', eventType);
			return;
		}

		if (filename === VERSIONS_FILE_NAME) {
			FILE_SYSTEM_EVENTS.emit('versionsDirty');
			return;
		}

		if (path.extname(filename) !== '.md') {
			return;
		}

		// Added, removed, changed all fall into the same bucket of "dirty"
		FILE_SYSTEM_EVENTS.emit('categoryDirty', filename);
	}
}
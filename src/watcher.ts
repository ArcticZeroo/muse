import fs from 'node:fs/promises';
import { MEMORY_DIRECTORY } from './args.js';
import fsSync from 'node:fs';
import { FILE_SYSTEM_EVENTS } from './events.js';
import path from 'node:path';
import { VERSIONS_FILE_NAME } from './constants/files.js';

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

		// added or removed
		if (eventType === 'rename') {
			if (!fsSync.existsSync(filename)) {
				FILE_SYSTEM_EVENTS.emit('categoryDeleted', filename);
			} else {
				FILE_SYSTEM_EVENTS.emit('categoryDirty', filename);
			}
		} else if (eventType === 'change') {
			FILE_SYSTEM_EVENTS.emit('categoryDirty', filename);
		}
	}
}
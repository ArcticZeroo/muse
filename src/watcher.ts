import fs from 'node:fs/promises';
import { MEMORY_DIRECTORY } from './args.js';

const watchForChanges = async () => {
	const watcher = fs.watch(MEMORY_DIRECTORY, { recursive: true, persistent: false });

	for await (const { filename, eventType } of watcher) {
		// added or removed
		if (eventType === 'rename') {

		} else if (eventType === 'change') {
			
		}
	}
}
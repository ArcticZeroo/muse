import fs from 'node:fs/promises';
import path from 'node:path';
import { SUMMARY_FILE_NAME } from '../constants/files.js';
import { MEMORY_DIRECTORY } from '../args.js';
import { IMemoryNode } from '../models/memory.js';

export async function* findAllMemoryNodes(): AsyncGenerator<IMemoryNode> {
	async function* readNode(nodePath: string, parents: string[] = []): AsyncGenerator<IMemoryNode> {
		const files = await fs.readdir(nodePath, { withFileTypes: true });

		for (const node of files) {
			if (node.isDirectory()) {
				yield* readNode(path.join(nodePath, node.name), [...parents, node.name]);
				continue;
			}

			if (!node.isFile()) {
				continue;
			}

			if (!node.name.endsWith('.md')) {
				continue;
			}

			if (node.name === SUMMARY_FILE_NAME) {
				continue;
			}

			const filePath = path.join(nodePath, node.name);
			const baseName = path.basename(node.name, '.md');
			const categoryName = `${parents.join('/')}/${baseName}`;

			yield { categoryName, filePath };
		}
	}

	yield* readNode(MEMORY_DIRECTORY, []);
}

export const readAllMemory = async (): Promise<Record<string /*categoryName*/, string /*content*/>> => {
	const memory: Record<string, string> = {};

	for await (const { categoryName, filePath } of findAllMemoryNodes()) {
		memory[categoryName] = await fs.readFile(filePath, 'utf-8');
	}

	return memory;
}
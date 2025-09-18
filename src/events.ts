import EventEmitter from 'node:events';
import TypedEventEmitter from './models/typed-emitter.js';
import { EventName } from 'chokidar/handler.js';

export interface ICategoryDirtyEvent {
	name: string;
	content: string;
}

type MemoryEvents = {
	categoryDirty: (event: ICategoryDirtyEvent) => void;
}

type FileSystemEvents = {
	categoryDirty: (filename: string) => void;
	categoryDeleted: (filename: string) => void;
	versionsDirty: () => void;
	unknownFileChanged: (eventType: EventName) => void;
}

export const MEMORY_EVENTS = new EventEmitter() as TypedEventEmitter<MemoryEvents>;
export const FILE_SYSTEM_EVENTS = new EventEmitter() as TypedEventEmitter<FileSystemEvents>;
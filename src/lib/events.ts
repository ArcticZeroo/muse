import { EventName } from 'chokidar/handler.js';

export interface ICategoryDirtyEvent {
	name: string;
	content: string;
}

export type MemoryEvents = {
	categoryDirty: (event: ICategoryDirtyEvent) => void;
    permissionDenied: () => void;
}

export type FileSystemEvents = {
	categoryDirty: (filename: string) => void;
	categoryDeleted: (filename: string) => void;
	versionsDirty: () => void;
	unknownFileChanged: (eventType: EventName) => void;
}
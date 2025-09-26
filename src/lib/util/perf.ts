import { logDebug } from './mcp.js';

export const trackSpan = async <T>(name: string, work: () => T): Promise<Awaited<T>> => {
    const now = performance.now();
    const result = await work();
    const elapsedTime = performance.now() - now;
    logDebug(`${name}: ${elapsedTime.toFixed(2)}ms`);
    return result;
}
// allows throwing errors in a ternary
export const throwError = (message: string): never => {
    throw new Error(message);
}
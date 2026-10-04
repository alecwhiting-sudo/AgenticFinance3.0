import { AsyncLocalStorage } from "node:async_hooks";

/** Book-code execution context (ARCHITECTURE.md D16). The command gateway
 * decides which book a command executes into (eval-originated → "test");
 * everything downstream — fdpPost, postJournal, intake inserts — reads the
 * context instead of threading a parameter through every service signature.
 * Outside any context the book is "main": loaders, drips and human actions
 * post to the real books unchanged. */
const als = new AsyncLocalStorage<string>();

export const MAIN_BOOK = "main";
export const TEST_BOOK = "test";

export function currentBook(): string {
  return als.getStore() ?? MAIN_BOOK;
}

export function runInBook<T>(book: string, fn: () => Promise<T>): Promise<T> {
  return als.run(book, fn);
}

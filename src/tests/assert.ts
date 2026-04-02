export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected: ${String(expected)}, received: ${String(actual)}`);
  }
}

export function assertIncludes<T>(items: T[], predicate: (item: T) => boolean, message: string) {
  if (!items.some(predicate)) {
    throw new Error(message);
  }
}

export function assertObject(
  value: unknown,
  message: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

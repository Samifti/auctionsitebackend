"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assert = assert;
exports.assertEqual = assertEqual;
exports.assertIncludes = assertIncludes;
exports.assertObject = assertObject;
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}. Expected: ${String(expected)}, received: ${String(actual)}`);
    }
}
function assertIncludes(items, predicate, message) {
    if (!items.some(predicate)) {
        throw new Error(message);
    }
}
function assertObject(value, message) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(message);
    }
}

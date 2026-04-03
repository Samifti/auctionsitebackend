"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.fail = fail;
function ok(data) {
    return { success: true, data };
}
function fail(error) {
    return { success: false, error };
}

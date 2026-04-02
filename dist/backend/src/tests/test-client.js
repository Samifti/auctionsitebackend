"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRequest = apiRequest;
exports.createTextUploadForm = createTextUploadForm;
const BASE_URL = process.env.SMOKE_TEST_BASE_URL ?? "http://localhost:4000";
async function apiRequest(path, options = {}) {
    const headers = new Headers();
    if (options.token) {
        headers.set("Authorization", `Bearer ${options.token}`);
    }
    let body;
    if (options.formData) {
        body = options.formData;
    }
    else if (options.body !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(options.body);
    }
    const response = await fetch(`${BASE_URL}${path}`, {
        method: options.method ?? "GET",
        headers,
        body,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    return {
        status: response.status,
        ok: response.ok,
        data,
    };
}
function createTextUploadForm(filename, content) {
    const formData = new FormData();
    const blob = new Blob([content], { type: "text/plain" });
    formData.append("files", blob, filename);
    return formData;
}

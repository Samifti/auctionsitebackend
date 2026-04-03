"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const scenarios_1 = require("./scenarios");
const results = [];
async function main() {
    const context = {
        adminToken: "",
        customerToken: "",
    };
    try {
        const auth = await runStep("auth", async () => (0, scenarios_1.runAuthChecks)());
        context.adminToken = auth.adminToken;
        context.customerToken = auth.customerToken;
        await runStep("browse-and-bid", async () => (0, scenarios_1.runBrowseAndBidChecks)(context));
        await runStep("admin", async () => (0, scenarios_1.runAdminChecks)(context));
        await runStep("cleanup", async () => (0, scenarios_1.cleanupAdminArtifacts)(context));
        printSummary();
        process.exit(0);
    }
    catch (error) {
        try {
            if (context.adminToken) {
                await (0, scenarios_1.cleanupAdminArtifacts)(context);
            }
        }
        catch (cleanupError) {
            console.error("Cleanup failed:", cleanupError);
        }
        console.error("Smoke test failed:", error instanceof Error ? error.message : error);
        printSummary();
        process.exit(1);
    }
}
async function runStep(name, fn) {
    process.stdout.write(`Running ${name}... `);
    const result = await fn();
    results.push(`PASS ${name}`);
    console.log("ok");
    return result;
}
function printSummary() {
    console.log("\nSmoke test summary");
    for (const result of results) {
        console.log(`- ${result}`);
    }
    console.log(`${results.length}/4 checks passed`);
}
void main();

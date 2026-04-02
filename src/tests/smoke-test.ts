import {
  cleanupAdminArtifacts,
  runAdminChecks,
  runAuthChecks,
  runBrowseAndBidChecks,
} from "./scenarios";

type SmokeContext = {
  adminToken: string;
  customerToken: string;
  activeProperty?: unknown;
  uploadedImageUrl?: string;
  tempPropertyId?: string;
};

const results: string[] = [];

async function main() {
  const context: SmokeContext = {
    adminToken: "",
    customerToken: "",
  };

  try {
    const auth = await runStep("auth", async () => runAuthChecks());
    context.adminToken = auth.adminToken;
    context.customerToken = auth.customerToken;

    await runStep("browse-and-bid", async () =>
      runBrowseAndBidChecks(context as Parameters<typeof runBrowseAndBidChecks>[0]),
    );

    await runStep("admin", async () =>
      runAdminChecks(context as Parameters<typeof runAdminChecks>[0]),
    );

    await runStep("cleanup", async () =>
      cleanupAdminArtifacts(context as Parameters<typeof cleanupAdminArtifacts>[0]),
    );

    printSummary();
    process.exit(0);
  } catch (error) {
    try {
      if (context.adminToken) {
        await cleanupAdminArtifacts(context as Parameters<typeof cleanupAdminArtifacts>[0]);
      }
    } catch (cleanupError) {
      console.error("Cleanup failed:", cleanupError);
    }

    console.error("Smoke test failed:", error instanceof Error ? error.message : error);
    printSummary();
    process.exit(1);
  }
}

async function runStep<T>(name: string, fn: () => Promise<T>) {
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

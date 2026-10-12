import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
let provider;
vm.runInNewContext(
  readFileSync(new URL("../Sources/CodexBarCore/Resources/Plugins/openrouter.js", import.meta.url), "utf8"),
  {
    defineProvider: (definition) => {
      provider = definition;
    },
  },
);
async function usage(key) {
  return provider.fetchUsage({
    settings: { get: () => null, getSecret: () => null },
    date: { now: () => new Date("2026-10-12T23:59:59Z") },
    pct: (used, limit) => Math.min(100, Math.max(0, (100 * used) / limit)),
    fail: { parseFailure: (message) => new Error(message), apiFailure: (message) => new Error(message) },
    http: {
      get: async (url) => ({
        status: 200,
        bodyText: JSON.stringify({
          data: url.endsWith("/credits") ? { total_credits: 0, total_usage: 0 } : key,
        }),
      }),
    },
  });
}
test("exhausted free quota is visible independently of zero dollar spend", async () => {
  const result = await usage({
    usage_daily: 0,
    usage_monthly: 0,
    free_model_daily_requests: { used: 50, limit: 50, remaining: 0 },
  });
  assert.equal(result.primary.usedPercent, 100);
  assert.equal(result.primary.resetsAt.toISOString(), "2026-10-13T00:00:00.000Z");
  assert.equal(result.primary.resetDescription.includes("50 / 50 free requests"), true);
  assert.equal(result.cost.used, 0);
  assert.equal(result.cost.balance, 0);
  const rows = result.details.find((section) => section.title === "Daily free requests").rows;
  assert.equal(rows.find((row) => row.label === "Requests remaining").value, "0");
});
test("server limits are respected without assuming fifty requests", async () => {
  const result = await usage({ free_model_daily_requests: { used: 200, limit: 1000, remaining: 800 } });
  assert.equal(result.primary.usedPercent, 20);
  assert.equal(result.primary.resetDescription.includes("800 remaining"), true);
});
test("missing and invalid optional counters preserve the spending cap", async () => {
  for (const counter of [
    undefined,
    null,
    [],
    { used: 1, limit: 0, remaining: 0 },
    { used: -1, limit: 50, remaining: 50 },
    { used: 0.5, limit: 50, remaining: 49 },
    { used: 1, limit: "50", remaining: 49 },
    { used: 0, limit: 50, remaining: 51 },
    { used: 1, limit: 50 },
    { used: Infinity, limit: 50, remaining: 0 },
  ]) {
    const result = await usage({ limit: 20, usage: 5, free_model_daily_requests: counter });
    assert.equal(result.primary.usedPercent, 25);
    assert.equal(result.primary.resetsAt, undefined);
    assert.equal(
      result.details.some((section) => section.title === "Daily free requests"),
      false,
    );
  }
});
test("legacy zero spend without a counter does not invent request usage", async () => {
  const result = await usage({ usage_daily: 0, usage_monthly: 0 });
  assert.equal(result.primary, undefined);
  assert.equal(result.cost.used, 0);
});

const UI_KEYWORDS = ["ui", "browser", "playwright", "mcp", "test", "testing"];

export function isUiTestRequest(message) {
  const normalized = normalizeMessage(message);
  const hasUiContext =
    normalized.includes("ui") ||
    normalized.includes("browser") ||
    normalized.includes("playwright") ||
    normalized.includes("mcp");
  const hasTestIntent =
    normalized.includes("test") ||
    normalized.includes("tests") ||
    normalized.includes("testing") ||
    normalized.includes("check") ||
    normalized.includes("verify") ||
    normalized.includes("validate") ||
    normalized.includes("search");

  if (normalized.includes("perform ui test") || normalized.includes("perform ui testing")) {
    return true;
  }

  if (hasUiContext && hasTestIntent) {
    return true;
  }

  return UI_KEYWORDS.some((keyword) => normalized.includes(keyword)) &&
    /(run|perform|check|verify|validate|test|search)/.test(normalized);
}

function normalizeMessage(message) {
  return (message ?? "")
    .toLowerCase()
    .replace(/perfrom/g, "perform")
    .replace(/\s+/g, " ")
    .trim();
}

export const UI_TEST_SYSTEM_PROMPT = `You are a browser testing agent using Playwright MCP.

Your job is to complete the target flow, but you must obey the flow contract.

You must execute the flow by calling MCP browser tools. Do not answer with a standalone Playwright script, pseudocode, or a description of what you would do instead of using tools.

Rules:
1. You may choose any appropriate MCP browser tool yourself.
2. After every meaningful action, you must verify the new state before continuing.
3. Prefer user-facing locators: role, label, visible text, test-id.
4. Never proceed if the page matches a forbidden route.
5. If expected state is unclear, use browser_snapshot or browser_run_code to verify.
6. Report drift immediately instead of improvising a different flow.
7. Your task is not complete until the success milestone is validated.
8. If you have not used an MCP browser tool yet, your next response must be a tool call.
9. If MCP tools are unavailable or insufficient, say so explicitly instead of generating code.`;

export const DEFAULT_ASSISTANT_PROMPT = `You are a concise Node.js chatbot. Help the user directly.
If the user asks to perform UI tests, delegate to the Playwright MCP browser-testing workflow instead of answering from general knowledge.`;

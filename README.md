# UI Tester Chatbot

Small Node.js CLI chatbot that sends normal chat messages to an Ollama model and routes `Perform UI tests` requests into a Playwright MCP tool-calling loop.

## What it does

- Talks to Ollama through `POST /api/chat`
- Connects to Playwright MCP over stdio
- Lets the model choose Playwright MCP tools dynamically
- Uses a dedicated browser-testing system prompt for UI test requests
- Returns UI test outcomes as JSON containing user-visible executed steps

## Browser agent prompt

```text
You are a browser testing agent using Playwright MCP.

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
9. If MCP tools are unavailable or insufficient, say so explicitly instead of generating code.
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Make sure Ollama is running locally and the selected model is available:

```bash
ollama pull glm-5:cloud
```

3. Start the chatbot:

```bash
npm start
```

## Environment variables

- `OLLAMA_URL`: Ollama base URL. Default: `http://127.0.0.1:11434`
- `OLLAMA_MODEL`: model used for chat and tool selection. Default: `glm-5:cloud`
- `PLAYWRIGHT_MCP_COMMAND`: command used to launch Playwright MCP. Default: `npx`
- `PLAYWRIGHT_MCP_ARGS`: arguments passed to the Playwright MCP command. Default: `@playwright/mcp`
- `MAX_TOOL_ROUNDS`: max tool-calling turns before aborting. Default: `20`

## Example

```text
> Perform UI tests for the login flow on http://localhost:3000. Success means the dashboard is visible after sign-in.
```

The request is forwarded to the browser-testing agent prompt, the model inspects available MCP tools, and the chatbot executes the requested Playwright MCP calls until the flow is validated or drift is reported.

UI test responses are returned as formatted JSON with:

- `status`: overall result
- `summary`: final model summary
- `steps`: user-visible actions performed through Playwright MCP
- `metadata`: counts and timestamp
- `savedTo`: relative path to the saved JSON file inside the project

Saved result files are written to `test-results/` in the project root.

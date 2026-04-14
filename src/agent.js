import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DEFAULT_ASSISTANT_PROMPT, UI_TEST_SYSTEM_PROMPT } from "./prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const RESULTS_DIR = path.join(PROJECT_ROOT, "test-results");
const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "glm-5:cloud";
const DEFAULT_MCP_COMMAND = process.env.PLAYWRIGHT_MCP_COMMAND ?? "npx";
const DEFAULT_MCP_ARGS = splitArgs(
  process.env.PLAYWRIGHT_MCP_ARGS ?? "@playwright/mcp"
);
const MAX_TOOL_ROUNDS = Number.parseInt(process.env.MAX_TOOL_ROUNDS ?? "20", 10);

export async function runUiTestAgent(userRequest) {
  const transport = new StdioClientTransport({
    command: DEFAULT_MCP_COMMAND,
    args: DEFAULT_MCP_ARGS
  });

  const client = new Client(
    {
      name: "ui-tester-chatbot",
      version: "1.0.0"
    },
    {
      capabilities: {}
    }
  );

  await client.connect(transport);

  try {
    const toolsResponse = await client.listTools();
    const tools = (toolsResponse.tools ?? []).map(toOllamaTool);

    if (tools.length === 0) {
      throw new Error("Playwright MCP did not expose any tools.");
    }

    const messages = [
      { role: "system", content: UI_TEST_SYSTEM_PROMPT },
      {
        role: "user",
        content: userRequest
      }
    ];
    let hasUsedTools = false;
    const executedSteps = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const reply = await chatWithOllama({
        model: DEFAULT_OLLAMA_MODEL,
        messages,
        tools
      });

      const assistantMessage = normalizeAssistantMessage(reply.message);
      messages.push(assistantMessage);

      const toolCalls = assistantMessage.tool_calls ?? [];
      if (toolCalls.length === 0) {
        if (!hasUsedTools) {
          messages.push({
            role: "user",
            content:
              "You must use Playwright MCP tools for this task. Do not generate a raw Playwright script or high-level instructions. Start by calling the most appropriate MCP browser tool now."
          });
          continue;
        }

        const resultPayload = buildUiTestResult({
          request: userRequest,
          summary:
            sanitizeAssistantText(assistantMessage.content) ||
            "UI test flow completed with no final summary returned by the model.",
          executedSteps
        });
        const savedPath = await saveUiTestResult(resultPayload);

        return JSON.stringify(
          {
            ...resultPayload,
            savedTo: path.relative(PROJECT_ROOT, savedPath)
          },
          null,
          2
        );
      }

      hasUsedTools = true;

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function?.name;
        const toolArgs = toolCall.function?.arguments ?? {};

        if (!toolName) {
          throw new Error("Model returned a tool call without a name.");
        }

        const result = await client.callTool({
          name: toolName,
          arguments: toolArgs
        });
        const formattedResult = formatToolResult(result);

        executedSteps.push(
          buildStepRecord({
            index: executedSteps.length + 1,
            toolName,
            toolArgs,
            result,
            formattedResult
          })
        );

        messages.push({
          role: "tool",
          content: formattedResult,
          name: toolName
        });
      }
    }

    throw new Error(`UI test agent exceeded ${MAX_TOOL_ROUNDS} tool rounds.`);
  } finally {
    await client.close();
  }
}

export async function chatNormally(userMessage) {
  const reply = await chatWithOllama({
    model: DEFAULT_OLLAMA_MODEL,
    messages: [
      { role: "system", content: DEFAULT_ASSISTANT_PROMPT },
      { role: "user", content: userMessage }
    ]
  });

  return sanitizeAssistantText(reply.message?.content) || "No response returned by Ollama.";
}

async function chatWithOllama(payload) {
  const response = await fetch(`${DEFAULT_OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      stream: false,
      ...payload
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Ollama chat request failed (${response.status}): ${errorBody}`);
  }

  return response.json();
}

function toOllamaTool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema ?? { type: "object", properties: {} }
    }
  };
}

function normalizeAssistantMessage(message = {}) {
  const normalized = {
    role: "assistant",
    content: message.content ?? ""
  };

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    normalized.tool_calls = message.tool_calls.map((toolCall) => ({
      function: {
        name: toolCall.function?.name,
        arguments: normalizeArguments(toolCall.function?.arguments)
      }
    }));
  }

  return normalized;
}

function normalizeArguments(argumentsValue) {
  if (!argumentsValue) {
    return {};
  }

  if (typeof argumentsValue === "string") {
    try {
      return JSON.parse(argumentsValue);
    } catch {
      return {};
    }
  }

  return argumentsValue;
}

function formatToolResult(result) {
  if (!result) {
    return "Tool returned no data.";
  }

  if (typeof result.content === "string") {
    return result.content;
  }

  if (Array.isArray(result.content)) {
    return result.content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item?.type === "text") {
          return item.text ?? "";
        }

        return JSON.stringify(item);
      })
      .join("\n");
  }

  return JSON.stringify(result);
}

function splitArgs(value) {
  const matches = value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((part) => part.replace(/^"|"$/g, ""));
}

function sanitizeAssistantText(value = "") {
  return value.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function buildUiTestResult({ request, summary, executedSteps }) {
  const visibleSteps = executedSteps.filter((step) => step.userVisible);

  return {
    request,
    status: inferOverallStatus(summary, visibleSteps),
    summary,
    steps: visibleSteps,
    metadata: {
      totalSteps: executedSteps.length,
      userVisibleSteps: visibleSteps.length,
      generatedAt: new Date().toISOString()
    }
  };
}

function buildStepRecord({ index, toolName, toolArgs, result, formattedResult }) {
  return {
    step: index,
    tool: toolName,
    action: describeToolAction(toolName, toolArgs),
    userVisible: isUserVisibleTool(toolName),
    arguments: toolArgs,
    result: summarizeToolResult(formattedResult),
    status: inferStepStatus(result)
  };
}

function isUserVisibleTool(toolName = "") {
  return /(click|type|fill|press|navigate|goto|select|hover|drag|tap|snapshot|screenshot|wait)/i.test(toolName);
}

function describeToolAction(toolName, toolArgs) {
  const locator =
    toolArgs?.element ||
    toolArgs?.selector ||
    toolArgs?.text ||
    toolArgs?.url ||
    toolArgs?.value ||
    toolArgs?.role ||
    toolArgs?.name;

  if (!locator) {
    return toolName;
  }

  return `${toolName}: ${String(locator)}`;
}

function summarizeToolResult(result) {
  const singleLine = String(result ?? "").replace(/\s+/g, " ").trim();
  return singleLine.length > 280 ? `${singleLine.slice(0, 277)}...` : singleLine;
}

function inferStepStatus(result) {
  if (result?.isError === true) {
    return "failed";
  }

  if (Array.isArray(result?.content)) {
    const textContent = result.content
      .map((item) => (item?.type === "text" ? item.text ?? "" : JSON.stringify(item)))
      .join("\n")
      .toLowerCase();

    if (textContent.includes("### error") || textContent.includes("tool error")) {
      return "failed";
    }
  }

  return "passed";
}

function inferOverallStatus(summary, visibleSteps) {
  const normalizedSummary = String(summary ?? "").toLowerCase();

  if (
    normalizedSummary.includes("drift") ||
    normalizedSummary.includes("forbidden") ||
    normalizedSummary.includes("could not") ||
    normalizedSummary.includes("unable to") ||
    normalizedSummary.includes("failed to")
  ) {
    return "failed";
  }

  if (visibleSteps.some((step) => step.status === "failed")) {
    return "failed";
  }

  return visibleSteps.length > 0 ? "passed" : "incomplete";
}

async function saveUiTestResult(resultPayload) {
  await mkdir(RESULTS_DIR, { recursive: true });

  const fileName = `ui-test-result-${buildTimestampToken()}.json`;
  const filePath = path.join(RESULTS_DIR, fileName);

  await writeFile(filePath, JSON.stringify(resultPayload, null, 2));

  return filePath;
}

function buildTimestampToken() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

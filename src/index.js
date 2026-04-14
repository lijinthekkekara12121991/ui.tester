import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runUiTestAgent, chatNormally } from "./agent.js";
import { isUiTestRequest } from "./prompts.js";

const rl = readline.createInterface({ input, output });

console.log("UI Tester chatbot ready. Type a message, or 'exit' to quit.");

try {
  while (true) {
    const userMessage = (await rl.question("> ")).trim();

    if (!userMessage) {
      continue;
    }

    if (/^(exit|quit)$/i.test(userMessage)) {
      break;
    }

    try {
      const reply = isUiTestRequest(userMessage)
        ? await runUiTestAgent(userMessage)
        : await chatNormally(userMessage);

      console.log(`\nAssistant: ${reply}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\nError: ${message}\n`);
    }
  }
} finally {
  rl.close();
}

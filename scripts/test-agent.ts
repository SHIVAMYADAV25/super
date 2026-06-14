// import dotenv from "dotenv";

// dotenv.config({ path: ".env" });

// console.log("DATABASE_URL =", process.env.DATABASE_URL);
// console.log("NEXTAUTH_URL =", process.env.NEXTAUTH_URL);

// async function main() {
//   const OpenAI = (await import("openai")).default;

//   const {
//     Agent,
//     run,
//     tool,
//     setDefaultOpenAIClient,
//   } = await import("@openai/agents");

//   const { OpenAIAgentsProvider } = await import("@corsair-dev/mcp");

//   const { corsair } = await import("../src/server/lib/corsair");

//   const openrouter = new OpenAI({
//     apiKey: process.env.OPENROUTER_API_KEY!,
//     baseURL: 'https://openrouter.ai/api/v1',
//   });

//   setDefaultOpenAIClient(openrouter);

//   const provider = new OpenAIAgentsProvider();

//   const tools = await provider.build({
//     corsair,
//     tool,
//   });

//   console.log(`Loaded ${tools.length} tools`);

//   const agent = new Agent({
//     name: "corsair-test-agent",
//     model: "nex-agi/nex-n2-pro:free",
//     instructions: "Setup corsair and use tools when needed.",
//     tools,
//   });

//   const result = await run(
//     agent,
//     "Setup corsair and list available operations."
//   );

//   console.log(result.finalOutput);
// }

// main().catch(console.error);

import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

async function main() {
  const response = await client.chat.completions.create({
  model: "nex-agi/nex-n2-pro:free",

  messages: [
    {
      role: "user",
      content: "List available operations"
    }
  ],

  tools: [
    {
      type: "function",
      function: {
        name: "list_operations",
        description: "List available Corsair operations",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      }
    }
  ],

  tool_choice: "auto"
});

  console.log(JSON.stringify(response, null, 2));
}

main().catch(console.error);
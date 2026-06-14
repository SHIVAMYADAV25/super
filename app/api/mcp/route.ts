import {
  createBaseMcpServer,
  createMcpRouter,
} from "@corsair-dev/mcp";

import { corsair } from "@/src/server/lib/corsair";

export const dynamic = "force-dynamic";

console.log("MCP ROUTE LOADED");

let handler;

try {
  console.log("Creating MCP server...");
  
  const serverFactory = () => {
    console.log("Creating base server...");
    
    return createBaseMcpServer({
      corsair,
    });
  };

  handler = createMcpRouter(serverFactory);

  console.log("MCP router created");
} catch (err) {
  console.error("MCP INIT ERROR", err);
  throw err;
}

export { handler as GET, handler as POST };
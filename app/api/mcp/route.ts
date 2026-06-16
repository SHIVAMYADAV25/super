// import {
//   createBaseMcpServer,
//   createMcpRouter,
// } from "@corsair-dev/mcp";

// import { corsair } from "@/src/server/lib/corsair";

// export const dynamic = "force-dynamic";

// console.log("MCP ROUTE LOADED");

// let handler;

// try {
//   console.log("Creating MCP server...");
  
//   const serverFactory = () => {
//     console.log("Creating base server...");
    
//     return createBaseMcpServer({
//       corsair,
//     });
//   };

//   handler = createMcpRouter(serverFactory);

//   console.log("MCP router created");
// } catch (err) {
//   console.error("MCP INIT ERROR", err);
//   throw err;
// }

// export { handler as GET, handler as POST };

import { NextResponse } from "next/server";
import { getTenant } from "@/src/server/lib/corsair"; // adjust path

export async function GET() {
  try {
    const googleSub = "YOUR_GOOGLE_SUB";

    const tenant = getTenant('115022235190203160742');

    const result = await tenant.gmail.api.messages.delete({
      id:"19eb2769d476cbf5",
      userId:""
    });

    console.log("Gmail Result:");
    console.dir(result, { depth: null });

    return NextResponse.json({
      success: true,
      // count: result.messages?.length ?? 0,
      // messages: result.messages,
      // nextPageToken: result.nextPageToken,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: String(error),
      },
      { status: 500 },
    );
  }
}
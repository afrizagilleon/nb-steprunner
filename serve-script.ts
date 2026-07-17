// serve-script.js - Bun/Node
import { serve } from "bun";

const PORT = 8080;
const FILE = "./script-myscript.js";

serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/script-myscript.js") {
      return new Response(Bun.file(FILE), {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 Serving ${FILE} at http://localhost:${PORT}/script-myscript.js`);
console.log(`   Headers: no-cache, must-revalidate`);

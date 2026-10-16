import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  // The public API accepts bounded, structured inputs rather than file bodies.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res
      .set("Cache-Control", "no-store")
      .type("application/javascript")
      .send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  server.on("error", error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  const host = process.env.HOST || "0.0.0.0";
  const strictPort = process.env.STRICT_PORT === "true";
  let shuttingDown = false;
  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; closing HTTP server.`);
    const forceExit = setTimeout(() => {
      console.error(
        "HTTP server did not close within 10 seconds; forcing exit."
      );
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    server.close(error => {
      clearTimeout(forceExit);
      if (error) {
        console.error("Server shutdown failed:", error.message);
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  server.listen({ port, host, exclusive: strictPort }, () =>
    console.log(`Server listening on ${host}:${port}`)
  );
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});

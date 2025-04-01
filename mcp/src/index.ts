#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"; // Use McpServer, import type
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execa } from 'execa';
import path from 'path';
// import { spawn } from 'child_process'; // Remove spawn import
import { fileURLToPath } from 'url';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js"; // Import error types

// Define __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

 // Path to the compiled main script
 const analyzerScriptPath = path.resolve(__dirname, '..', '..', 'dist', 'index.js');

// Define the input schema for the run_analyzer tool - used for validation internally by SDK
const RunAnalyzerInputSchema = z.object({
  directory: z.string().describe("The absolute path to the project directory to analyze."),
});
// Define the expected shape of the arguments for the handler based on the schema
type RunAnalyzerArgs = z.infer<typeof RunAnalyzerInputSchema>;

// Create an MCP server
const server = new McpServer({
  name: "code-analyzer-mcp",
  version: "0.1.0"
});

// Add the run_analyzer tool
server.tool(
  "run_analyzer",
  // Provide the parameter shape, not the full schema object
  { directory: z.string() },
  // Let types be inferred for args and context, remove explicit McpResponse return type
  async (args, context) => {
    console.error(`[MCP Server Log] 'run_analyzer' tool called.`);

    // Type assertion for args based on the shape provided above
    const { directory } = args as RunAnalyzerArgs;
    const absoluteAnalysisDir = path.resolve(directory);
    const projectRootDir = path.resolve(__dirname, '..', '..'); // c:/code/amcp

    if (!directory || typeof directory !== 'string') {
         console.error('[MCP Server Log] Invalid directory input provided.');
         return {
            content: [{ type: "text", text: 'Invalid directory input provided.' }],
            isError: true
         };
    }

    console.error(`[MCP Server Log] Attempting to run analyzer in: ${directory}`);
    console.error(`[MCP Server Log] Analyzer script path: ${analyzerScriptPath}`);
    console.error(`[MCP Server Log] Target analysis directory (absolute): ${absoluteAnalysisDir}`);

    // --- Construct the manual command string ---
      const commandString = [
        'node',
        `"${analyzerScriptPath}"`,
 // Quote path
        'analyze',
        `"${absoluteAnalysisDir}"`,
 // Quote path
        '--update-schema',
        '--neo4j-url', 'bolt://localhost:7687',
        '--neo4j-user', 'neo4j',
        '--neo4j-password', 'test1234',
        '--neo4j-database', 'codegraph'
      ].join(' ');

      console.error(`[MCP Server Log] Constructed command: ${commandString}`);
      console.error(`[MCP Server Log] Required CWD: ${projectRootDir}`);
      // Return the command details as JSON within the text content
      const commandDetails = {
           command: commandString,
          cwd: projectRootDir
      };
      return {
          content: [{ type: "text", text: JSON.stringify(commandDetails) }],
          _meta: { requires_execute_command: true } // Add metadata hint
      };
  }
);

// Error handling (optional but recommended)
// server.onerror = (error) => console.error('[MCP Error]', error);
 // Remove - Property 'onerror' does not exist on type 'McpServer'.
process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
});


// Start receiving messages on stdin and sending messages on stdout
async function startServer() {
    console.error('[MCP Server Log] Starting server...');
    const transport = new StdioServerTransport();
    console.error('[MCP Server Log] Stdio transport created.');
    await server.connect(transport);
    console.error('[MCP Server Log] Server connected to transport. Running on stdio.');
}

startServer().catch(console.error);
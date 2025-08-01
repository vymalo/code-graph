#!/usr/bin/env node

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";
import path from 'path';
import {analyze, config} from '@vymalo/code-graph-analyzer';
import fsPromises from "fs/promises";

// Define the input schema for the run_analyzer tool - used for validation internally by SDK
const RunAnalyzerInputSchema = z.object({
    directory: z.string().describe("The absolute path to the project directory to analyze."),
    extensions: z.string().nullable().optional().describe(`Comma-separated list of file extensions to include (default: ${config.supportedExtensions.join(',')})`),
    ignore: z.string().nullable().optional().describe("Comma-separated glob patterns to ignore (appends to default ignores)"),
    updateSchema: z.boolean().default(false).optional().describe('Force update Neo4j schema (constraints/indexes) before analysis'),
    resetDb: z.boolean().default(false).optional().describe('WARNING: Deletes ALL nodes and relationships before analysis'),
});

// Create an MCP server
const server = new McpServer({
    name: "code-analyzer-mcp",
    version: "1.0.0",
});

// Add the run_analyzer tool
server.tool(
    "run_analyzer",
    // Provide the parameter shape, not the full schema object
    RunAnalyzerInputSchema.shape,
    // Let types be inferred for args and context, remove explicit McpResponse return type
    async ({directory, extensions, updateSchema, ignore, resetDb}) => {
        console.error(`[Code Analyzer] 'run_analyzer' tool called.`);

        // Type assertion for args based on the shape provided above
        const absoluteAnalysisDir = path.resolve(directory);

        if (!directory || typeof directory !== 'string') {
            console.error('[Code Analyzer] Invalid directory input provided.');
            return {
                content: [{type: "text", text: 'Invalid directory input provided.'}],
                isError: true
            };
        }

        console.error(`[Code Analyzer] Target analysis directory (absolute): ${absoluteAnalysisDir}`);

        try {
            await analyze(absoluteAnalysisDir, {
                extensions: extensions ?? undefined,
                updateSchema,
                ignore: ignore ?? undefined,
                resetDb,
                neo4jUser: config.neo4jUser,
                neo4jPassword: config.neo4jPassword,
                neo4jDatabase: config.neo4jDatabase,
            })

            await fsPromises.rmdir(config.tempDir).catch(console.error);

            return {
                content: [
                    {
                        type: "text", text: `Successfully indexed the project at ${absoluteAnalysisDir}`
                    }
                ],
            };
        } catch (error) {
            await fsPromises.rmdir(config.tempDir).catch(console.error);
            
            return {
                content: [
                    {
                        type: "text", text: JSON.stringify(error)
                    }
                ],
            };
        }
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
    const transport = new StdioServerTransport();

    console.error('[Code Analyzer] Server connected to transport. Running on stdio.');
    await server.connect(transport);
}

startServer().catch(console.error);
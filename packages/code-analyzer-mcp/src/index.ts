#!/usr/bin/env node

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";
import path from 'path';
import {analyze, config} from '@vymalo/code-graph-analyzer';

// Define the input schema for the run_analyzer tool - used for validation internally by SDK
const RunAnalyzerInputSchema = z.object({
    directory: z.string().optional().nullable().describe("The absolute path to the project directory to analyze. No need to be configured when DEFAULT_DIR is configured."),
    extensions: z.string().nullable().optional().describe(`Comma-separated list of file extensions to include (default: ${config.supportedExtensions.join(',')}).`),
    ignore: z.string().nullable().optional().describe("Comma-separated glob patterns to ignore (appends to default ignores)"),
    updateSchema: z.boolean().default(true).optional().describe('Force update Neo4j schema (constraints/indexes) before analysis'),
    resetDb: z.boolean().default(true).optional().describe('WARNING: Deletes ALL nodes and relationships before analysis'),
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
    async ({directory = config.defaultDir, extensions, updateSchema, ignore, resetDb}) => {
        console.error(`[Code Analyzer] 'run_analyzer' tool called.`);

        if (!directory) {
            return {
                content: [{type: "text", text: 'Invalid directory input provided.'}],
                isError: true
            };
        }

        // Type assertion for args based on the shape provided above
        const absoluteAnalysisDir = path.resolve(directory);

        try {
            await analyze(absoluteAnalysisDir, {
                extensions: extensions ?? undefined,
                ignore: ignore ?? undefined,
                updateSchema: updateSchema ?? false,
                resetDb: resetDb ?? false,
                neo4jUrl: config.neo4jUrl,
                neo4jUser: config.neo4jUser,
                neo4jPassword: config.neo4jPassword,
                neo4jDatabase: config.neo4jDatabase,
            })

            await config.cleanTmp();

            return {
                content: [
                    {
                        type: "text", text: `Successfully indexed the project at ${absoluteAnalysisDir}`
                    }
                ],
            };
        } catch (error) {
            await config.cleanTmp();

            return {
                content: [
                    {
                        type: "text", text: JSON.stringify(error)
                    }
                ],
                isError: true
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
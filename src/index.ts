#!/usr/bin/env node

import { Command } from 'commander';
import { registerAnalyzeCommand } from './cli/analyze.js';
import { createContextLogger } from './utils/logger.js';
import { AppError } from './utils/errors.js';
// Import package.json to get version (requires appropriate tsconfig settings)
// If using ES Modules, need to handle JSON imports correctly
// Option 1: Assert type (requires "resolveJsonModule": true, "esModuleInterop": true in tsconfig)
// import pkg from '../package.json' assert { type: 'json' };
// Option 2: Read file and parse (more robust)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const logger = createContextLogger('App');

// Function to read and parse package.json
function getPackageVersion(): string {
    try {
        // Handle ES Module __dirname equivalent
        const __filename = fileURLToPath(import.meta.url);
        // When running from dist/index.js, __dirname is dist. package.json is one level up.
        const distDir = path.dirname(__filename);
        const pkgPath = path.resolve(distDir, '../package.json'); // Go up one level from dist
        const pkgData = fs.readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgData);
        return pkg.version || '0.0.0';
    } catch (error) {
        logger.warn('Could not read package.json for version.', { error });
        return '0.0.0';
    }
}

async function main() {
    logger.info('Starting CLI application...');

    const program = new Command();

    program
        .name('code-analyzer-cli') // Replace with your actual CLI name
        .version(getPackageVersion(), '-v, --version', 'Output the current version')
        .description('A CLI tool to analyze codebases and store insights in Neo4j.');

    // Register commands
    registerAnalyzeCommand(program);
    // Register other commands here if needed

    program.on('command:*', () => {
        logger.error(`Invalid command: ${program.args.join(' ')}\nSee --help for a list of available commands.`);
        process.exit(1);
    });

    try {
        await program.parseAsync(process.argv);
        logger.info('CLI finished.');
    } catch (error: unknown) {
        if (error instanceof AppError) {
            // Log known application errors gracefully
            logger.error(`Command failed: ${error.message}`, {
                name: error.name,
                context: error.context,
                code: error.code,
                // Avoid logging originalError stack twice if logger already handles it
                // originalError: error.originalError instanceof Error ? error.originalError.message : error.originalError
            });
        } else if (error instanceof Error) {
            // Log unexpected errors
            logger.error(`An unexpected error occurred: ${error.message}`, { stack: error.stack });
        } else {
            // Log non-error exceptions
            logger.error('An unexpected non-error exception occurred.', { error });
        }
        process.exitCode = 1; // Ensure failure exit code
    }
}

main();
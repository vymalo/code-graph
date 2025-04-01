import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { GoParser } from './go-parser.js'; // Adjust path as needed
import { FileInfo } from '../../scanner/file-scanner.js'; // Adjust path as needed
import { AstNode, RelationshipInfo, SingleFileParseResult } from '../types.js'; // Adjust path as needed
import config from '../../config/index.js'; // Adjust path as needed
import { FileSystemError } from '../../utils/errors.js'; // Import error type

// Helper to parse a fixture file and return the result
async function parseFixture(fixturePath: string): Promise<SingleFileParseResult> {
    const parser = new GoParser(); // Create a new parser instance for each call
    const absolutePath = path.resolve(process.cwd(), fixturePath);

    const fileInfo: FileInfo = {
        path: absolutePath,
        name: path.basename(fixturePath),
        extension: path.extname(fixturePath),
    };

    // Ensure temp dir exists (parser might rely on it)
    try {
        await fs.mkdir(config.tempDir, { recursive: true });
    } catch (e) { /* Ignore if exists */ }

    const tempFilePath = await parser.parseFile(fileInfo);
    const resultJson = await fs.readFile(tempFilePath, 'utf-8');
    await fs.unlink(tempFilePath); // Clean up temp file
    return JSON.parse(resultJson);
}

describe('GoParser Unit Tests', () => {
    const fixtureDir = 'test_fixtures/go/simple_web_server';
    const goFileName = 'main.go'; // Corrected filename

    it('should parse main.go and identify the File node', async () => {
        const fixturePath = path.join(fixtureDir, goFileName); // Use variable
        const result = await parseFixture(fixturePath);
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(fileNode).toBeDefined();
        expect(fileNode?.name).toBe(goFileName); // Use variable
        expect(fileNode?.language).toBe('Go');
        expect(fileNode?.filePath).toContain(fixturePath.replace(/\\/g, '/'));
    });

    it('should identify the package clause in main.go', async () => {
        const fixturePath = path.join(fixtureDir, goFileName); // Use variable
        const result = await parseFixture(fixturePath);
        const packageNode = result.nodes.find(n => n.kind === 'PackageClause');
        const packageRel = result.relationships.find(r => r.type === 'DECLARES_PACKAGE');
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(packageNode).toBeDefined();
        expect(packageNode?.name).toBe('main');
        expect(packageRel).toBeDefined();
        expect(packageRel?.sourceId).toBe(fileNode?.entityId);
        expect(packageRel?.targetId).toBe(packageNode?.entityId);
    });

     it('should identify import declarations in main.go', async () => {
        const fixturePath = path.join(fixtureDir, goFileName); // Use variable
        const result = await parseFixture(fixturePath);
        const importNodes = result.nodes.filter(n => n.kind === 'ImportSpec');
        const importRels = result.relationships.filter(r => r.type === 'GO_IMPORTS');
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(importNodes.length).toBe(6); // Corrected expectation

        expect(importNodes.find(n => n.name === 'flag')).toBeDefined();
        expect(importNodes.find(n => n.name === 'log')).toBeDefined();
        expect(importNodes.find(n => n.name === 'net/http')).toBeDefined();
        expect(importNodes.find(n => n.name === 'time')).toBeDefined();
        expect(importNodes.find(n => n.name === 'example.com/simple_web_server/handlers')).toBeDefined();
        expect(importNodes.find(n => n.name === 'example.com/simple_web_server/utils')).toBeDefined();


        expect(importRels.length).toBe(6); // Corrected expectation
        expect(importRels.every(r => r.sourceId === fileNode?.entityId)).toBe(true);
    });

    it('should identify function definitions in main.go', async () => {
        const fixturePath = path.join(fixtureDir, goFileName); // Use variable
        const result = await parseFixture(fixturePath);
        const funcNodes = result.nodes.filter(n => n.kind === 'GoFunction');
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(funcNodes.length).toBe(2); // Corrected expectation: main, init

        const mainFunc = funcNodes.find(n => n.name === 'main');
        expect(mainFunc).toBeDefined();
        expect(mainFunc?.startLine).toBe(17); // Corrected line

        const initFunc = funcNodes.find(n => n.name === 'init');
        expect(initFunc).toBeDefined();
        expect(initFunc?.startLine).toBe(72); // Corrected line

        // Check relationship File -> DEFINES_FUNCTION -> Function
        const mainRel = result.relationships.find(r => r.type === 'DEFINES_FUNCTION' && r.targetId === mainFunc?.entityId);
        expect(mainRel).toBeDefined();
        expect(mainRel?.sourceId).toBe(fileNode?.entityId);
    });

    // Add tests for structs, methods (if any), calls etc.
});
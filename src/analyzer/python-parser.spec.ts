import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { PythonAstParser } from './python-parser.js'; // Adjust path as needed
import { FileInfo } from '../scanner/file-scanner.js'; // Adjust path as needed
import { AstNode, RelationshipInfo, SingleFileParseResult } from './types.js'; // Adjust path as needed
import config from '../config/index.js'; // Adjust path as needed

// Helper to load fixture content
async function loadFixture(fixturePath: string): Promise<string> {
    const absolutePath = path.resolve(process.cwd(), fixturePath);
    return fs.readFile(absolutePath, 'utf-8');
}

// Helper to parse a fixture file and return the result
async function parseFixture(fixturePath: string): Promise<SingleFileParseResult> {
    const parser = new PythonAstParser();
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

describe('PythonAstParser Unit Tests', () => {
    const fixturePath = 'test_fixtures/python/simple_test.py'; // Use the correct fixture

    it('should parse a simple Python file and identify the File node', async () => {
        const result = await parseFixture(fixturePath);
        const fileNode = result.nodes.find(n => n.kind === 'File'); // Expect 'File' kind

        expect(fileNode).toBeDefined();
        expect(fileNode?.name).toBe('simple_test.py');
        expect(fileNode?.language).toBe('Python');
        expect(fileNode?.filePath).toContain(fixturePath.replace(/\\/g, '/'));
    });

    it('should identify function and method definitions', async () => {
        const result = await parseFixture(fixturePath);
        const funcNodes = result.nodes.filter(n => n.kind === 'PythonFunction');
        const methodNodes = result.nodes.filter(n => n.kind === 'PythonMethod');

        expect(funcNodes.length).toBe(1); // greet
        expect(methodNodes.length).toBe(2); // __init__, get_value

        const greetFunc = funcNodes.find(n => n.name === 'greet');
        expect(greetFunc).toBeDefined();
        expect(greetFunc?.startLine).toBe(3); // Adjusted line
        expect(greetFunc?.endLine).toBe(5); // Adjusted line

        const initMethod = methodNodes.find(n => n.name === '__init__');
        expect(initMethod).toBeDefined();
        expect(initMethod?.startLine).toBe(8);
        expect(initMethod?.endLine).toBe(9);

        const getValueMethod = methodNodes.find(n => n.name === 'get_value');
        expect(getValueMethod).toBeDefined();
        expect(getValueMethod?.startLine).toBe(11);
        expect(getValueMethod?.endLine).toBe(12);
    });

     it('should identify function/method parameters', async () => {
        const result = await parseFixture(fixturePath);
        const paramNodes = result.nodes.filter(n => n.kind === 'PythonParameter');

        expect(paramNodes.length).toBe(4); // name, self, value, self

        const nameParam = paramNodes.find(n => n.name === 'name');
        expect(nameParam).toBeDefined();
        expect(nameParam?.parentId).toContain(':greet'); // Check parent linkage

        const valueParam = paramNodes.find(n => n.name === 'value');
        expect(valueParam).toBeDefined();
        expect(valueParam?.parentId).toContain(':SimpleClass.__init__'); // Check parent linkage

        const selfParams = paramNodes.filter(n => n.name === 'self');
        expect(selfParams.length).toBe(2);
        expect(selfParams[0]?.parentId).toContain(':SimpleClass.__init__');
        expect(selfParams[1]?.parentId).toContain(':SimpleClass.get_value');
    });

    it('should identify function calls (including top-level)', async () => {
        const result = await parseFixture(fixturePath);
        const callRels = result.relationships.filter(r => r.type === 'PYTHON_CALLS');

        expect(callRels.length).toBeGreaterThanOrEqual(2); // print() inside greet, greet() at top level

        // Find the call to 'print' (targetId is placeholder 'unknown:print')
        const printCallRel = callRels.find(r => r.properties?.calledName === 'print');
        expect(printCallRel).toBeDefined();
        expect(printCallRel?.sourceId).toContain(':greet'); // Called from greet

        // Find the call to 'greet' (targetId is placeholder 'unknown:greet')
        const greetCallRel = callRels.find(r => r.properties?.calledName === 'greet');
        expect(greetCallRel).toBeDefined();
        expect(greetCallRel?.sourceId).toContain('file:'); // Called from module/file level
    });

    it('should identify variable assignments', async () => {
        const result = await parseFixture(fixturePath);
        const varNodes = result.nodes.filter(n => n.kind === 'PythonVariable');

        expect(varNodes.length).toBe(1); // instance

        const instanceVar = varNodes.find(n => n.name === 'instance');
        expect(instanceVar).toBeDefined();
        expect(instanceVar?.startLine).toBe(15);
        expect(instanceVar?.parentId).toContain('file:'); // Assigned at module/file level
    });

    it('should identify class definitions', async () => {
        const result = await parseFixture(fixturePath);
        const classNode = result.nodes.find(n => n.kind === 'PythonClass');
        expect(classNode).toBeDefined();
        expect(classNode?.name).toBe('SimpleClass');
        expect(classNode?.startLine).toBe(7);
    });

});
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { JavaParser } from './java-parser.js'; // Adjust path as needed
import { FileInfo } from '../../scanner/file-scanner.js'; // Adjust path as needed
import { AstNode, RelationshipInfo, SingleFileParseResult } from '../types.js'; // Adjust path as needed
import config from '../../config/index.js'; // Adjust path as needed
import { FileSystemError } from '../../utils/errors.js'; // Import error type

// Helper to parse a fixture file and return the result
async function parseFixture(fixturePath: string): Promise<SingleFileParseResult> {
    const parser = new JavaParser(); // Create a new parser instance for each call
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

describe('JavaParser Unit Tests', () => {
    const fixtureDir = 'test_fixtures/java/simple-calculator';

    it('should parse Calculator.java and identify the File node', async () => {
        const fixturePath = path.join(fixtureDir, 'src/main/java/com/example/calculator/Calculator.java');
        const result = await parseFixture(fixturePath);
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(fileNode).toBeDefined();
        expect(fileNode?.name).toBe('Calculator.java');
        expect(fileNode?.language).toBe('Java');
        expect(fileNode?.filePath).toContain(fixturePath.replace(/\\/g, '/'));
    });

    it('should identify the package declaration in Calculator.java', async () => {
        const fixturePath = path.join(fixtureDir, 'src/main/java/com/example/calculator/Calculator.java');
        const result = await parseFixture(fixturePath);
        const packageNode = result.nodes.find(n => n.kind === 'PackageDeclaration');
        const packageRel = result.relationships.find(r => r.type === 'DECLARES_PACKAGE');
        const fileNode = result.nodes.find(n => n.kind === 'File');


        expect(packageNode).toBeDefined();
        expect(packageNode?.name).toBe('com.example.calculator');
        expect(packageRel).toBeDefined();
        expect(packageRel?.sourceId).toBe(fileNode?.entityId);
        expect(packageRel?.targetId).toBe(packageNode?.entityId);
    });

    it('should identify the class definition in Calculator.java', async () => {
        const fixturePath = path.join(fixtureDir, 'src/main/java/com/example/calculator/Calculator.java');
        const result = await parseFixture(fixturePath);
        const classNode = result.nodes.find(n => n.kind === 'JavaClass' && n.name === 'Calculator');
        const classRel = result.relationships.find(r => r.type === 'DEFINES_CLASS');
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(classNode).toBeDefined();
        expect(classNode?.startLine).toBe(16);
        expect(classRel).toBeDefined();
        expect(classRel?.sourceId).toBe(fileNode?.entityId);
        expect(classRel?.targetId).toBe(classNode?.entityId);
    });

    it('should identify method definitions in Calculator.java', async () => {
        const fixturePath = path.join(fixtureDir, 'src/main/java/com/example/calculator/Calculator.java');
        const result = await parseFixture(fixturePath);
        const methodNodes = result.nodes.filter(n => n.kind === 'JavaMethod');
        const classNode = result.nodes.find(n => n.kind === 'JavaClass' && n.name === 'Calculator');

        // Removed debug log

        expect(methodNodes.length).toBe(7); // Corrected expectation: Constructor, registerOp, performOp, getAvailable, store, recall, clear

        // Check a specific method like performOperation
        const performOpMethod = methodNodes.find(n => n.name === 'performOperation');
        expect(performOpMethod).toBeDefined();
        expect(performOpMethod?.startLine).toBe(61);
        expect(performOpMethod?.parentId).toBe(classNode?.entityId); // Check parent linkage

        const constructorMethod = methodNodes.find(n => n.name === 'Calculator'); // Constructor name matches class name
        expect(constructorMethod).toBeDefined();
        expect(constructorMethod?.startLine).toBe(25);
        expect(constructorMethod?.parentId).toBe(classNode?.entityId);
    });

    it('should identify field definitions in Calculator.java', async () => {
        const fixturePath = path.join(fixtureDir, 'src/main/java/com/example/calculator/Calculator.java');
        const result = await parseFixture(fixturePath);
        // Check for 'memory' field instead of 'history'
        const fieldNode = result.nodes.find(n => n.kind === 'JavaField' && n.name === 'memory');
        const fieldRel = result.relationships.find(r => r.type === 'HAS_FIELD' && r.targetId === fieldNode?.entityId);
        const classNode = result.nodes.find(n => n.kind === 'JavaClass' && n.name === 'Calculator');

        expect(fieldNode).toBeDefined();
        expect(fieldNode?.startLine).toBe(20);
        expect(fieldRel).toBeDefined();
        expect(fieldRel?.sourceId).toBe(classNode?.entityId);
    });

    it('should identify import declarations in Main.java', async () => {
        const fixturePath = path.join(fixtureDir, 'src/main/java/com/example/calculator/Main.java');
        const result = await parseFixture(fixturePath);
        const importNodes = result.nodes.filter(n => n.kind === 'ImportDeclaration');
        const importRels = result.relationships.filter(r => r.type === 'JAVA_IMPORTS');
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(importNodes.length).toBe(3); // Corrected expectation: InputMismatchException, Scanner, Set

        const scannerImport = importNodes.find(n => n.name === 'java.util.Scanner');
        expect(scannerImport).toBeDefined();

        const setImport = importNodes.find(n => n.name === 'java.util.Set');
        expect(setImport).toBeDefined();

        const exceptionImport = importNodes.find(n => n.name === 'java.util.InputMismatchException');
        expect(exceptionImport).toBeDefined();

        expect(importRels.length).toBe(3);
        expect(importRels.every(r => r.sourceId === fileNode?.entityId)).toBe(true);
    });

     it('should identify interface definition in Operation.java', async () => { // Corrected test description
        // Corrected path to include 'operations' subdirectory
        const fixturePath = path.join(fixtureDir, 'src/main/java/com/example/calculator/operations/Operation.java');
        const result = await parseFixture(fixturePath);
        // Corrected kind to 'JavaInterface'
        const interfaceNode = result.nodes.find(n => n.kind === 'JavaInterface' && n.name === 'Operation');
        // Corrected relationship type
        const interfaceRel = result.relationships.find(r => r.type === 'DEFINES_INTERFACE');
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(interfaceNode).toBeDefined();
        expect(interfaceNode?.startLine).toBe(6); // Corrected line
        expect(interfaceRel).toBeDefined();
        expect(interfaceRel?.sourceId).toBe(fileNode?.entityId);
        expect(interfaceRel?.targetId).toBe(interfaceNode?.entityId);
    });

    // Add more tests for calls, inheritance, interfaces etc.
});
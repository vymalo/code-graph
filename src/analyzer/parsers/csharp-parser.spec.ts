import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { CSharpParser } from './csharp-parser.js'; // Adjust path as needed
import { FileInfo } from '../../scanner/file-scanner.js'; // Adjust path as needed
import { AstNode, RelationshipInfo, SingleFileParseResult } from '../types.js'; // Adjust path as needed
import config from '../../config/index.js'; // Adjust path as needed

// Helper to parse a fixture file and return the result
async function parseFixture(fixturePath: string): Promise<SingleFileParseResult> {
    const parser = new CSharpParser(); // Create a new parser instance for each call
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

describe('CSharpParser Unit Tests', () => {
    const fixtureDir = 'test_fixtures/csharp/InventoryManager';

    it('should parse Program.cs and identify the File node', async () => {
        const fixturePath = path.join(fixtureDir, 'Program.cs');
        const result = await parseFixture(fixturePath);
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(fileNode).toBeDefined();
        expect(fileNode?.name).toBe('Program.cs');
        expect(fileNode?.language).toBe('C#');
        expect(fileNode?.filePath).toContain(fixturePath.replace(/\\/g, '/'));
    });

    it('should identify using directives in Program.cs', async () => {
        const fixturePath = path.join(fixtureDir, 'Program.cs');
        const result = await parseFixture(fixturePath);
        // Assuming CSharpParser creates 'UsingDirective' nodes
        const usingNodes = result.nodes.filter(n => n.kind === 'UsingDirective');
        const usingRels = result.relationships.filter(r => r.type === 'CSHARP_USING');
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(usingNodes.length).toBe(3); // Corrected: Models, Services, Interfaces (System is implicit)

        // expect(usingNodes.find(n => n.name === 'System')).toBeDefined(); // System is implicit
        expect(usingNodes.find(n => n.name === 'InventoryManager.Models')).toBeDefined();
        expect(usingNodes.find(n => n.name === 'InventoryManager.Services')).toBeDefined();
        expect(usingNodes.find(n => n.name === 'InventoryManager.Interfaces')).toBeDefined();

        expect(usingRels.length).toBe(3); // Corrected
        expect(usingRels.every(r => r.sourceId === fileNode?.entityId)).toBe(true);
    });

     it('should identify the namespace declaration in Program.cs', async () => {
        const fixturePath = path.join(fixtureDir, 'Program.cs');
        const result = await parseFixture(fixturePath);
        // Assuming CSharpParser creates 'NamespaceDeclaration' nodes
        const nsNode = result.nodes.find(n => n.kind === 'NamespaceDeclaration');
        const nsRel = result.relationships.find(r => r.type === 'DECLARES_NAMESPACE');
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(nsNode).toBeDefined();
        expect(nsNode?.name).toBe('InventoryManager');
        expect(nsRel).toBeDefined();
        expect(nsRel?.sourceId).toBe(fileNode?.entityId);
        expect(nsRel?.targetId).toBe(nsNode?.entityId);
    });


    it('should identify the class definition in Program.cs', async () => {
        const fixturePath = path.join(fixtureDir, 'Program.cs');
        const result = await parseFixture(fixturePath);
        // Assuming CSharpParser creates 'CSharpClass' nodes
        const classNode = result.nodes.find(n => n.kind === 'CSharpClass' && n.name === 'Program');
        const classRel = result.relationships.find(r => r.type === 'DEFINES_CLASS');
        const nsNode = result.nodes.find(n => n.kind === 'NamespaceDeclaration'); // Class is inside namespace

        expect(classNode).toBeDefined();
        expect(classNode?.startLine).toBe(11);
        expect(classRel).toBeDefined();
        expect(classRel?.sourceId).toBe(nsNode?.entityId); // Class defined within Namespace
        expect(classRel?.targetId).toBe(classNode?.entityId);
    });

    it('should identify method definitions in Program.cs', async () => {
        const fixturePath = path.join(fixtureDir, 'Program.cs');
        const result = await parseFixture(fixturePath);
        // Assuming CSharpParser creates 'CSharpMethod' nodes
        const methodNodes = result.nodes.filter(n => n.kind === 'CSharpMethod');
        const classNode = result.nodes.find(n => n.kind === 'CSharpClass' && n.name === 'Program');

        expect(methodNodes.length).toBe(1); // Only Main

        const mainMethod = methodNodes.find(n => n.name === 'Main');
        expect(mainMethod).toBeDefined();
        expect(mainMethod?.startLine).toBe(14);
        expect(mainMethod?.parentId).toBe(classNode?.entityId); // Check parent linkage
    });

    it('should identify interface definition in IInventoryItem.cs', async () => { // Corrected filename and interface name
        const fixturePath = path.join(fixtureDir, 'Interfaces/IInventoryItem.cs'); // Corrected filename
        const result = await parseFixture(fixturePath);
        // Assuming CSharpParser creates 'CSharpInterface' nodes
        const interfaceNode = result.nodes.find(n => n.kind === 'CSharpInterface' && n.name === 'IInventoryItem'); // Corrected interface name
        const interfaceRel = result.relationships.find(r => r.type === 'DEFINES_INTERFACE');
        const nsNode = result.nodes.find(n => n.kind === 'NamespaceDeclaration');

        expect(interfaceNode).toBeDefined();
        expect(interfaceNode?.startLine).toBe(6);
        expect(interfaceRel).toBeDefined();
        expect(interfaceRel?.sourceId).toBe(nsNode?.entityId);
        expect(interfaceRel?.targetId).toBe(interfaceNode?.entityId);
    });

     it('should identify property definitions in Product.cs', async () => {
        const fixturePath = path.join(fixtureDir, 'Models/Product.cs');
        const result = await parseFixture(fixturePath);
        // Assuming CSharpParser creates 'Property' nodes
        const propertyNodes = result.nodes.filter(n => n.kind === 'Property');
        const classNode = result.nodes.find(n => n.kind === 'CSharpClass' && n.name === 'Product');

        expect(propertyNodes.length).toBe(5); // Reverted expectation: Id, Name, Quantity, Price, DefaultCategory

        const nameProp = propertyNodes.find(n => n.name === 'Name');
        expect(nameProp).toBeDefined();
        expect(nameProp?.startLine).toBe(14);
        expect(nameProp?.parentId).toBe(classNode?.entityId);

        const quantityProp = propertyNodes.find(n => n.name === 'Quantity');
        expect(quantityProp).toBeDefined();
        expect(quantityProp?.startLine).toBe(15);
        expect(quantityProp?.parentId).toBe(classNode?.entityId);
    });

    // Add tests for structs, enums, calls, inheritance etc.
});
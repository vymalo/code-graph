import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { CCppParser } from './c-cpp-parser.js'; // Adjust path as needed
import { FileInfo } from '../../scanner/file-scanner.js'; // Adjust path as needed
import { AstNode, RelationshipInfo, SingleFileParseResult } from '../types.js'; // Adjust path as needed
import config from '../../config/index.js'; // Adjust path as needed

// Helper to parse a fixture file and return the result
async function parseFixture(fixturePath: string): Promise<SingleFileParseResult> {
    const parser = new CCppParser();
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

describe('CCppParser Unit Tests', () => {
    const fixtureDir = 'test_fixtures/cpp/shape_calculator';

    it('should parse main.cpp and identify the File node', async () => {
        const fixturePath = path.join(fixtureDir, 'src/main.cpp');
        const result = await parseFixture(fixturePath);
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(fileNode).toBeDefined();
        expect(fileNode?.name).toBe('main.cpp');
        expect(fileNode?.language).toBe('C++');
        expect(fileNode?.filePath).toContain(fixturePath.replace(/\\/g, '/'));
    });

    it('should identify function definitions in main.cpp', async () => {
        const fixturePath = path.join(fixtureDir, 'src/main.cpp');
        const result = await parseFixture(fixturePath);
        const funcNodes = result.nodes.filter(n => n.kind === 'CFunction'); // Using CFunction for now

        expect(funcNodes.length).toBe(2); // printShapeDetails, main

        const printFunc = funcNodes.find(n => n.name === 'printShapeDetails');
        expect(printFunc).toBeDefined();
        expect(printFunc?.startLine).toBe(13);

        const mainFunc = funcNodes.find(n => n.name === 'main');
        expect(mainFunc).toBeDefined();
        expect(mainFunc?.startLine).toBe(22);
    });

    it('should identify #include directives in main.cpp', async () => {
        const fixturePath = path.join(fixtureDir, 'src/main.cpp');
        const result = await parseFixture(fixturePath);
        const includeNodes = result.nodes.filter(n => n.kind === 'IncludeDirective');
        const includeRels = result.relationships.filter(r => r.type === 'INCLUDES');
        const fileNode = result.nodes.find(n => n.kind === 'File');

        expect(includeNodes.length).toBe(8); // iostream, vector, memory, stdexcept, Shape.h, Rectangle.h, Circle.h, MathUtils.h
        expect(includeRels.length).toBe(8);

        const iostreamInclude = includeNodes.find(n => n.properties?.includePath === 'iostream');
        expect(iostreamInclude).toBeDefined();
        expect(iostreamInclude?.properties?.isSystemInclude).toBe(true);

        const shapeInclude = includeNodes.find(n => n.properties?.includePath === 'shapes/Shape.h');
        expect(shapeInclude).toBeDefined();
        expect(shapeInclude?.properties?.isSystemInclude).toBe(false);

        // Check relationship source
        expect(includeRels.every(r => r.sourceId === fileNode?.entityId)).toBe(true);
    });

    it('should identify class definitions in Circle.h', async () => {
        // Note: Current parser doesn't explicitly create CppClass nodes yet.
        // This test will fail until class parsing is implemented.
        const fixturePath = path.join(fixtureDir, 'src/shapes/Circle.h');
        const result = await parseFixture(fixturePath);
        const classNode = result.nodes.find(n => n.kind === 'CppClass' && n.name === 'Circle');

        expect(classNode).toBeDefined(); // This will fail initially
    });

     it('should identify method definitions in Circle.cpp', async () => {
        // Note: Current parser uses CFunction for methods. Test reflects this.
        const fixturePath = path.join(fixtureDir, 'src/shapes/Circle.cpp');
        const result = await parseFixture(fixturePath);
        const methodNodes = result.nodes.filter(n => n.kind === 'CFunction'); // Expecting CFunction for now

        expect(methodNodes.length).toBeGreaterThanOrEqual(7); // Constructor, area, perimeter, getName, getDescription, getRadius, setRadius, getDiameter, validateRadius

        const areaMethod = methodNodes.find(n => n.name === 'Circle::area');
        expect(areaMethod).toBeDefined();
        expect(areaMethod?.startLine).toBe(20);

        const constructorMethod = methodNodes.find(n => n.name === 'Circle::Circle');
        expect(constructorMethod).toBeDefined();
        expect(constructorMethod?.startLine).toBe(10);
    });

    // Add more tests for other files, classes, relationships as parser evolves
});
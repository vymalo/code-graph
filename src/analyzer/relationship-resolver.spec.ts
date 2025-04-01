import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { Project } from 'ts-morph'; // Import ts-morph Project
import { RelationshipResolver } from './relationship-resolver.js'; // Adjust path
import { AstNode, RelationshipInfo, SingleFileParseResult } from './types.js'; // Adjust path
import { generateEntityId, generateInstanceId } from './parser-utils.js'; // Adjust path
import config from '../config/index.js'; // Adjust path
import { createContextLogger } from '../utils/logger.js'; // Import logger

const testLogger = createContextLogger('RelationshipResolverSpec'); // Create a logger for the test

// Mock data representing parsed results from multiple files
const mockNodes: AstNode[] = [];
const mockRelationshipsPass1: RelationshipInfo[] = [];
const instanceCounter = { count: 0 };
const now = new Date().toISOString();

// --- File A (src/a.ts) ---
const fileAPath = 'src/a.ts'; // Use relative-like path for mock data consistency
const fileAAbsolutePath = '/' + fileAPath; // Path used by ts-morph in-memory
const fileAContent = `
import { funcB } from './b';
export function funcA() {
    funcB(); // Call imported function
}
`;
const fileAEntityId = generateEntityId('file', fileAAbsolutePath); // Use absolute-like path
const fileANode: AstNode = {
    id: generateInstanceId(instanceCounter, 'file', 'a.ts'),
    entityId: fileAEntityId, kind: 'File', name: 'a.ts', filePath: fileAAbsolutePath, // Use absolute-like path
    startLine: 1, endLine: 5, startColumn: 0, endColumn: 0, language: 'TypeScript', createdAt: now,
};
// Entity ID generation for import (assuming it uses line number)
const importBEntityId = generateEntityId('importdeclaration', `${fileAAbsolutePath}:./b:2`); // Line 2 in content
const importBNode: AstNode = { // Simplified ImportDeclaration node
    id: generateInstanceId(instanceCounter, 'import', './b', { line: 2, column: 0 }),
    entityId: importBEntityId, kind: 'ImportDeclaration', name: './b',
    filePath: fileAAbsolutePath, language: 'TypeScript', startLine: 2, endLine: 2, startColumn: 0, endColumn: 25, createdAt: now,
    properties: { importPath: './b', importedNames: ['funcB'] } // Assume funcB is imported
};
// Corrected Entity ID generation for function (Use 'function' kind, NO line number)
const funcAEntityId = generateEntityId('function', `${fileAAbsolutePath}:funcA`);
const funcANode: AstNode = {
    id: generateInstanceId(instanceCounter, 'tsfunction', 'funcA', { line: 3, column: 0 }), // Instance ID can keep 'tsfunction'
    entityId: funcAEntityId, kind: 'TSFunction', name: 'funcA', // Keep original kind for node data
    filePath: fileAAbsolutePath, language: 'TypeScript', startLine: 3, endLine: 5, startColumn: 0, endColumn: 1, createdAt: now,
};
mockNodes.push(fileANode, importBNode, funcANode);
// Relationship: File A IMPORTS ImportDeclaration B
const importRelEntityId = generateEntityId('ts_imports', `${fileAEntityId}:${importBEntityId}`);
mockRelationshipsPass1.push({
    id: generateInstanceId(instanceCounter, 'ts_imports', `${fileANode.id}:${importBNode.id}`),
    entityId: importRelEntityId, type: 'TS_IMPORTS', sourceId: fileAEntityId, targetId: importBEntityId, createdAt: now, weight: 5
});
// Relationship: funcA CALLS funcB (initially unresolved target)
// Corrected Entity ID generation for call relationship (Use 'function' kind, NO line number in source entity ID)
const callRelEntityId = generateEntityId('calls', `${funcAEntityId}:funcB:4`); // Line 4 for call site info
mockRelationshipsPass1.push({
    id: generateInstanceId(instanceCounter, 'calls', `${funcANode.id}:funcB:4`),
    entityId: callRelEntityId, type: 'CALLS', sourceId: funcAEntityId, targetId: 'unresolved:funcB', // Mark as unresolved
    properties: { callName: 'funcB', line: 4 }, createdAt: now, weight: 6
});


// --- File B (src/b.ts) ---
const fileBPath = 'src/b.ts'; // Use relative-like path
const fileBAbsolutePath = '/' + fileBPath; // Path used by ts-morph in-memory
const fileBContent = `
export function funcB() {
    console.log("funcB called");
}
`;
const fileBEntityId = generateEntityId('file', fileBAbsolutePath); // Use absolute-like path
const fileBNode: AstNode = {
    id: generateInstanceId(instanceCounter, 'file', 'b.ts'),
    entityId: fileBEntityId, kind: 'File', name: 'b.ts', filePath: fileBAbsolutePath, // Use absolute-like path
    startLine: 1, endLine: 4, startColumn: 0, endColumn: 0, language: 'TypeScript', createdAt: now,
};
// Corrected Entity ID generation for function (Use 'function' kind, NO line number)
const funcBEntityId = generateEntityId('function', `${fileBAbsolutePath}:funcB`);
const funcBNode: AstNode = {
    id: generateInstanceId(instanceCounter, 'tsfunction', 'funcB', { line: 2, column: 0 }), // Instance ID can keep 'tsfunction'
    entityId: funcBEntityId, kind: 'TSFunction', name: 'funcB', // Keep original kind for node data
    filePath: fileBAbsolutePath, language: 'TypeScript', startLine: 2, endLine: 4, startColumn: 0, endColumn: 1, createdAt: now,
    properties: { isExported: true } // Mark as exported
};
mockNodes.push(fileBNode, funcBNode);
// Relationship: File B DEFINES_FUNCTION funcB
const definesRelEntityId = generateEntityId('defines_function', `${fileBEntityId}:${funcBEntityId}`);
mockRelationshipsPass1.push({
    id: generateInstanceId(instanceCounter, 'defines_function', `${fileBNode.id}:${funcBNode.id}`),
    entityId: definesRelEntityId, type: 'DEFINES_FUNCTION', sourceId: fileBEntityId, targetId: funcBEntityId, createdAt: now, weight: 8
});


describe('RelationshipResolver Unit Tests', () => {

    let resolver: RelationshipResolver;
    let project: Project;

    beforeAll(() => {
        // Instantiate the resolver with mock data
        resolver = new RelationshipResolver(mockNodes, mockRelationshipsPass1);

        // --- DEBUG LOG ---
        testLogger.debug('Mock Node Index Keys (Entity IDs):');
        mockNodes.forEach(node => testLogger.debug(`  - ${node.entityId} (${node.kind} ${node.name})`));
        // --- END DEBUG LOG ---


        // Create a ts-morph project and add mock files
        // Use absolute-like paths for ts-morph in-memory system
        project = new Project({ useInMemoryFileSystem: true });
        project.createSourceFile(fileAAbsolutePath, fileAContent); // Use absolute-like path
        project.createSourceFile(fileBAbsolutePath, fileBContent); // Use absolute-like path
    });

    it('should resolve TS import relationships', async () => {
        const pass2Relationships = await resolver.resolveRelationships(project); // Pass the project
        const resolvedImportRel = pass2Relationships.find(r =>
            r.type === 'RESOLVES_IMPORT' && // Check for RESOLVES_IMPORT now
            r.sourceId === importBEntityId && // Source is the ImportDeclaration node
            r.targetId === funcBEntityId // Target should now be the actual function node
        );

        expect(resolvedImportRel).toBeDefined();
        // expect(resolvedImportRel?.properties?.resolved).toBe(true); // RESOLVES_IMPORT doesn't have 'resolved' property
    });

    it('should resolve TS cross-file call relationships', async () => {
        const pass2Relationships = await resolver.resolveRelationships(project); // Pass the project
        const resolvedCallRel = pass2Relationships.find(r =>
            r.type === 'CALLS' &&
            r.sourceId === funcAEntityId &&
            r.targetId === funcBEntityId // Target should now be the actual function node
        );

        expect(resolvedCallRel).toBeDefined();
         expect(resolvedCallRel?.properties?.isPlaceholder).toBe(false); // Check if placeholder is false
    });

    // Add more tests:
    // - Unresolved imports/calls
    // - Calls within the same file (should already be resolved in pass 1 ideally)
    // - Inheritance resolution (EXTENDS)
    // - Interface implementation resolution (IMPLEMENTS)
    // - Tests for other languages once resolver supports them
});
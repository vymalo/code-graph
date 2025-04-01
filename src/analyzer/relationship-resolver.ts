import { Project, SourceFile, Node } from 'ts-morph'; // Keep SourceFile for TS resolvers
import { AstNode, RelationshipInfo, ResolverContext } from './types.js';
import { generateEntityId, generateInstanceId, resolveImportPath } from './parser-utils.js';
import { createContextLogger } from '../utils/logger.js';
// Import new resolver functions
import { resolveTsModules, resolveTsInheritance, resolveTsCrossFileInteractions, resolveTsComponentUsage } from './resolvers/ts-resolver.js';
import { resolveCIncludes } from './resolvers/c-cpp-resolver.js';

const logger = createContextLogger('RelationshipResolver');

/**
 * Resolves cross-file and deferred relationships (Pass 2).
 * Delegates resolution logic to language-specific handlers.
 */
export class RelationshipResolver {
    private nodeIndex: Map<string, AstNode>; // Map entityId -> AstNode
    private relationships: RelationshipInfo[];
    private pass1RelationshipIds: Set<string>; // Store entityIds of relationships found in Pass 1
    private context: ResolverContext | null = null; // Context for Pass 2 operations

    constructor(allNodes: AstNode[], pass1Relationships: RelationshipInfo[]) {
        this.nodeIndex = new Map(allNodes.map(node => [node.entityId, node]));
        this.relationships = [];
        this.pass1RelationshipIds = new Set(pass1Relationships.map(rel => rel.entityId));
        logger.info(`RelationshipResolver initialized with ${this.nodeIndex.size} nodes and ${this.pass1RelationshipIds.size} Pass 1 relationship IDs.`);
    }

    /**
     * Resolves relationships using the ts-morph project (for TS/JS) and collected node data.
     * @param project - The ts-morph Project containing parsed TS/JS source files.
     * @returns An array of resolved RelationshipInfo objects.
     */
    async resolveRelationships(project: Project): Promise<RelationshipInfo[]> {
        this.relationships = []; // Reset relationships array for this run
        const now = new Date().toISOString();
        let instanceCounter = { count: 0 }; // Simple counter for Pass 2 instance IDs
        const addedRelEntityIds = new Set<string>(); // Track relationships added in THIS pass

        this.context = {
            nodeIndex: this.nodeIndex,
            addRelationship: (rel) => {
                if (!addedRelEntityIds.has(rel.entityId)) {
                    this.relationships.push(rel);
                    addedRelEntityIds.add(rel.entityId);
                }
            },
            generateId: (prefix, identifier, options) => generateInstanceId(instanceCounter, prefix, identifier, options),
            generateEntityId: generateEntityId,
            logger: logger,
            resolveImportPath: resolveImportPath,
            now: now,
        };

        logger.info('Starting Pass 2 relationship resolution...');

        // Iterate through all files represented by nodes from Pass 1
        const fileNodes = Array.from(this.nodeIndex.values()).filter(node => node.kind === 'File' || node.kind === 'PythonModule'); // Include PythonModule

        for (const fileNode of fileNodes) {
            logger.debug(`Resolving relationships for file: ${fileNode.name} (${fileNode.language})`);
            const currentContext = this.context!;
            let sourceFile: SourceFile | undefined;

            // Resolve TS/JS specific relationships using ts-morph SourceFile
            if (fileNode.language === 'TypeScript' || fileNode.language === 'JavaScript') {
                sourceFile = project.getSourceFile(fileNode.filePath);
                if (sourceFile) {
                    resolveTsModules(sourceFile, fileNode, currentContext);
                    resolveTsInheritance(sourceFile, fileNode, currentContext);
                    resolveTsCrossFileInteractions(sourceFile, fileNode, currentContext);
                    resolveTsComponentUsage(sourceFile, fileNode, currentContext);
                } else {
                     logger.warn(`Could not find ts-morph SourceFile for: ${fileNode.filePath}. Skipping TS/JS Pass 2 resolution.`);
                }
            }

            // Resolve C/C++ Includes (placeholder resolution)
            // Note: sourceFile is passed for consistency but not used for C/C++ AST access here
            if (fileNode.language === 'C' || fileNode.language === 'C++') {
                 // We need a way to get the ts-morph SourceFile even for C/C++ if we want to use it
                 // For now, pass undefined or handle differently if ts-morph isn't used for C/C++ resolution
                 const cSourceFile = project.getSourceFile(fileNode.filePath); // Attempt to get it anyway
                 if (cSourceFile) {
                    resolveCIncludes(cSourceFile, fileNode, currentContext);
                 } else {
                     logger.warn(`Could not find ts-morph SourceFile for C/C++ file: ${fileNode.filePath}. Skipping include resolution.`);
                 }
            }

            // TODO: Add calls to language-specific resolvers for Python, Java, Go, C#, SQL etc.
            // These would likely NOT use the ts-morph `sourceFile` object but operate on `fileNode` and `nodeIndex`.
            // Example:
            // if (fileNode.language === 'Python') {
            //     resolvePythonImports(fileNode, currentContext);
            //     resolvePythonCalls(fileNode, currentContext);
            // }
        }

        logger.info(`Pass 2 resolution finished. Found ${this.relationships.length} relationships.`);
        this.context = null;
        return this.relationships;
    }

    // --- Helper Methods --- (Only keep essential ones if needed by the class itself)

    private findNodeByFilePath(filePath: string): AstNode | undefined {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const fileEntityId = generateEntityId('file', normalizedPath);
        // Also check for PythonModule kind if the path matches
        return this.nodeIndex.get(fileEntityId) ?? this.nodeIndex.get(generateEntityId('pythonmodule', normalizedPath));
    }

    // Removed resolveModules, resolveInheritance, resolveCrossFileInteractions,
    // analyzeBodyInteractions, resolveComponentUsage, resolveCIncludes
    // Removed isInsideConditionalContext (moved to ts-resolver.ts)
}
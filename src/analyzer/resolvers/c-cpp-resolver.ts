// src/analyzer/resolvers/c-cpp-resolver.ts
import { SourceFile } from 'ts-morph'; // Keep for consistency, though not used directly for C++ AST
import { AstNode, RelationshipInfo, ResolverContext, IncludeDirectiveNode } from '../types.js';
import { generateEntityId, generateInstanceId } from '../parser-utils.js';

/**
 * Resolves INCLUDES relationships for C/C++ files.
 * Note: Actual path resolution for includes is complex and not fully implemented here.
 * This creates relationships based on the path string found.
 */
export function resolveCIncludes(sourceFile: SourceFile, fileNode: AstNode, context: ResolverContext): void {
    // Only process C/C++ files (double check, though called conditionally)
    if (fileNode.language !== 'C' && fileNode.language !== 'C++') {
        return;
    }

    const { addRelationship, generateId, generateEntityId, logger, now, nodeIndex } = context;

    // Find IncludeDirective nodes created in Pass 1 for this file
    const includeDirectives = Array.from(nodeIndex.values()).filter(
        node => node.kind === 'IncludeDirective' && node.filePath === fileNode.filePath
    ) as IncludeDirectiveNode[]; // Type assertion

    logger.debug(`[resolveCIncludes] Found ${includeDirectives.length} include directives in ${fileNode.name}`);

    for (const directiveNode of includeDirectives) {
        const includePath = directiveNode.properties?.includePath;
        const isSystem = directiveNode.properties?.isSystemInclude;

        if (!includePath) {
            logger.warn(`[resolveCIncludes] Include directive node missing includePath property: ${directiveNode.entityId}`);
            continue;
        }

        // --- Basic Path Resolution Placeholder ---
        // TODO: Implement proper C/C++ include path resolution logic (search paths, etc.)
        // For now, we'll just create a placeholder target entity ID based on the path string.
        // We won't try to find the actual file node in the index yet.
        const targetFileEntityId = generateEntityId('file', includePath); // Placeholder based on path string
        const isPlaceholder = true; // Mark as placeholder until resolution is implemented
        // --- End Placeholder ---

        const relEntityId = generateEntityId('includes', `${fileNode.entityId}:${targetFileEntityId}`);
        addRelationship({
            id: generateId('includes', `${fileNode.id}:${includePath}`),
            entityId: relEntityId,
            type: 'INCLUDES',
            sourceId: fileNode.entityId, // Source is the file containing the #include
            targetId: targetFileEntityId, // Target is the (placeholder) included file
            weight: 4,
            properties: {
                includePath: includePath,
                isSystemInclude: isSystem,
                isPlaceholder: isPlaceholder,
            },
            createdAt: now,
        });
        logger.debug(`[resolveCIncludes] Added INCLUDES relationship: ${fileNode.name} -> ${includePath} (Placeholder: ${isPlaceholder})`);
    }
}

// Add other C/C++ specific resolution functions here later (e.g., resolveCalls)
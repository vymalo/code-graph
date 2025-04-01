// src/analyzer/resolvers/ts-resolver.ts
import { SourceFile, Node, SyntaxKind as SK, BinaryExpression, ClassDeclaration, InterfaceDeclaration, CallExpression, TryStatement, JsxElement, JsxSelfClosingElement, ImportDeclaration, NamedImports } from 'ts-morph'; // Corrected NamedImports
import { AstNode, RelationshipInfo, ResolverContext, ComponentNode } from '../types.js'; // Corrected import path
import { getTargetDeclarationInfo } from '../analysis/analyzer-utils.js';
import { generateEntityId } from '../parser-utils.js'; // Only need generateEntityId here potentially
import winston from 'winston'; // Import Logger type

// Helper function moved from relationship-resolver.ts
function isInsideConditionalContext(node: Node, boundaryNode: Node): boolean {
    let current: Node | undefined = node.getParent();
    while (current && current !== boundaryNode) {
        const kind = current.getKind();
        if (
            kind === SK.IfStatement || kind === SK.SwitchStatement || kind === SK.ConditionalExpression ||
            kind === SK.ForStatement || kind === SK.ForInStatement || kind === SK.ForOfStatement ||
            kind === SK.WhileStatement || kind === SK.DoStatement
        ) {
            return true;
        }
        current = current.getParent();
    }
    return false;
}

// Helper function moved and adapted from relationship-resolver.ts
// Corrected to handle simple absolute-like paths used in tests
function findNodeByFilePath(filePath: string, context: ResolverContext): AstNode | undefined {
    const normalizedPath = filePath.replace(/\\/g, '/');
    // Use the normalized path directly if it looks like a simple absolute path (for tests)
    // Otherwise, assume it needs full resolution for generateEntityId
    const identifierForEntityId = normalizedPath.startsWith('/') ? normalizedPath : filePath;
    const fileEntityId = context.generateEntityId('file', identifierForEntityId);
    // Also check for PythonModule kind if the path matches
    return context.nodeIndex.get(fileEntityId) ?? context.nodeIndex.get(context.generateEntityId('pythonmodule', identifierForEntityId));
}


/**
 * Resolves IMPORTS and EXPORTS relationships for a TS/JS file.
 * Also adds RESOLVES_IMPORT relationships between ImportDeclaration nodes and their targets.
 */
export function resolveTsModules(sourceFile: SourceFile, fileNode: AstNode, context: ResolverContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now, nodeIndex, resolveImportPath } = context;

    // --- Imports ---
    const importDeclarations = sourceFile.getImportDeclarations();
    for (const impDecl of importDeclarations) {
        const moduleSpecifier = impDecl.getModuleSpecifierValue();
        if (!moduleSpecifier) continue;

        // Use ts-morph's resolution which should handle in-memory paths correctly
        const resolvedSourceFile = impDecl.getModuleSpecifierSourceFile();
        const resolvedImportPath = resolvedSourceFile?.getFilePath() ?? resolveImportPath(fileNode.filePath, moduleSpecifier); // Fallback if ts-morph fails

        let targetFileNode = findNodeByFilePath(resolvedImportPath, context); // Use corrected helper
        let targetFileEntityId: string;
        let isTargetPlaceholder = false;

        if (targetFileNode) {
            targetFileEntityId = targetFileNode.entityId;
        } else {
            // Use the resolved path directly for placeholder generation
            targetFileEntityId = generateEntityId('file', resolvedImportPath);
            isTargetPlaceholder = true;
            logger.debug(`[resolveTsModules] Target file node not found for import '${moduleSpecifier}' in ${fileNode.filePath}. Resolved path: ${resolvedImportPath}. Creating placeholder target: ${targetFileEntityId}`);
        }

        const isTypeOnly = impDecl.isTypeOnly();
        const namedImports = impDecl.getNamedImports(); // Keep original ts-morph nodes
        const defaultImportName = impDecl.getDefaultImport()?.getText();
        const namespaceImportName = impDecl.getNamespaceImport()?.getText();

        const importedSymbolsForRel = [...namedImports.map(ni => ni.getAliasNode()?.getText() ?? ni.getName())];
        if (defaultImportName) importedSymbolsForRel.push(defaultImportName);
        if (namespaceImportName) importedSymbolsForRel.push(namespaceImportName);


        // 1. Create IMPORTS relationship (File -> File)
        const importRelEntityId = generateEntityId('imports', `${fileNode.entityId}:${targetFileEntityId}`);
        addRelationship({
            id: generateId('imports', `${fileNode.id}:${moduleSpecifier}`),
            entityId: importRelEntityId, type: 'IMPORTS', sourceId: fileNode.entityId, targetId: targetFileEntityId, weight: 5,
            properties: {
                moduleSpecifier, resolvedPath: resolvedImportPath, isPlaceholder: isTargetPlaceholder,
                isDynamicImport: false, isTypeOnly: isTypeOnly,
                importedSymbols: importedSymbolsForRel.length > 0 ? importedSymbolsForRel : undefined,
            }, createdAt: now,
        });

        // 2. Create RESOLVES_IMPORT relationship (ImportDeclaration Node -> Target Node)
        // Find the corresponding ImportDeclaration AstNode from Pass 1
        const impDeclStartLine = impDecl.getStartLineNumber();
        const impDeclStartCol = impDecl.getStart() - impDecl.getStartLinePos();
        // Use generateEntityId consistent with how it was created in the test
        // Use 'import' kind to match the kind used in import-parser.ts
        const importAstNodeEntityId = generateEntityId('import', `${fileNode.filePath}:${moduleSpecifier}:${impDeclStartLine}`);
        const importAstNode = nodeIndex.get(importAstNodeEntityId);


        if (!importAstNode) {
            logger.warn(`[resolveTsModules] Could not find matching ImportDeclaration AstNode for import '${moduleSpecifier}' at L${impDeclStartLine} in ${fileNode.filePath} (EntityId: ${importAstNodeEntityId})`);
            continue; // Skip RESOLVES_IMPORT if we can't find the source node
        }

        if (targetFileNode) { // Only resolve specific symbols if target file exists in index
            // Resolve named imports
            for (const namedImport of namedImports) { // Iterate original ts-morph nodes
                const importName = namedImport.getName();
                const importAlias = namedImport.getAliasNode()?.getText();
                // const importLine = namedImport.getNameNode().getStartLineNumber(); // Line number not needed/reliable for target lookup

                // Find the exported node in the target file
                let targetNode: AstNode | undefined;
                let targetEntityId: string | undefined;

                // Try finding function first using the simplified ID format
                targetEntityId = generateEntityId('function', `${targetFileNode.filePath}:${importName}`);
                targetNode = nodeIndex.get(targetEntityId);

                // If not found as function, try other common exportable kinds
                if (!targetNode) {
                    targetEntityId = generateEntityId('class', `${targetFileNode.filePath}:${importName}`);
                    targetNode = nodeIndex.get(targetEntityId);
                }
                if (!targetNode) {
                    targetEntityId = generateEntityId('interface', `${targetFileNode.filePath}:${importName}`);
                    targetNode = nodeIndex.get(targetEntityId);
                }
                 if (!targetNode) {
                    // Try variable (also likely without line number for lookup)
                    targetEntityId = generateEntityId('variable', `${targetFileNode.filePath}:${importName}`);
                    targetNode = nodeIndex.get(targetEntityId);
                }
                // Add more kinds if necessary (enum, typealias)


                if (targetNode && (targetNode.properties?.isExported || targetNode.properties?.isDefaultExport)) {
                    const resolvesRelEntityId = generateEntityId('resolves_import', `${importAstNode.entityId}:${targetNode.entityId}`);
                    addRelationship({
                        id: generateId('resolves_import', `${importAstNode.id}:${targetNode.id}`),
                        entityId: resolvesRelEntityId, type: 'RESOLVES_IMPORT',
                        sourceId: importAstNode.entityId, targetId: targetNode.entityId,
                        weight: 8, properties: { importedSymbol: importAlias ?? importName, targetSymbol: importName }, createdAt: now,
                    });
                } else {
                     logger.debug(`[resolveTsModules] Could not find exported node '${importName}' (Tried EntityId: ${targetEntityId}) in target file ${targetFileNode.filePath} for import in ${fileNode.filePath}`);
                }
            }
            // Resolve default import
            if (defaultImportName) {
                 // Cast n to AstNode
                 const targetNode = Array.from(nodeIndex.values()).find(n =>
                    (n as AstNode).filePath === targetFileNode!.filePath &&
                    (n as AstNode).properties?.isDefaultExport === true // Find the default export
                ) as AstNode | undefined; // Add type assertion

                 if (targetNode) { // Check if targetNode is found
                    const resolvesRelEntityId = generateEntityId('resolves_import', `${importAstNode.entityId}:${targetNode.entityId}:default`);
                    addRelationship({
                        id: generateId('resolves_import', `${importAstNode.id}:${targetNode.id}:default`),
                        entityId: resolvesRelEntityId, type: 'RESOLVES_IMPORT',
                        sourceId: importAstNode.entityId, targetId: targetNode.entityId,
                        weight: 8, properties: { importedSymbol: defaultImportName, isDefaultImport: true }, createdAt: now,
                    });
                } else {
                     logger.debug(`[resolveTsModules] Could not find default export in target file ${targetFileNode.filePath} for import in ${fileNode.filePath}`);
                }
            }
            // Resolve namespace import (links to the target file node)
            if (namespaceImportName) {
                 const resolvesRelEntityId = generateEntityId('resolves_import', `${importAstNode.entityId}:${targetFileNode.entityId}:namespace`);
                 addRelationship({
                     id: generateId('resolves_import', `${importAstNode.id}:${targetFileNode.id}:namespace`),
                     entityId: resolvesRelEntityId, type: 'RESOLVES_IMPORT',
                     sourceId: importAstNode.entityId, targetId: targetFileNode.entityId, // Namespace import resolves to the file/module itself
                     weight: 8, properties: { importedSymbol: namespaceImportName, isNamespaceImport: true }, createdAt: now,
                 });
            }
        }
    }

    // --- Exports --- (Keep existing logic, might need refinement later)
    const exportDeclarations = sourceFile.getExportDeclarations();
    const exportAssignments = sourceFile.getExportAssignments();

    for (const expDecl of exportDeclarations) {
        const moduleSpecifier = expDecl.getModuleSpecifierValue();
        const namedExports = expDecl.getNamedExports();

        if (moduleSpecifier) { // Re-export
            const resolvedExportPath = resolveImportPath(fileNode.filePath, moduleSpecifier);
            const targetFileNode = findNodeByFilePath(resolvedExportPath, context); // Use helper
            if (targetFileNode) {
                 const relEntityId = generateEntityId('exports', `${fileNode.entityId}:${targetFileNode.entityId}:reexport`);
                 addRelationship({
                     id: generateId('exports', `${fileNode.id}:${targetFileNode.id}:reexport`),
                     entityId: relEntityId, type: 'EXPORTS', sourceId: fileNode.entityId, targetId: targetFileNode.entityId, weight: 4,
                     properties: { isReExport: true, reExportedSpecifiers: namedExports.map(ne => ne.getName()), sourceModuleSpecifier: moduleSpecifier }, createdAt: now,
                 });
            }
        } else { // Export local names
            for (const namedExport of namedExports) {
                const symbol = namedExport.getSymbol();
                const localDeclaration = symbol?.getValueDeclaration();
                if (localDeclaration) {
                    const targetInfo = getTargetDeclarationInfo(localDeclaration, fileNode.filePath, context.resolveImportPath, context.logger);
                    if (targetInfo && nodeIndex.has(targetInfo.entityId)) {
                        const targetNode = nodeIndex.get(targetInfo.entityId)!;
                        const relEntityId = generateEntityId('exports', `${fileNode.entityId}:${targetNode.entityId}`);
                        addRelationship({
                            id: generateId('exports', `${fileNode.id}:${targetNode.name}`),
                            entityId: relEntityId, type: 'EXPORTS', sourceId: fileNode.entityId, targetId: targetNode.entityId,
                            weight: 8, properties: { exportedName: namedExport.getName() }, createdAt: now,
                        });
                    }
                }
            }
        }
    }

    for (const expAssign of exportAssignments) {
         const expression = expAssign.getExpression();
         const targetInfo = getTargetDeclarationInfo(expression, fileNode.filePath, context.resolveImportPath, context.logger);
         if (targetInfo && nodeIndex.has(targetInfo.entityId)) {
             const targetNode = nodeIndex.get(targetInfo.entityId)!;
             const relEntityId = generateEntityId('exports', `${fileNode.entityId}:${targetNode.entityId}:default`);
             addRelationship({
                 id: generateId('exports', `${fileNode.id}:default`),
                 entityId: relEntityId, type: 'EXPORTS', sourceId: fileNode.entityId, targetId: targetNode.entityId,
                 weight: 8, properties: { isDefaultExport: true }, createdAt: now,
             });
         }
    }

     // Direct exports are handled within the main RelationshipResolver loop for now, as it iterates all nodes.
     // Could be moved here if needed, but requires passing the full nodeIndex or iterating it again.
}

/**
 * Resolves EXTENDS and IMPLEMENTS relationships for TS/JS.
 */
export function resolveTsInheritance(sourceFile: SourceFile, fileNode: AstNode, context: ResolverContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now, nodeIndex, resolveImportPath } = context;
    const classes = sourceFile.getClasses();
    const interfaces = sourceFile.getInterfaces();

    for (const declaration of classes) {
        const className = declaration.getName();
        if (!className) continue;
        // Use generateEntityId consistent with Pass 1 (filePath:name for classes/interfaces)
        const classEntityId = generateEntityId('class', `${fileNode.filePath}:${className}`);
        const classNode = nodeIndex.get(classEntityId);
        if (!classNode) {
             logger.warn(`[resolveTsInheritance] Could not find AstNode for class '${className}' in ${fileNode.filePath}`);
             continue;
        }


        const baseClassRef = declaration.getExtends();
        if (baseClassRef) {
            const targetInfo = getTargetDeclarationInfo(baseClassRef.getExpression(), fileNode.filePath, context.resolveImportPath, context.logger);
            if (targetInfo) {
                const targetNode = nodeIndex.get(targetInfo.entityId);
                const relEntityId = generateEntityId('extends', `${classNode.entityId}:${targetInfo.entityId}`);
                addRelationship({
                    id: generateId('extends', `${classNode.id}:${targetInfo.name}`),
                    entityId: relEntityId, type: 'EXTENDS', sourceId: classNode.entityId, targetId: targetInfo.entityId,
                    weight: 9, properties: { isPlaceholder: !targetNode, targetName: targetInfo.name, targetKind: targetInfo.kind }, createdAt: now,
                });
            }
        }

        const implInterfaces = declaration.getImplements();
        for (const impl of implInterfaces) {
             const targetInfo = getTargetDeclarationInfo(impl.getExpression(), fileNode.filePath, context.resolveImportPath, context.logger);
             if (targetInfo) {
                 const targetNode = nodeIndex.get(targetInfo.entityId);
                 const relEntityId = generateEntityId('implements', `${classNode.entityId}:${targetInfo.entityId}`);
                 addRelationship({
                     id: generateId('implements', `${classNode.id}:${targetInfo.name}`),
                     entityId: relEntityId, type: 'IMPLEMENTS', sourceId: classNode.entityId, targetId: targetInfo.entityId,
                     weight: 9, properties: { isPlaceholder: !targetNode, targetName: targetInfo.name, targetKind: targetInfo.kind }, createdAt: now,
                 });
             }
        }
    }

    for (const declaration of interfaces) {
         const interfaceName = declaration.getName();
         if (!interfaceName) continue;
         // Use generateEntityId consistent with Pass 1
         const interfaceEntityId = generateEntityId('interface', `${fileNode.filePath}:${interfaceName}`);
         const interfaceNode = nodeIndex.get(interfaceEntityId);
         if (!interfaceNode) {
              logger.warn(`[resolveTsInheritance] Could not find AstNode for interface '${interfaceName}' in ${fileNode.filePath}`);
              continue;
         }


         const baseInterfaces = declaration.getExtends();
         for (const baseRef of baseInterfaces) {
              const targetInfo = getTargetDeclarationInfo(baseRef.getExpression(), fileNode.filePath, context.resolveImportPath, context.logger);
              if (targetInfo) {
                  const targetNode = nodeIndex.get(targetInfo.entityId);
                  const relEntityId = generateEntityId('extends', `${interfaceNode.entityId}:${targetInfo.entityId}`);
                  addRelationship({
                      id: generateId('extends', `${interfaceNode.id}:${targetInfo.name}`),
                      entityId: relEntityId, type: 'EXTENDS', sourceId: interfaceNode.entityId, targetId: targetInfo.entityId,
                      weight: 9, properties: { isPlaceholder: !targetNode, targetName: targetInfo.name, targetKind: targetInfo.kind }, createdAt: now,
                  });
              }
         }
    }
}

/**
 * Resolves cross-file CALLS and MUTATES_STATE relationships for TS/JS.
 */
export function resolveTsCrossFileInteractions(sourceFile: SourceFile, fileNode: AstNode, context: ResolverContext): void {
     const { logger, nodeIndex } = context; // Destructure only what's needed directly

     const functions = sourceFile.getFunctions();
     for (const funcDecl of functions) {
         const body = funcDecl.getBody();
         if (!body) continue;
         const sourceTargetInfo = getTargetDeclarationInfo(funcDecl, fileNode.filePath, context.resolveImportPath, context.logger);
         // --- DEBUG LOG ---
         logger.debug(`[resolveTsCrossFileInteractions] Processing function: ${funcDecl.getName() ?? 'anonymous'}. Generated sourceTargetInfo: ${JSON.stringify(sourceTargetInfo)}`);
         // --- END DEBUG LOG ---
         const sourceNode = sourceTargetInfo ? nodeIndex.get(sourceTargetInfo.entityId) : undefined;
         if (sourceNode) {
             analyzeTsBodyInteractions(body, sourceNode, context);
         } else {
              logger.warn(`Could not find source node for function cross-file interaction analysis in ${fileNode.filePath} (EntityId: ${sourceTargetInfo?.entityId})`);
         }
     }

     const methods = sourceFile.getDescendantsOfKind(SK.MethodDeclaration);
     for (const methodDecl of methods) {
         const body = Node.isMethodDeclaration(methodDecl) ? methodDecl.getBody() : undefined;
         if (!body) continue;
         const sourceTargetInfo = getTargetDeclarationInfo(methodDecl, fileNode.filePath, context.resolveImportPath, context.logger);
         // --- DEBUG LOG ---
         // Use type guard before accessing getName
         const methodName = Node.isMethodDeclaration(methodDecl) ? methodDecl.getName() : 'anonymous';
         logger.debug(`[resolveTsCrossFileInteractions] Processing method: ${methodName}. Generated sourceTargetInfo: ${JSON.stringify(sourceTargetInfo)}`);
         // --- END DEBUG LOG ---
         const sourceNode = sourceTargetInfo ? nodeIndex.get(sourceTargetInfo.entityId) : undefined;
         if (sourceNode) {
             analyzeTsBodyInteractions(body, sourceNode, context);
         } else {
              logger.warn(`Could not find source node for method cross-file interaction analysis in ${fileNode.filePath} (EntityId: ${sourceTargetInfo?.entityId})`);
         }
     }
}

/**
 * Helper to analyze calls and assignments within a TS/JS function/method body for Pass 2.
 */
function analyzeTsBodyInteractions(body: Node, sourceNode: AstNode, context: ResolverContext): void {
     const { addRelationship, generateId, generateEntityId, logger, now, nodeIndex, resolveImportPath } = context;

     // Analyze Calls
     const callExpressions = body.getDescendantsOfKind(SK.CallExpression);
     if (callExpressions.length > 0) logger.debug(`[analyzeTsBodyInteractions] Found ${callExpressions.length} call expressions in ${sourceNode.name}`);
     for (const callExpr of callExpressions) {
         const expression = Node.isCallExpression(callExpr) ? callExpr.getExpression() : undefined;
         if (!expression) continue;
         const targetInfo = getTargetDeclarationInfo(expression, sourceNode.filePath, resolveImportPath, logger);

         if (targetInfo) {
             const targetNode = nodeIndex.get(targetInfo.entityId);
             const relEntityId = generateEntityId('calls', `${sourceNode.entityId}:${targetInfo.entityId}`);
             const callStartLine = callExpr.getStartLineNumber();
             const callColumn = callExpr.getStart() - callExpr.getStartLinePos();
             const isCrossFile = !!(targetNode && targetNode.filePath !== sourceNode.filePath);
             const isAwaited = !!callExpr.getParentIfKind(SK.AwaitExpression);
             const isConditional = isInsideConditionalContext(callExpr, body);

             const properties = {
                 callSiteLine: callStartLine, callSiteColumn: callColumn,
                 isAwaited: isAwaited, isConditional: isConditional, isCrossFile,
                 targetName: targetInfo.name, targetKind: targetInfo.kind,
                 isPlaceholder: !targetNode
             };
             addRelationship({
                 id: generateId('calls', `${sourceNode.id}:${targetInfo.entityId}`, { line: callStartLine, column: callColumn }),
                 entityId: relEntityId, type: 'CALLS', sourceId: sourceNode.entityId, targetId: targetInfo.entityId,
                 weight: isCrossFile ? 6 : 7, properties, createdAt: now,
             });
             if (!targetNode) {
                 logger.debug(`[Pass 2] Unresolved CALL target: ${expression.getText()} in ${sourceNode.name}`);
             }
         }
     }

     // Analyze Assignments (Mutations)
     const assignments = body.getDescendantsOfKind(SK.BinaryExpression).filter((expr): expr is BinaryExpression =>
         Node.isBinaryExpression(expr) && expr.getOperatorToken().getKind() === SK.EqualsToken
     );
     for (const assignment of assignments) {
          const leftHandSide = assignment.getLeft();
          const nodeToResolve = Node.isPropertyAccessExpression(leftHandSide) ? leftHandSide.getNameNode() : leftHandSide;
          const targetInfo = getTargetDeclarationInfo(nodeToResolve, sourceNode.filePath, resolveImportPath, logger);
          if (targetInfo) {
              const targetNode = nodeIndex.get(targetInfo.entityId);
              const relEntityId = generateEntityId('mutates_state', `${sourceNode.entityId}:${targetInfo.entityId}`);
              const assignStartLine = assignment.getStartLineNumber();
              const assignColumn = assignment.getStart() - assignment.getStartLinePos();
              const isCrossFile = !!(targetNode && targetNode.filePath !== sourceNode.filePath);
              const properties = {
                  startLine: assignStartLine, column: assignColumn, isCrossFile,
                  targetName: targetInfo.name, targetKind: targetInfo.kind,
                  isPlaceholder: !targetNode
              };
              addRelationship({
                 id: generateId('mutates_state', `${sourceNode.id}:${targetInfo.entityId}`, { line: assignStartLine, column: assignColumn }),
                 entityId: relEntityId, type: 'MUTATES_STATE', sourceId: sourceNode.entityId, targetId: targetInfo.entityId,
                 weight: 8, properties, createdAt: now,
             });
             if (!targetNode) {
                  logger.debug(`[Pass 2] Unresolved MUTATES_STATE target: ${leftHandSide.getText()} in ${sourceNode.name}`);
              }
          }
     }

     // Analyze Try/Catch (HANDLES_ERROR)
     const tryStatements = body.getDescendantsOfKind(SK.TryStatement);
     for (const tryStmt of tryStatements) {
         const catchClause = Node.isTryStatement(tryStmt) ? tryStmt.getCatchClause() : undefined;
         if (!catchClause) continue;

         const catchStartLine = catchClause.getStartLineNumber();
         const catchColumn = catchClause.getStart() - catchClause.getStartLinePos();
         const catchBinding = catchClause.getVariableDeclaration();
         let targetEntityId: string;
         let targetName: string;

         if (catchBinding) {
             targetName = catchBinding.getName() || 'errorParam';
             const paramQualifiedName = `${sourceNode.entityId}:catch:${targetName}:${catchStartLine}`;
             targetEntityId = generateEntityId('parameter', paramQualifiedName);
         } else {
             targetName = 'anonymousCatch';
             const handlerQualifiedName = `${sourceNode.entityId}:handler:${catchStartLine}`;
             targetEntityId = generateEntityId('error_handler', handlerQualifiedName);
         }

         const relEntityId = generateEntityId('handles_error', `${sourceNode.entityId}:${targetEntityId}`);
         const properties = { catchStartLine, catchColumn, targetName };

         addRelationship({
             id: generateId('handles_error', `${sourceNode.id}:${targetEntityId}`, { line: catchStartLine, column: catchColumn }),
             entityId: relEntityId, type: 'HANDLES_ERROR', sourceId: sourceNode.entityId, targetId: targetEntityId,
             weight: 5, properties, createdAt: now
         });
     }
}

/**
 * Resolves USES_COMPONENT relationships based on JSX element usage.
 */
export function resolveTsComponentUsage(sourceFile: SourceFile, fileNode: AstNode, context: ResolverContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now, nodeIndex, resolveImportPath } = context;
    const jsxElements = sourceFile.getDescendantsOfKind(SK.JsxElement);
    const jsxSelfClosingElements = sourceFile.getDescendantsOfKind(SK.JsxSelfClosingElement);
    const allJsxNodes = [...jsxElements, ...jsxSelfClosingElements];

    logger.debug(`[resolveTsComponentUsage] Found ${allJsxNodes.length} JSX nodes in ${fileNode.name}`);

    for (const jsxNode of allJsxNodes) {
        const isSelfClosing = Node.isJsxSelfClosingElement(jsxNode);
        const tagNameNode = isSelfClosing
            ? jsxNode.getTagNameNode()
            : (Node.isJsxElement(jsxNode) ? jsxNode.getOpeningElement().getTagNameNode() : undefined);

        if (!tagNameNode) continue;

        const tagName = tagNameNode.getText();

        if (tagName && /^[A-Z]/.test(tagName)) {
            logger.debug(`[resolveTsComponentUsage] Processing potential component usage: <${tagName}> in ${fileNode.name}`);
            const targetInfo = getTargetDeclarationInfo(tagNameNode, fileNode.filePath, resolveImportPath, logger);

            if (targetInfo) {
                const targetComponentNode = nodeIndex.get(targetInfo.entityId);
                if (targetComponentNode?.kind === 'Component') {
                    logger.debug(`[resolveTsComponentUsage] Resolved <${tagName}> to Component: ${targetInfo.name} (EntityId: ${targetInfo.entityId})`);
                    let sourceComponentNode: AstNode | undefined = undefined;
                    let currentAncestor: Node | undefined = jsxNode.getParent();
                    while (currentAncestor && !Node.isSourceFile(currentAncestor)) {
                        let declarationNodeForAncestor: Node | undefined = currentAncestor;
                        if (Node.isVariableDeclaration(currentAncestor)) {
                            const initializer = currentAncestor.getInitializer();
                            if (initializer && (Node.isFunctionLikeDeclaration(initializer) || Node.isClassDeclaration(initializer))) {
                                 declarationNodeForAncestor = initializer;
                            }
                        } else if (!Node.isFunctionLikeDeclaration(currentAncestor) && !Node.isClassDeclaration(currentAncestor)) {
                            currentAncestor = currentAncestor.getParent();
                            continue;
                        }

                        const ancestorTargetInfo = getTargetDeclarationInfo(declarationNodeForAncestor, fileNode.filePath, resolveImportPath, logger);
                        if (ancestorTargetInfo) {
                            const potentialSourceComponent = nodeIndex.get(ancestorTargetInfo.entityId);
                            if (potentialSourceComponent?.kind === 'Component') {
                                sourceComponentNode = potentialSourceComponent;
                                // Check if sourceComponentNode is defined before logging
                                if (sourceComponentNode) {
                                    logger.debug(`[resolveTsComponentUsage] Found parent component: ${sourceComponentNode.name} (EntityId: ${sourceComponentNode.entityId})`);
                                }
                                break;
                            }
                        }
                        if (Node.isBlock(currentAncestor) && !Node.isFunctionLikeDeclaration(currentAncestor.getParent()) && !Node.isClassDeclaration(currentAncestor.getParent())) {
                            break;
                        }
                        currentAncestor = currentAncestor.getParent();
                    }

                    if (sourceComponentNode) {
                        const relEntityId = generateEntityId('uses_component', `${sourceComponentNode.entityId}:${targetInfo.entityId}`);
                        // Check targetComponentNode exists before accessing filePath
                        const isCrossFile = targetComponentNode ? sourceComponentNode.filePath !== targetComponentNode.filePath : true; // Assume cross-file if target not found
                        addRelationship({
                            id: generateId('uses_component', `${sourceComponentNode.id}:${targetInfo.entityId}`, { line: jsxNode.getStartLineNumber(), column: jsxNode.getStart() - jsxNode.getStartLinePos() }),
                            entityId: relEntityId, type: 'USES_COMPONENT',
                            sourceId: sourceComponentNode.entityId, targetId: targetInfo.entityId,
                            weight: 7, properties: {
                                isCrossFile: isCrossFile, targetName: targetInfo.name,
                                isPlaceholder: !nodeIndex.has(targetInfo.entityId)
                            }, createdAt: now,
                        });
                        logger.debug(`[resolveTsComponentUsage] Added USES_COMPONENT relationship: ${sourceComponentNode.name} -> ${targetInfo.name}`);
                    } else {
                        logger.debug(`[resolveTsComponentUsage] Could not find parent component for <${tagName}> usage in ${fileNode.name}`);
                    }
                } else {
                     logger.debug(`[resolveTsComponentUsage] Resolved <${tagName}> tag, but target node is not a Component (Kind: ${targetComponentNode?.kind}) or not found.`);
                }
            } else {
                 logger.debug(`[resolveTsComponentUsage] Could not resolve declaration for component tag: <${tagName}> in ${fileNode.name}`);
            }
        }
    }
}
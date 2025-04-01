// src/analyzer/parsers/csharp-parser.ts
// @ts-ignore - Suppress type error due to potential module resolution/typing issues
import Parser from 'tree-sitter';
// @ts-ignore - Suppress type error for grammar module
import CSharp from 'tree-sitter-c-sharp';
import path from 'path';
import fs from 'fs/promises';
import { createContextLogger } from '../../utils/logger.js';
import { ParserError } from '../../utils/errors.js';
import { FileInfo } from '../../scanner/file-scanner.js';
import { AstNode, RelationshipInfo, SingleFileParseResult, InstanceCounter, NamespaceDeclarationNode, UsingDirectiveNode, CSharpClassNode, CSharpInterfaceNode, CSharpStructNode, CSharpMethodNode, PropertyNode, FieldNode } from '../types.js';
import { ensureTempDir, getTempFilePath, generateInstanceId, generateEntityId } from '../parser-utils.js';

const logger = createContextLogger('CSharpParser');

// Helper to get node text safely
function getNodeText(node: Parser.SyntaxNode | null | undefined): string {
    return node?.text ?? '';
}

// Helper to get location
function getNodeLocation(node: Parser.SyntaxNode): { startLine: number, endLine: number, startColumn: number, endColumn: number } {
    return {
        startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column, endColumn: node.endPosition.column,
    };
}

// --- Tree-sitter Visitor ---
class CSharpAstVisitor {
    public nodes: AstNode[] = [];
    public relationships: RelationshipInfo[] = [];
    private instanceCounter: InstanceCounter = { count: 0 };
    private fileNode: AstNode;
    private now: string = new Date().toISOString();
    private currentNamespace: string | null = null;
    private currentNamespaceId: string | null = null; // Store entityId of namespace
    private currentContainerId: string | null = null; // Class, Struct, Interface entityId

    constructor(private filepath: string) {
        const filename = path.basename(filepath);
        const fileEntityId = generateEntityId('file', filepath);
        this.fileNode = {
            id: generateInstanceId(this.instanceCounter, 'file', filename),
            entityId: fileEntityId, kind: 'File', name: filename, filePath: filepath,
            startLine: 1, endLine: 0, startColumn: 0, endColumn: 0,
            language: 'C#', createdAt: this.now,
        };
        this.nodes.push(this.fileNode);
    }

    // Corrected visit method: process node, then always recurse
    visit(node: Parser.SyntaxNode) {
        const originalNamespaceId = this.currentNamespaceId; // Backup context
        const originalContainerId = this.currentContainerId; // Backup context

        const stopRecursion = this.visitNode(node); // Process the current node first

        if (!stopRecursion) { // Only recurse if the handler didn't stop it
            for (const child of node.namedChildren) {
                this.visit(child);
            }
        }

        // Restore context if we are exiting the node where it was set
        if (this.currentNamespaceId !== originalNamespaceId && node.type === 'namespace_declaration') {
             this.currentNamespaceId = originalNamespaceId;
        }
         if (this.currentContainerId !== originalContainerId && ['class_declaration', 'interface_declaration', 'struct_declaration'].includes(node.type)) {
             this.currentContainerId = originalContainerId;
         }


        if (node.type === 'compilation_unit') { // Root node type for C#
             this.fileNode.endLine = node.endPosition.row + 1;
             this.fileNode.loc = this.fileNode.endLine;
        }
    }

    // Helper to decide if recursion should stop for certain node types
    private shouldStopRecursion(node: Parser.SyntaxNode): boolean {
        // Stop recursion after handling the entire import block here
        return node.type === 'using_directive'; // Using directives don't have relevant children to recurse into here
    }


    private visitNode(node: Parser.SyntaxNode): boolean { // Return boolean to indicate if recursion should stop
        try {
            switch (node.type) {
                case 'namespace_declaration':
                    this.visitNamespaceDeclaration(node);
                    return false; // Allow recursion
                case 'using_directive':
                    this.visitUsingDirective(node);
                    return true; // Stop recursion
                case 'class_declaration':
                    this.visitContainerDeclaration(node, 'CSharpClass');
                    return false; // Allow recursion
                case 'interface_declaration':
                     this.visitContainerDeclaration(node, 'CSharpInterface');
                     return false; // Allow recursion
                case 'struct_declaration':
                     this.visitContainerDeclaration(node, 'CSharpStruct');
                     return false; // Allow recursion
                case 'method_declaration':
                     this.visitMethodDeclaration(node);
                     return false; // Allow recursion
                case 'property_declaration':
                     this.visitPropertyDeclaration(node);
                     return false; // Allow recursion
                case 'field_declaration':
                     this.visitFieldDeclaration(node);
                     return false; // Allow recursion
                default:
                    return false; // Allow recursion for unhandled types
            }
        } catch (error: any) {
             logger.warn(`[CSharpAstVisitor] Error visiting node type ${node.type} in ${this.filepath}: ${error.message}`);
             return false; // Allow recursion even on error
        }
    }

    private visitNamespaceDeclaration(node: Parser.SyntaxNode) {
        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name');
        const name = getNodeText(nameNode);
        if (!name) return;

        this.currentNamespace = name;
        const entityId = generateEntityId('namespacedeclaration', `${this.filepath}:${name}`);
        this.currentNamespaceId = entityId;

        const nsNode: NamespaceDeclarationNode = {
            id: generateInstanceId(this.instanceCounter, 'namespace', name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'NamespaceDeclaration', name: name,
            filePath: this.filepath, language: 'C#', ...location, createdAt: this.now,
        };
        this.nodes.push(nsNode);

        const relEntityId = generateEntityId('declares_namespace', `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'declares_namespace', `${this.fileNode.id}:${nsNode.id}`),
            entityId: relEntityId, type: 'DECLARES_NAMESPACE',
            sourceId: this.fileNode.entityId, targetId: entityId,
            createdAt: this.now, weight: 9,
        });
    }

    private visitUsingDirective(node: Parser.SyntaxNode) {
        const location = getNodeLocation(node);
        const aliasNode = node.childForFieldName('alias');
        const alias = aliasNode ? getNodeText(aliasNode.childForFieldName('name')) : undefined;
        const isStatic = node.children.some((c: Parser.SyntaxNode) => c.type === 'static');

        // Find the first named child that is an identifier or qualified name
        const nameNode = node.namedChildren.find(c => c.type === 'identifier' || c.type === 'qualified_name');
        const namespaceOrType = getNodeText(nameNode);

        if (!namespaceOrType) {
             logger.warn(`[CSharpAstVisitor] Could not extract name for using_directive at ${this.filepath}:${location.startLine}`);
             return;
        }

        const entityId = generateEntityId('usingdirective', `${this.filepath}:${namespaceOrType}:${location.startLine}`);
        const usingNode: UsingDirectiveNode = {
            id: generateInstanceId(this.instanceCounter, 'using', namespaceOrType, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'UsingDirective', name: namespaceOrType,
            filePath: this.filepath, language: 'C#', ...location, createdAt: this.now,
            properties: { namespaceOrType, isStatic, alias }
        };
        this.nodes.push(usingNode);

        const relEntityId = generateEntityId('csharp_using', `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'csharp_using', `${this.fileNode.id}:${usingNode.id}`),
            entityId: relEntityId, type: 'CSHARP_USING',
            sourceId: this.fileNode.entityId, targetId: entityId,
            createdAt: this.now, weight: 5,
        });
    }

    private visitContainerDeclaration(node: Parser.SyntaxNode, kind: 'CSharpClass' | 'CSharpInterface' | 'CSharpStruct') {
        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name');
        const name = getNodeText(nameNode);
        if (!name) return;

        const qualifiedName = this.currentNamespace ? `${this.currentNamespace}.${name}` : name;
        const entityId = generateEntityId(kind.toLowerCase(), qualifiedName);

        const containerNode: AstNode = {
            id: generateInstanceId(this.instanceCounter, kind.toLowerCase(), name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: kind, name: name,
            filePath: this.filepath, language: 'C#', ...location, createdAt: this.now,
            properties: { qualifiedName },
            parentId: this.currentNamespaceId ?? undefined
        };
        this.nodes.push(containerNode);
        this.currentContainerId = entityId;

        const parentNodeId = this.currentNamespaceId ?? this.fileNode.entityId;
        const relType = kind === 'CSharpClass' ? 'DEFINES_CLASS' : (kind === 'CSharpInterface' ? 'DEFINES_INTERFACE' : 'DEFINES_STRUCT');
        const relEntityId = generateEntityId(relType.toLowerCase(), `${parentNodeId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, relType.toLowerCase(), `${parentNodeId}:${containerNode.id}`),
            entityId: relEntityId, type: relType,
            sourceId: parentNodeId, targetId: entityId,
            createdAt: this.now, weight: 9,
        });

        // TODO: Add relationships for base types
    }

     private visitMethodDeclaration(node: Parser.SyntaxNode) {
        if (!this.currentContainerId) return;

        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name');
        const name = getNodeText(nameNode);
        if (!name) return;

        const methodEntityId = generateEntityId('csharpmethod', `${this.currentContainerId}.${name}`);
        const methodNode: CSharpMethodNode = {
            id: generateInstanceId(this.instanceCounter, 'csharpmethod', name, { line: location.startLine, column: location.startColumn }),
            entityId: methodEntityId, kind: 'CSharpMethod', name: name,
            filePath: this.filepath, language: 'C#', ...location, createdAt: this.now,
            parentId: this.currentContainerId,
            // TODO: Extract parameters, return type, modifiers (public, static, async, etc.)
        };
        this.nodes.push(methodNode);

        // Relationship: Container -> HAS_METHOD -> Method
        const relEntityId = generateEntityId('has_method', `${this.currentContainerId}:${methodEntityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'has_method', `${this.currentContainerId}:${methodNode.id}`),
            entityId: relEntityId, type: 'HAS_METHOD',
            sourceId: this.currentContainerId, targetId: methodEntityId,
            createdAt: this.now, weight: 8,
        });
        // TODO: Visit parameters
        // TODO: Visit body for calls
    }

     private visitPropertyDeclaration(node: Parser.SyntaxNode) {
        if (!this.currentContainerId) return;

        // Reverting static check for now
        // const modifiersNode = node.children.find(c => c.type === 'modifiers');
        // const isStatic = modifiersNode?.children.some(m => m.type === 'modifier' && m.text === 'static') ?? false;
        // if (isStatic) {
        //     return;
        // }

        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name');
        const name = getNodeText(nameNode);
        if (!name) return;

        const propEntityId = generateEntityId('property', `${this.currentContainerId}.${name}`);
        const propNode: PropertyNode = {
            id: generateInstanceId(this.instanceCounter, 'property', name, { line: location.startLine, column: location.startColumn }),
            entityId: propEntityId, kind: 'Property', name: name,
            filePath: this.filepath, language: 'C#', ...location, createdAt: this.now,
            parentId: this.currentContainerId,
            // TODO: Extract type, modifiers, getter/setter info
        };
        this.nodes.push(propNode);

        // Relationship: Container -> HAS_PROPERTY -> Property
        const relEntityId = generateEntityId('has_property', `${this.currentContainerId}:${propEntityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'has_property', `${this.currentContainerId}:${propNode.id}`),
            entityId: relEntityId, type: 'HAS_PROPERTY',
            sourceId: this.currentContainerId, targetId: propEntityId,
            createdAt: this.now, weight: 7,
        });
    }

     private visitFieldDeclaration(node: Parser.SyntaxNode) {
        if (!this.currentContainerId) return;

        // Reverting static check for now
        // const modifiersNode = node.children.find(c => c.type === 'modifiers');
        // const isStatic = modifiersNode?.children.some(m => m.type === 'modifier' && m.text === 'static') ?? false;
        // if (isStatic) {
        //      return;
        // }

        const location = getNodeLocation(node);
        // Field declaration can have multiple variables (e.g., public int x, y;)
        const declarationNode = node.childForFieldName('declaration'); // Or similar based on grammar
        if (!declarationNode) return;

        for (const declarator of declarationNode.namedChildren) {
             if (declarator.type === 'variable_declarator') {
                 const nameNode = declarator.childForFieldName('name');
                 const name = getNodeText(nameNode);
                 if (!name) continue;

                 const fieldEntityId = generateEntityId('field', `${this.currentContainerId}.${name}`);
                 const fieldNode: FieldNode = {
                     id: generateInstanceId(this.instanceCounter, 'field', name, { line: location.startLine, column: location.startColumn }),
                     entityId: fieldEntityId, kind: 'Field', name: name,
                     filePath: this.filepath, language: 'C#', ...location, createdAt: this.now,
                     parentId: this.currentContainerId,
                     // TODO: Extract type, modifiers
                 };
                 this.nodes.push(fieldNode);

                 // Relationship: Container -> HAS_FIELD -> Field
                 const relEntityId = generateEntityId('has_field', `${this.currentContainerId}:${fieldEntityId}`);
                 this.relationships.push({
                     id: generateInstanceId(this.instanceCounter, 'has_field', `${this.currentContainerId}:${fieldNode.id}`),
                     entityId: relEntityId, type: 'HAS_FIELD',
                     sourceId: this.currentContainerId, targetId: fieldEntityId,
                     createdAt: this.now, weight: 7,
                 });
             }
        }
    }
}

/**
 * Parses C# files using Tree-sitter.
 */
export class CSharpParser {
    private parser: Parser;

    constructor() {
        this.parser = new Parser();
        this.parser.setLanguage(CSharp as any); // Cast to any to bypass type conflict
        logger.debug('C# Tree-sitter Parser initialized');
    }

    /**
     * Parses a single C# file.
     */
    async parseFile(file: FileInfo): Promise<string> {
        logger.info(`[CSharpParser] Starting C# parsing for: ${file.name}`);
        await ensureTempDir();
        const tempFilePath = getTempFilePath(file.path);
        const absoluteFilePath = path.resolve(file.path);
        const normalizedFilePath = absoluteFilePath.replace(/\\/g, '/');

        try {
            const fileContent = await fs.readFile(absoluteFilePath, 'utf-8');
            const tree = this.parser.parse(fileContent);
            const visitor = new CSharpAstVisitor(normalizedFilePath);
            visitor.visit(tree.rootNode);

            const result: SingleFileParseResult = {
                filePath: normalizedFilePath,
                nodes: visitor.nodes,
                relationships: visitor.relationships,
            };

            await fs.writeFile(tempFilePath, JSON.stringify(result, null, 2));
            logger.info(`[CSharpParser] Pass 1 completed for: ${file.name}. Nodes: ${result.nodes.length}, Rels: ${result.relationships.length}. Saved to ${path.basename(tempFilePath)}`);
            return tempFilePath;

        } catch (error: any) {
            logger.error(`[CSharpParser] Error during C# Pass 1 for ${file.path}`, {
                 errorMessage: error.message, stack: error.stack?.substring(0, 500)
            });
            try { await fs.unlink(tempFilePath); } catch { /* ignore */ }
            throw new ParserError(`Failed C# Pass 1 parsing for ${file.path}`, { originalError: error });
        }
    }
}
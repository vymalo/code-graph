// src/analyzer/parsers/c-cpp-parser.ts
// @ts-ignore - Suppress type error due to potential module resolution/typing issues
import Parser from 'tree-sitter';
// @ts-ignore - Suppress type error due to potential module resolution/typing issues
import C from 'tree-sitter-c';
// @ts-ignore - Suppress type error due to potential module resolution/typing issues
import Cpp from 'tree-sitter-cpp';
import path from 'path';
import fs from 'fs/promises';
import { createContextLogger } from '../../utils/logger.js'; // Adjusted path
import { ParserError } from '../../utils/errors.js'; // Adjusted path
import { FileInfo } from '../../scanner/file-scanner.js'; // Adjusted path
import { AstNode, RelationshipInfo, SingleFileParseResult, InstanceCounter, IncludeDirectiveNode, CFunctionNode, CppClassNode, CppMethodNode } from '../types.js'; // Added CppClassNode & CppMethodNode
import { ensureTempDir, getTempFilePath, generateInstanceId, generateEntityId } from '../parser-utils.js';

const logger = createContextLogger('CCppParser');

// Helper to get node text safely
function getNodeText(node: Parser.SyntaxNode | null | undefined): string {
    return node?.text ?? '';
}

// Helper to get location
function getNodeLocation(node: Parser.SyntaxNode): { startLine: number, endLine: number, startColumn: number, endColumn: number } {
    // Tree-sitter positions are 0-based, AstNode expects 1-based lines
    return {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column,
        endColumn: node.endPosition.column,
    };
}

// --- Tree-sitter Visitor ---
class CCppAstVisitor {
    public nodes: AstNode[] = [];
    public relationships: RelationshipInfo[] = [];
    private instanceCounter: InstanceCounter = { count: 0 };
    private fileNode: AstNode; // Represents the file being parsed
    private now: string = new Date().toISOString();
    private currentClassEntityId: string | undefined = undefined; // Track current class context (use undefined)

    constructor(private filepath: string, private language: 'C' | 'C++') {
        // Create the File node representation for this parse
        const filename = path.basename(filepath);
        const fileEntityId = generateEntityId('file', filepath); // Use 'file' kind for consistency
        this.fileNode = {
            id: generateInstanceId(this.instanceCounter, 'file', filename),
            entityId: fileEntityId,
            kind: 'File', // Use standard 'File' kind
            name: filename,
            filePath: filepath,
            startLine: 1, // File starts at 1
            endLine: 0, // Will be updated after parsing
            startColumn: 0,
            endColumn: 0,
            language: language,
            createdAt: this.now,
        };
        this.nodes.push(this.fileNode);
    }

    visit(node: Parser.SyntaxNode) {
        // Process the current node first
        this.visitNode(node); // Always process the node

        // Always recurse into children, let visitNode handle specific logic
        for (const child of node.namedChildren) {
            this.visit(child);
        }

        // Update file end line after visiting all nodes
        if (node.type === 'translation_unit') { // Root node type for C/C++
             this.fileNode.endLine = node.endPosition.row + 1;
             this.fileNode.loc = this.fileNode.endLine;
        }
    }

    // Returns true if the node type was handled and recursion should potentially stop, false otherwise
    private visitNode(node: Parser.SyntaxNode): boolean {
        try {
            switch (node.type) {
                case 'preproc_include':
                case 'preproc_def':
                    this.visitIncludeOrDefine(node);
                    return true; // Handled, stop recursion here
                case 'namespace_definition':
                     return false; // Allow recursion into namespace body
                case 'function_definition':
                    // Workaround for grammar issue: Check if it looks like a class/struct/namespace
                    const nodeText = node.text;
                    if (nodeText.startsWith('class ') || nodeText.startsWith('struct ')) {
                        // logger.warn(`[CCppAstVisitor] Treating misidentified function_definition at ${this.filepath}:${node.startPosition.row + 1} as class/struct.`);
                        this.visitClassSpecifier(node); // Try processing as class
                        return false; // Allow recursion
                    } else if (nodeText.startsWith('namespace ')) {
                         // logger.warn(`[CCppAstVisitor] Treating misidentified function_definition at ${this.filepath}:${node.startPosition.row + 1} as namespace.`);
                         return false; // Allow recursion
                    }
                    // If it's likely a real function, process it
                    this.visitFunctionDefinition(node);
                    return false; // Allow recursion into function body
                case 'class_specifier':
                    this.visitClassSpecifier(node);
                    return false; // Allow recursion into class body/members
                // Add cases for struct_specifier, etc. later
                default:
                    return false; // Not specifically handled, allow generic recursion
            }
        } catch (error: any) {
             logger.warn(`[CCppAstVisitor] Error visiting node type ${node.type} in ${this.filepath}: ${error.message}`);
             return false; // Continue traversal even if one node fails
        }
    }

    private visitIncludeOrDefine(node: Parser.SyntaxNode) {
        const location = getNodeLocation(node);
        let name = 'unknown_directive';
        let kind: 'IncludeDirective' | 'MacroDefinition' = 'IncludeDirective'; // Default, adjust later
        let properties: Record<string, any> = {};

        if (node.type === 'preproc_include') {
            kind = 'IncludeDirective';
            const pathNode = node.childForFieldName('path');
            const includePath = getNodeText(pathNode);
            const isSystemInclude = includePath.startsWith('<') && includePath.endsWith('>');
            name = includePath; // Use the path as the name for includes
            properties = {
                includePath: includePath.substring(1, includePath.length - 1), // Remove <> or ""
                isSystemInclude: isSystemInclude,
            };
        } else if (node.type === 'preproc_def') {
            kind = 'MacroDefinition'; // Placeholder kind
            name = getNodeText(node.childForFieldName('name'));
            properties = { value: getNodeText(node.childForFieldName('value')) };
        }

        const entityId = generateEntityId(kind.toLowerCase(), `${this.filepath}:${name}:${location.startLine}`);
        const directiveNode: AstNode = { // Use base AstNode, cast later if needed
            id: generateInstanceId(this.instanceCounter, kind.toLowerCase(), name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId,
            kind: kind,
            name: name,
            filePath: this.filepath,
            language: this.language,
            ...location,
            createdAt: this.now,
            properties: properties,
        };
        this.nodes.push(directiveNode);

        // Add INCLUDES relationship (File -> IncludeDirective/MacroDefinition)
        if (kind === 'IncludeDirective') {
            const relEntityId = generateEntityId('includes', `${this.fileNode.entityId}:${entityId}`);
            this.relationships.push({
                id: generateInstanceId(this.instanceCounter, 'includes', `${this.fileNode.id}:${directiveNode.id}`),
                entityId: relEntityId,
                type: 'INCLUDES',
                sourceId: this.fileNode.entityId,
                targetId: entityId,
                createdAt: this.now,
                weight: 5,
            });
        }
    }

     private visitFunctionDefinition(node: Parser.SyntaxNode) {
        const location = getNodeLocation(node);
        const declarator = node.childForFieldName('declarator');
        const nameNode = declarator?.childForFieldName('declarator'); // Function name is often nested
        const name = getNodeText(nameNode);

        if (!name) {
             logger.debug(`[CCppAstVisitor] Skipping function_definition without a clear name at ${this.filepath}:${location.startLine}`);
             return; // Skip anonymous or malformed/misidentified
        }

        // Determine if it's a method (inside a class) or a standalone function
        const kind: 'CFunction' | 'CppMethod' = this.currentClassEntityId ? 'CppMethod' : 'CFunction';
        const parentId = this.currentClassEntityId; // undefined if not in a class

        const entityId = generateEntityId(kind.toLowerCase(), `${this.filepath}:${name}:${location.startLine}`);

        // Create the base object first
        const baseFuncNode = {
            id: generateInstanceId(this.instanceCounter, kind.toLowerCase(), name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId,
            kind: kind,
            name: name,
            filePath: this.filepath,
            language: this.language,
            ...location,
            loc: location.endLine - location.startLine + 1,
            createdAt: this.now,
            parentId: parentId, // Link method to class (undefined is fine)
            // TODO: Extract parameters, return type
        };

        // Explicitly cast based on kind before pushing
        let funcNode: CFunctionNode | CppMethodNode;
        if (kind === 'CppMethod') {
            funcNode = baseFuncNode as CppMethodNode;
        } else {
            funcNode = baseFuncNode as CFunctionNode;
        }
        this.nodes.push(funcNode);


        // Add relationship File -> CFunction (DEFINES_FUNCTION) or Class -> CppMethod (HAS_METHOD)
        if (kind === 'CppMethod' && parentId) {
            const relEntityId = generateEntityId('has_method', `${parentId}:${entityId}`);
            this.relationships.push({
                id: generateInstanceId(this.instanceCounter, 'has_method', `${parentId}:${funcNode.id}`),
                entityId: relEntityId, type: 'HAS_METHOD',
                sourceId: parentId, targetId: entityId,
                createdAt: this.now, weight: 8,
            });
        } else if (kind === 'CFunction') {
            const relEntityId = generateEntityId('defines_function', `${this.fileNode.entityId}:${entityId}`);
            this.relationships.push({
                id: generateInstanceId(this.instanceCounter, 'defines_function', `${this.fileNode.id}:${funcNode.id}`),
                entityId: relEntityId, type: 'DEFINES_FUNCTION',
                sourceId: this.fileNode.entityId, targetId: entityId,
                createdAt: this.now, weight: 8,
            });
        }

        // Context restoration for nested functions/classes needs careful handling
        // For now, we let the main visit loop handle body recursion
    }

    private visitClassSpecifier(node: Parser.SyntaxNode) {
        const location = getNodeLocation(node);
        // Try standard name field first
        let nameNode: Parser.SyntaxNode | null | undefined = node.childForFieldName('name');

        // Workaround: If nameNode is null AND the original type was function_definition,
        // find the 'identifier' child that follows the 'type_identifier' child.
        if (!nameNode && node.type === 'function_definition') {
            let typeIdentifierFound = false;
            for (const child of node.namedChildren) {
                if (child.type === 'type_identifier') {
                    typeIdentifierFound = true;
                } else if (typeIdentifierFound && child.type === 'identifier') {
                    nameNode = child;
                    logger.debug(`[CCppAstVisitor] Using identifier child as name for misidentified class at ${this.filepath}:${location.startLine}`);
                    break;
                }
            }
        }

        const name = getNodeText(nameNode);

        if (!name) {
            logger.warn(`[CCppAstVisitor] Skipping class_specifier/misidentified node without a name at ${this.filepath}:${location.startLine}`);
            return; // Skip anonymous classes or nodes we can't name
        }

        const originalClassId = this.currentClassEntityId; // Save outer class context if nested

        const entityId = generateEntityId('cppclass', `${this.filepath}:${name}`);
        // logger.debug(`[CCppAstVisitor] Found class: ${name}, EntityId: ${entityId}`);

        const classNode: CppClassNode = {
            id: generateInstanceId(this.instanceCounter, 'cppclass', name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId,
            kind: 'CppClass',
            name: name,
            filePath: this.filepath,
            language: 'C++', // Explicitly set to C++ for CppClassNode
            ...location,
            createdAt: this.now,
            // TODO: Handle inheritance (base_clause)
        };
        this.nodes.push(classNode);
        this.currentClassEntityId = entityId; // Set context for methods/nested members

        // Add relationship File -> CppClass (DEFINES_CLASS)
        const relEntityId = generateEntityId('defines_class', `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'defines_class', `${this.fileNode.id}:${classNode.id}`),
            entityId: relEntityId, type: 'DEFINES_CLASS', // Reusing type
            sourceId: this.fileNode.entityId, targetId: entityId,
            createdAt: this.now, weight: 9,
        });

        // Let the main visit loop handle recursion into the body/member list
        // Restore context AFTER visiting children (handled by main visit loop now)
        // This is tricky without explicit exit events. Defer proper context stack management.
        // this.currentClassEntityId = originalClassId; // Restore outer class context - DEFERRED
    }

    // Add visitStructSpecifier etc. later
}


/**
 * Parses C/C++ files using Tree-sitter.
 */
export class CCppParser {
    private parser: Parser;

    constructor() {
        this.parser = new Parser();
        logger.debug('C/C++ Tree-sitter Parser initialized');
    }

    /**
     * Parses a single C/C++ file.
     * @param file - FileInfo object for the C/C++ file.
     * @returns A promise resolving to the path of the temporary result file.
     */
    async parseFile(file: FileInfo): Promise<string> {
        logger.info(`[CCppParser] Starting C/C++ parsing for: ${file.name}`);
        await ensureTempDir();
        const tempFilePath = getTempFilePath(file.path);
        const absoluteFilePath = path.resolve(file.path);
        const normalizedFilePath = absoluteFilePath.replace(/\\/g, '/');

        try {
            const fileContent = await fs.readFile(absoluteFilePath, 'utf-8');
            const language = file.extension === '.c' || file.extension === '.h' ? 'C' : 'C++';
            const grammar = language === 'C' ? C : Cpp;

            this.parser.setLanguage(grammar as any); // Cast to any to bypass type conflict
            const tree = this.parser.parse(fileContent);

            const visitor = new CCppAstVisitor(normalizedFilePath, language);
            visitor.visit(tree.rootNode);

            const result: SingleFileParseResult = {
                filePath: normalizedFilePath,
                nodes: visitor.nodes,
                relationships: visitor.relationships,
            };

            await fs.writeFile(tempFilePath, JSON.stringify(result, null, 2));
            logger.info(`[CCppParser] Pass 1 completed for: ${file.name}. Nodes: ${result.nodes.length}, Rels: ${result.relationships.length}. Saved to ${path.basename(tempFilePath)}`);
            return tempFilePath;

        } catch (error: any) {
            logger.error(`[CCppParser] Error during C/C++ Pass 1 for ${file.path}`, {
                 errorMessage: error.message,
                 stack: error.stack?.substring(0, 500)
            });
            try { await fs.unlink(tempFilePath); } catch { /* ignore */ }
            throw new ParserError(`Failed C/C++ Pass 1 parsing for ${file.path}`, { originalError: error });
        }
    }
}
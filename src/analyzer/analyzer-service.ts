// src/analyzer/analyzer-service.ts
import path from 'path';
import { FileScanner, FileInfo } from '../scanner/file-scanner.js';
import { Parser } from './parser.js';
import { RelationshipResolver } from './relationship-resolver.js';
import { StorageManager } from './storage-manager.js';
import { AstNode, RelationshipInfo } from './types.js';
import { createContextLogger } from '../utils/logger.js';
import config from '../config/index.js';
import { Project } from 'ts-morph';
import { Neo4jClient } from '../database/neo4j-client.js';
import { Neo4jError } from '../utils/errors.js';
// Removed setTimeout import

const logger = createContextLogger('AnalyzerService');

/**
 * Orchestrates the code analysis process: scanning, parsing, resolving, and storing.
 */
export class AnalyzerService {
    private parser: Parser;
    private storageManager: StorageManager;
    private neo4jClient: Neo4jClient;

    constructor() {
        this.parser = new Parser();
        // Instantiate Neo4jClient without overrides to use config defaults
        this.neo4jClient = new Neo4jClient();
        // Pass the client instance to StorageManager
        this.storageManager = new StorageManager(this.neo4jClient);
        logger.info('AnalyzerService initialized.');
    }

    /**
     * Runs the full analysis pipeline for a given directory.
     * Assumes database is cleared externally (e.g., via test setup).
     * @param directory - The root directory to analyze.
     */
    async analyze(directory: string): Promise<void> {
        logger.info(`Starting analysis for directory: ${directory}`);
        const absoluteDirectory = path.resolve(directory);
        let scanner: FileScanner;

        try {
            // Instantiate FileScanner here with directory and config
            // Use config.supportedExtensions and config.ignorePatterns directly
            scanner = new FileScanner(absoluteDirectory, config.supportedExtensions, config.ignorePatterns);

            // 1. Scan Files
            logger.info('Scanning files...');
            const files: FileInfo[] = await scanner.scan(); // No argument needed
            if (files.length === 0) {
                logger.warn('No files found to analyze.');
                return;
            }
            logger.info(`Found ${files.length} files.`);

            // 2. Parse Files (Pass 1)
            logger.info('Parsing files (Pass 1)...');
            await this.parser.parseFiles(files);

            // 3. Collect Pass 1 Results
            logger.info('Collecting Pass 1 results...');
            const { allNodes: pass1Nodes, allRelationships: pass1Relationships } = await this.parser.collectResults();
            logger.info(`Collected ${pass1Nodes.length} nodes and ${pass1Relationships.length} relationships from Pass 1.`);

            if (pass1Nodes.length === 0) {
                logger.warn('No nodes were generated during Pass 1. Aborting further analysis.');
                return;
            }

            // 4. Resolve Relationships (Pass 2)
            logger.info('Resolving relationships (Pass 2)...');
            const tsProject: Project = this.parser.getTsProject();
            const resolver = new RelationshipResolver(pass1Nodes, pass1Relationships);
            const pass2Relationships = await resolver.resolveRelationships(tsProject);
            logger.info(`Resolved ${pass2Relationships.length} relationships in Pass 2.`);

            const finalNodes = pass1Nodes;
            const finalRelationships = [...pass1Relationships, ...pass2Relationships];
            const uniqueRelationships = Array.from(new Map(finalRelationships.map(r => [r.entityId, r])).values());
            logger.info(`Total unique relationships after combining passes: ${uniqueRelationships.length}`);

            // 5. Store Results
            logger.info('Storing analysis results...');
            // Ensure driver is initialized before storing
            await this.neo4jClient.initializeDriver('AnalyzerService-Store');

            // --- Database clearing is now handled by beforeEach in tests ---

            await this.storageManager.saveNodesBatch(finalNodes);

            // Group relationships by type before saving
            const relationshipsByType: { [type: string]: RelationshipInfo[] } = {};
            for (const rel of uniqueRelationships) {
                if (!relationshipsByType[rel.type]) {
                    relationshipsByType[rel.type] = [];
                }
                // Push directly, using non-null assertion to satisfy compiler
                relationshipsByType[rel.type]!.push(rel);
            }

            // Save relationships batch by type
            for (const type in relationshipsByType) {
                 const batch = relationshipsByType[type];
                 // --- TEMPORARY DEBUG LOG ---
                 logger.debug(`[AnalyzerService] Processing relationship type: ${type}, Batch size: ${batch?.length ?? 0}`);
                 if (type === 'HAS_METHOD') {
                     logger.debug(`[AnalyzerService] Found HAS_METHOD batch. Calling saveRelationshipsBatch...`);
                 }
                 // --- END TEMPORARY DEBUG LOG ---
                 // Ensure batch is not undefined before passing (still good practice)
                 if (batch) {
                    await this.storageManager.saveRelationshipsBatch(type, batch);
                 }
            }

            logger.info('Analysis results stored successfully.');

        } catch (error: any) {
            logger.error(`Analysis failed: ${error.message}`, { stack: error.stack });
            throw error; // Re-throw the error for higher-level handling
        } finally {
            // 6. Cleanup & Disconnect
            logger.info('Closing Neo4j driver...');
            await this.neo4jClient.closeDriver('AnalyzerService-Cleanup');
            logger.info('Analysis complete.');
        }
    }
}
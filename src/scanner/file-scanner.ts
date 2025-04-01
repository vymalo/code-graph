import fsPromises from 'fs/promises';
import { Dirent } from 'fs';
import path from 'path';
import micromatch from 'micromatch'; // For glob pattern matching
import { createContextLogger } from '../utils/logger.js';
import { FileSystemError } from '../utils/errors.js';
import config from '../config/index.js'; // Import config to access default ignore patterns

const logger = createContextLogger('FileScanner');

/**
 * Represents basic information about a scanned file.
 */
export interface FileInfo {
    /** Absolute path to the file. */
    path: string;
    /** File name. */
    name: string;
    /** File extension (including the dot). */
    extension: string;
    // Optional: Add size, modified time if needed later
    // size?: number;
    // modifiedTime?: Date;
}

/**
 * Scans a directory recursively for files matching specified extensions,
 * respecting ignore patterns.
 */
export class FileScanner {
    private readonly targetDirectory: string;
    private readonly extensions: string[];

    private readonly combinedIgnorePatterns: string[]; // Store the final combined list

    /**
     * Creates an instance of FileScanner.
     * @param targetDirectory - The absolute path to the directory to scan.
     * @param extensions - An array of file extensions to include (e.g., ['.ts', '.js']).
     * @param ignorePatterns - An array of glob patterns to ignore.
     */
    constructor(targetDirectory: string, extensions: string[], userIgnorePatterns: string[] = []) {
        if (!path.isAbsolute(targetDirectory)) {
            throw new FileSystemError('FileScanner requires an absolute target directory path.');
        }
        this.targetDirectory = targetDirectory;
        this.extensions = extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`);

        // Combine default (from config) and user-provided ignore patterns
        let baseIgnorePatterns = [...config.ignorePatterns];

        // --- Fix: Prevent ignoring fixtures when scanning within __tests__ ---
        // This logic might be redundant now with the simplified isIgnored, but keep for clarity
        const isScanningFixtures = targetDirectory.includes('__tests__');
        if (isScanningFixtures) {
            // console.log('[FileScanner Diag] Scanning within __tests__, filtering out **/__tests__/** ignore pattern.'); // Removed log
            baseIgnorePatterns = baseIgnorePatterns.filter(pattern => pattern !== '**/__tests__/**');
        }
        // --- End Fix ---

        const combinedPatterns = new Set([...baseIgnorePatterns, ...userIgnorePatterns]);
        this.combinedIgnorePatterns = Array.from(combinedPatterns);

        logger.debug('FileScanner initialized', { targetDirectory, extensions: this.extensions, combinedIgnorePatterns: this.combinedIgnorePatterns });
        // console.log('[FileScanner Diag] Final Combined Ignore Patterns:', this.combinedIgnorePatterns); // Removed log
    }

    /**
     * Performs the recursive file scan.
     * @returns A promise that resolves to an array of FileInfo objects.
     * @throws {FileSystemError} If the target directory cannot be accessed.
     */
    async scan(): Promise<FileInfo[]> {
        logger.info(`Starting scan of directory: ${this.targetDirectory}`);
        const foundFiles: FileInfo[] = [];
        let scannedCount = 0;
        let errorCount = 0;

        try {
            await this.scanDirectoryRecursive(this.targetDirectory, foundFiles, (count) => scannedCount = count, (count) => errorCount = count);
            logger.info(`Scan completed: ${foundFiles.length} files matching criteria found. Scanned ${scannedCount} total items. Encountered ${errorCount} errors.`);
            return foundFiles;
        } catch (error: any) {
            logger.error(`Failed to scan directory: ${this.targetDirectory}`, { message: error.message });
            throw new FileSystemError(`Failed to scan directory: ${this.targetDirectory}`, { originalError: error });
        }
    }

    /**
     * Recursive helper function to scan directories.
     */
    private async scanDirectoryRecursive(
        currentPath: string,
        foundFiles: FileInfo[],
        updateScannedCount: (count: number) => void,
        updateErrorCount: (count: number) => void,
        currentScannedCount: number = 0,
        currentErrorCount: number = 0
    ): Promise<void> {
        // console.log(`[FileScanner Diag] Entering scanDirectoryRecursive for path: ${currentPath}`); // Removed log

        let localScannedCount = currentScannedCount;
        let localErrorCount = currentErrorCount;

        // --- Restore ignore checks ---
        // Check ignore patterns *before* reading directory
        if (this.isIgnored(currentPath)) {
            logger.debug(`Ignoring path (pre-check): ${currentPath}`); // Use logger.debug
            return;
        }
        // --- End restore ---


        let entries: Dirent[];
        try {
            entries = await fsPromises.readdir(currentPath, { withFileTypes: true });
             localScannedCount += entries.length; // Count items read in this directory
            updateScannedCount(localScannedCount);
        } catch (error: any) {
            logger.warn(`Cannot read directory, skipping: ${currentPath}`, { code: error.code });
            localErrorCount++;
            updateErrorCount(localErrorCount);
            return; // Skip this directory if unreadable
        }

        for (const entry of entries) {
            const entryPath = path.join(currentPath, entry.name);

            // --- Restore ignore checks ---
            // Check ignore patterns for each entry
            if (this.isIgnored(entryPath)) {
                logger.debug(`Ignoring path (entry check): ${entryPath}`); // Use logger.debug
                continue;
            }
            // --- End restore ---


            if (entry.isDirectory()) {
                await this.scanDirectoryRecursive(entryPath, foundFiles, updateScannedCount, updateErrorCount, localScannedCount, localErrorCount);
            } else if (entry.isFile()) {
                const extension = path.extname(entry.name).toLowerCase();
                // console.log(`[FileScanner Diag] Checking file: ${entryPath} with extension: ${extension}`); // Removed log
                if (this.extensions.includes(extension)) {
                    // console.log(`[FileScanner Diag] Found matching file: ${entryPath}`); // Removed log
                    foundFiles.push({
                        path: entryPath.replace(/\\/g, '/'), // Normalize path separators
                        name: entry.name,
                        extension: extension,
                    });
                }
            }
            // Ignore other entry types (symlinks, sockets, etc.) for now
        }
    }

    /**
     * Checks if a given path should be ignored based on configured patterns.
     * Uses micromatch for robust glob pattern matching.
     * @param filePath - Absolute path to check.
     * @returns True if the path should be ignored, false otherwise.
     */
    private isIgnored(filePath: string): boolean {
        // --- Restore original logic ---
        // Normalize path for consistent matching, especially on Windows
        const normalizedPath = filePath.replace(/\\/g, '/');
        // Use the combined list of ignore patterns (now potentially filtered in constructor)
        const isMatch = micromatch.isMatch(normalizedPath, this.combinedIgnorePatterns);
        // if (isMatch) { // Optional: Log when a path is ignored by patterns
        //     logger.debug(`Path ignored by pattern: ${filePath} (Normalized: ${normalizedPath})`);
        // }
        return isMatch;
        // --- End restore ---
    }
}
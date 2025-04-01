import neo4j, { Driver, Session, Transaction, ManagedTransaction } from 'neo4j-driver';
import config from '../config/index.js';
import { createContextLogger } from '../utils/logger.js';
import { Neo4jError } from '../utils/errors.js'; // Assuming errors.ts will be created

const logger = createContextLogger('Neo4jClient');

/**
 * Manages the connection and interaction with the Neo4j database.
 */
export class Neo4jClient {
    private driver: Driver | null = null;
    private readonly neo4jConfig: {
        uri: string;
        username: string;
        password: string;
        database: string;
    };

    /**
     * Creates an instance of Neo4jClient.
     * @param configOverride - Optional configuration to override defaults from src/config/index.js.
     */
    constructor(configOverride?: { uri?: string; username?: string; password?: string; database?: string }) {
        this.neo4jConfig = {
    
        uri: configOverride?.uri ?? config.neo4jUrl,
            username: configOverride?.username ?? config.neo4jUser,
            password: configOverride?.password ?? config.neo4jPassword,
            database: configOverride?.database ?? config.neo4jDatabase,
        };
        logger.info('Neo4jClient instance created (driver not initialized).');
        logger.debug('Using Neo4j config:', {
            uri: this.neo4jConfig.uri, // Log URI
            username: this.neo4jConfig.username, // Log user
            database: this.neo4jConfig.database, // Log db
            // Avoid logging password directly
        });
        // Driver initialization is deferred until first use or explicit call
    }

    /**
     * Initializes the Neo4j driver instance if it hasn't been already.
     * Verifies connectivity to the database.
     * @param context - Optional context string for logging (e.g., 'Analyzer', 'API').
     * @throws {Neo4jError} If connection fails.
     */
    public async initializeDriver(context: string = 'Default'): Promise<void> {
        if (this.driver) {
            logger.debug(`(${context}) Neo4j driver already initialized.`);
            // Optionally add a connectivity check here even if initialized
            await this.verifyConnectivity(context);
            return;
        }

        logger.info(`(${context}) Initializing Neo4j driver...`);
        try {
            this.driver = neo4j.driver(
                this.neo4jConfig.uri,
                neo4j.auth.basic(this.neo4jConfig.username, this.neo4jConfig.password),
                {
                    // Configure driver options if needed (e.g., maxConnectionPoolSize)
                    logging: {
                        level: config.logLevel === 'debug' ? 'debug' : 'info', // Map our log level
                        logger: (level, message) => logger.log(level, `(neo4j-driver) ${message}`),
                    },
                }
            );
            logger.info(`(${context}) Neo4j driver instance created.`);
            await this.verifyConnectivity(context);
            logger.info(`(${context}) Successfully connected to Neo4j database: ${this.neo4jConfig.database}`);
        } catch (error: any) {
            logger.error(`(${context}) Failed to initialize Neo4j driver or connect to database.`, {
                uri: this.neo4jConfig.uri,
                database: this.neo4jConfig.database,
                error: error.message,
            });
            this.driver = null; // Ensure driver is null on failure
            throw new Neo4jError(`Failed to connect to Neo4j: ${error.message}`, { originalError: error });
        }
    }

    /**
     * Verifies the connection to the Neo4j database.
     * @param context - Optional context string for logging.
     * @throws {Neo4jError} If verification fails.
     */
    private async verifyConnectivity(context: string): Promise<void> {
        if (!this.driver) {
            throw new Neo4jError('Driver not initialized. Cannot verify connectivity.');
        }
        logger.info(`(${context}) Verifying Neo4j connectivity to database: ${this.neo4jConfig.database}...`);
        try {
            // verifyConnectivity checks authentication and connectivity.
            await this.driver.verifyConnectivity({ database: this.neo4jConfig.database });
            logger.debug(`(${context}) Neo4j connectivity verified successfully.`);
        } catch (error: any) {
            logger.error(`(${context}) Neo4j connectivity verification failed.`, {
                database: this.neo4jConfig.database,
                error: error.message,
            });
            // Attempt to close the driver if verification fails after initial creation attempt
            await this.closeDriver(context);
            throw new Neo4jError(`Neo4j connectivity verification failed: ${error.message}`, { originalError: error });
        }
    }

    /**
     * Gets the initialized Neo4j driver instance. Initializes it if necessary.
     * @param context - Optional context string for logging.
     * @returns The Neo4j Driver instance.
     * @throws {Neo4jError} If driver initialization fails.
     */
    public async getDriver(context: string = 'Default'): Promise<Driver> {
        if (!this.driver) {
            logger.warn(`(${context}) Neo4j driver not connected. Attempting connection via getDriver...`);
            await this.initializeDriver(context);
             logger.info(`(${context}) Neo4j driver connection successful via getDriver.`);
        }
        // We check driver again because initializeDriver could throw
        if (!this.driver) {
             throw new Neo4jError('Failed to get Neo4j driver after initialization attempt.');
        }
        return this.driver;
    }

    /**
     * Gets a Neo4j session for the configured database.
     * Ensures the driver is initialized.
     * @param accessMode - The access mode for the session (READ or WRITE).
     * @param context - Optional context string for logging.
     * @returns A Neo4j Session instance.
     * @throws {Neo4jError} If getting the driver or session fails.
     */
    public async getSession(accessMode: 'READ' | 'WRITE' = 'WRITE', context: string = 'Default'): Promise<Session> {
        const driver = await this.getDriver(context); // Ensures driver is initialized
        try {
            const session = driver.session({
                database: this.neo4jConfig.database,
                defaultAccessMode: accessMode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE,
            });
            logger.debug(`(${context}) Neo4j session obtained for ${accessMode}.`);
            return session;
        } catch (error: any) {
             logger.error(`(${context}) Failed to obtain Neo4j session.`, { error: error.message });
             throw new Neo4jError(`Failed to obtain Neo4j session: ${error.message}`, { originalError: error });
        }
    }

    /**
     * Executes a Cypher query within a managed transaction.
     * Handles session acquisition and closing automatically.
     *
     * @param cypher - The Cypher query string.
     * @param params - Optional parameters for the query.
     * @param accessMode - 'READ' or 'WRITE'.
     * @param context - Optional context string for logging.
     * @returns The result of the query execution.
     * @throws {Neo4jError} If the transaction fails.
     */
    public async runTransaction<T>(
        cypher: string,
        params: Record<string, any> = {},
        accessMode: 'READ' | 'WRITE' = 'WRITE',
        context: string = 'Default'
    ): Promise<T> {
        let session: Session | null = null;
        try {
            session = await this.getSession(accessMode, context);
            const work = async (tx: ManagedTransaction): Promise<T> => {
                logger.debug(`(${context}) Running Cypher:\n${cypher}\nParams: ${JSON.stringify(params)}`);
                const result = await tx.run(cypher, params);
                // Often, you might want to process the result records here
                // For simplicity, returning the raw result object for now
                // You might adapt this to return result.records, summary, etc.
                return result as T; // Cast might be needed depending on expected return
            };

            if (accessMode === 'READ') {
                return await session.executeRead(work);
            } else {
                return await session.executeWrite(work);
            }
        } catch (error: any) {
            logger.error(`(${context}) Error executing Neo4j transaction. Cypher: ${cypher.substring(0, 100)}...`, {
                error: error.message,
                code: error.code, // Neo4j error code if available
            });
            throw new Neo4jError(`Neo4j transaction failed: ${error.message}`, { originalError: error, code: error.code });
        } finally {
            if (session) {
                try {
                    await session.close();
                    logger.debug(`(${context}) Neo4j session closed.`);
                } catch (closeError: any) {
                    logger.error(`(${context}) Failed to close Neo4j session.`, { error: closeError.message });
                    // Decide if this should throw or just be logged
                }
            }
        }
    }


    /**
     * Closes the Neo4j driver connection if it's open.
     * @param context - Optional context string for logging.
     */
    public async closeDriver(context: string = 'Default'): Promise<void> {
        if (this.driver) {
            logger.info(`(${context}) Closing Neo4j driver...`);
            try {
                await this.driver.close();
                this.driver = null;
                logger.info(`(${context}) Neo4j driver closed successfully.`);
            } catch (error: any) {
                logger.error(`(${context}) Error closing Neo4j driver.`, { error: error.message });
                // Consider if this should throw an error
            }
        } else {
            logger.debug(`(${context}) Neo4j driver already closed or not initialized.`);
        }
    }
}

// Optional: Export a singleton instance if desired for simple use cases
// export const neo4jClient = new Neo4jClient();

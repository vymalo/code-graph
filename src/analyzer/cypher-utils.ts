// src/analyzer/cypher-utils.ts
import { NODE_LABELS } from '../database/schema.js'; // Import labels from schema

/**
 * Generates the Cypher clauses for removing old labels and setting the correct new label
 * based on the 'kind' property during a node MERGE operation.
 *
 * @returns An object containing the removeClause and setLabelClauses.
 */
export function generateNodeLabelCypher(): { removeClause: string; setLabelClauses: string } {
    // Use the imported NODE_LABELS
    const allLabels = NODE_LABELS;
    const removeClause = allLabels.map((label: string) => `\`${label}\``).join(':'); // Generates `:File:Directory:...`

    // Generate the FOREACH clauses dynamically based on NODE_LABELS
    const setLabelClauses = allLabels.map((label: string) =>
        `FOREACH (_ IN CASE kind WHEN '${label}' THEN [1] ELSE [] END | SET n:\`${label}\`)`
    ).join('\n                '); // Indentation for readability in the final query

    return {
        removeClause: `REMOVE n:${removeClause}`,
        setLabelClauses: setLabelClauses
    };
}

// Add other Cypher generation utilities here if needed in the future
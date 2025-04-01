# CodeGraph Analyzer: The Universal Code Intelligence Platform

<div align="center">

[![GitHub stars](https://img.shields.io/github/stars/ChrisRoyse/CodeGraph.svg?style=social&label=Star&maxAge=2592000)](https://github.com/ChrisRoyse/CodeGraph/stargazers/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Neo4j Compatible](https://img.shields.io/badge/Neo4j-Compatible-brightgreen.svg)](https://neo4j.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9+-blue.svg)](https://www.typescriptlang.org/)

**Revolutionize how you understand, visualize, and interact with your multi-language codebase**

<a href="https://paypal.me/ChrisRoyseAI" target="_blank">
  <img src="https://img.shields.io/badge/SUPPORT_THIS_PROJECT-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Support This Project" width="300"/>
</a>

</div>

## 📋 Overview

**CodeGraph Analyzer** is a powerful static analysis engine that transforms your codebase into a rich, queryable Neo4j graph database. It now supports **multiple programming languages and frameworks**, creating a comprehensive "digital twin" of your entire software ecosystem. This enables unprecedented code comprehension, visualization, and AI-driven development workflows across complex, multi-language projects.

[![CodeGraph Demo Video](https://img.shields.io/badge/Watch_Demo-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://youtu.be/gb6IGsLK0wc)

## 🌟 What's New: Multi-Language Support

CodeGraph Analyzer now provides robust support for a wide spectrum of programming languages and frameworks:

### Programming Languages
- **TypeScript/JavaScript** - Full support for modern TS/JS features with ts-morph
- **Python** - Complete parsing via Python's native AST module
- **Java** - Advanced analysis using tree-sitter-java
- **C#** - Comprehensive parsing with tree-sitter-c-sharp
- **C/C++** - Detailed analysis of headers, includes, and implementation
- **Go** - Complete structure and package relationship mapping
- **SQL** - Table, view, and query analysis from SQL files
- **HTML/CSS** - Structure and style mapping

### Frameworks & Technologies
- **React/Preact** - Component hierarchies, JSX elements, prop mapping
- **Tailwind CSS** - Class usage and relationships
- **Supabase** - Database schema and API relationships
- **Deno** - Module, import, and runtime analysis

## 🚀 Key Features

- **Cross-Language Analysis**: Analyze relationships between different languages in the same project
- **Comprehensive Scanning**: Intelligently identifies supported file types across your entire project
- **Two-Pass Analysis**: First builds detailed ASTs for each file, then resolves complex cross-file relationships
- **Rich Element Identification**: Extracts files, directories, classes, interfaces, functions, methods, variables, parameters, type aliases, components, SQL tables, and more
- **Relationship Mapping**: Maps IMPORTS, EXPORTS, CALLS, EXTENDS, IMPLEMENTS, HAS_METHOD, RENDERS_ELEMENT, USES_COMPONENT, REFERENCES_TABLE, and many others
- **Neo4j Integration**: Creates a queryable knowledge graph with optimized schema management
- **MCP Integration**: Works seamlessly with Model Context Protocol for AI-powered codebase interaction

## 🔍 Why Multi-Language Support Matters

Modern software development rarely happens in a single language. The expanded language support in CodeGraph Analyzer addresses critical challenges:

- **Unified View**: See your entire tech stack as a coherent system instead of isolated silos
- **Cross-Language Dependencies**: Trace relationships between frontend and backend components (e.g., React components calling Python APIs)
- **Microservice Architecture**: Understand service boundaries and communication patterns across different languages
- **Multi-Team Collaboration**: Enable specialists in different languages to see how their code impacts the broader system
- **Legacy Integration**: Map connections between newer and older components written in different languages
- **Complete AI Context**: Give AI assistants holistic understanding of your entire codebase regardless of language

## 📈 Visualize, Understand, and Talk to Your Entire Codebase

With CodeGraph Analyzer, you can:

- **Navigate Complex Systems**: Easily explore relationships across language boundaries
- **Perform Intelligent Refactoring**: Understand the full impact of changes across your tech stack
- **Onboard Developers Faster**: Help new team members grasp the architecture regardless of their language expertise
- **Empower AI Assistance**: Enable AI tools to understand your codebase at a deeper level
- **Document Automatically**: Generate architecture diagrams that span language boundaries
- **Ensure Architectural Compliance**: Verify cross-language dependencies adhere to your design principles

## 🧠 The Power of Neo4j MCP: Natural Language → Code Understanding

The true breakthrough of CodeGraph isn't just in what languages it parses, but in how it enables AI to **truly understand your code** through the Model Context Protocol (MCP) integration with Neo4j.

### How It Works: The Neural Bridge Between Human, AI, and Code

1. **Natural Language → Cypher Translation**: When you ask your AI assistant a question about your codebase ("How does the login system work?"), the Neo4j MCP tools automatically translate this into optimized Cypher queries.

2. **Knowledge Graph Traversal**: These queries intelligently navigate the comprehensive code graph that CodeGraph has built, finding exactly the code relationships that answer your question.

3. **Contextual Understanding**: The AI receives the precise code context it needs - not just individual files, but the actual relationships, dependencies, and structures that connect them.

4. **Intelligent Response**: With this deep structural understanding, the AI can provide accurate, contextualized answers and generate code that respects your existing architecture.

### Why This Matters: Unprecedented AI Capabilities

- **Beyond Text Understanding**: AI no longer just reads code as text - it sees the actual structure and relationships between components
  
- **True Code Comprehension**: AI assistants can "see" how your Python backend connects to your React frontend, how data flows through your system, and what would break if you changed a specific function

- **Architectural Awareness**: Generate code that respects your existing patterns and integrates properly with your architecture, without breaking hidden dependencies

- **Intelligent Refactoring**: AI can confidently recommend refactoring across language boundaries, understanding the full impact of changes

- **Complexity Navigation**: Handle questions about massive codebases no human could fully keep in their head ("Show me all places where user data is accessed across our entire stack")

### Example Queries That Become Possible

```
"Show me all React components that fetch data from our Python API endpoints"

"Which SQL queries modify the user table and what services call them?"

"How does data flow from our frontend form to the database?"

"What would break if I changed the return type of this C++ function?"

"Generate a new endpoint that follows our existing API patterns"
```

Each of these questions is automatically translated to precise Cypher queries, enabling your AI assistant to provide accurate, contextual responses based on your actual codebase architecture - not just guesswork.

## 🔄 Neo4j MCP Integration: The Technical Details

### The Complete AI-Codebase Intelligence Stack

CodeGraph Analyzer works together with two critical MCP components to create a complete code understanding system:
- **GitHub Repository**: [https://github.com/neo4j-contrib/mcp-neo4j](https://github.com/neo4j-contrib/mcp-neo4j)

1. **code-analyzer-mcp**: This MCP server provides AI assistants with the ability to:
   - Trigger codebase analysis on demand
   - Watch for code changes to keep the knowledge graph updated
   - Customize analysis parameters without requiring technical knowledge

2. **github.com/neo4j-contrib/mcp-neo4j**: This powerful MCP server is the bridge between natural language and code knowledge, providing:
   - **read-neo4j-cypher**: Translates natural questions into Cypher queries that extract precisely the right information
   - **write-neo4j-cypher**: Enables AI to update the knowledge graph as needed
   - **get-neo4j-schema**: Allows AI to understand the structure of your code graph

### Simplified Setup with Integrated Configuration

The CodeGraph setup package includes pre-configured MCP settings for both servers, enabling seamless integration with AI assistants. A typical configuration looks like:

```json
{
  "mcpServers": {
    "github.com/neo4j-contrib/mcp-neo4j": {
      "command": "mcp-neo4j-cypher",
      "args": [
        "--db-url",
        "bolt://localhost:7687?database=codegraph",
        "--username",
        "neo4j",
        "--password",
        "test1234"
      ],
      "disabled": false,
      "autoApprove": [
        "read-neo4j-cypher",
        "write-neo4j-cypher",
        "get-neo4j-schema"
      ]
    },
    "code-analyzer-mcp": {
      "command": "node",
      "args": [
        "c:/code/amcp/mcp/dist/index.js"
      ],
      "cwd": "c:/code/amcp/mcp",
      "disabled": false,
      "alwaysAllow": [
        "run_analyzer",
        "start_watcher",
        "stop_watcher"
      ]
    }
  }
}
```

## 🛠️ Installation and Prerequisites

### Prerequisites
- **Neo4j Database**: Tested with Neo4j Desktop v5.26.4 (Community or Enterprise)
- **Neo4j Plugins** (Recommended):
  - APOC Core
  - Graph Data Science (GDS) Library
- **Node.js & npm**: Latest LTS version
- **Python 3**: For Python code analysis (accessible in your PATH)

### Installation Options

#### Option 1: Easiest Setup (Recommended)
1. **Download**: Get the pre-packaged zip file containing the analyzer and necessary configurations
   
   [📦 Download CodeGraph_Setup.zip](https://drive.google.com/file/d/1lc9qrupxXHaBzWlTFwcjClM8ygPsmH4Y/view?usp=sharing)

2. **Unzip**: Extract the contents to `C:\code\amcp\` (or your preferred location)
3. **Configure MCP**: Set up your MCP servers
4. **Start Neo4j**: Ensure your Neo4j instance is running
5. **Run Analysis**: Use the code-analyzer-mcp tool via your AI assistant

#### Option 2: Manual Setup (from GitHub)
1. **Clone the Repository**:
   ```bash
   git clone https://github.com/ChrisRoyse/CodeGraph.git amcp
   cd amcp
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Compile TypeScript**:
   ```bash
   npm run build
   ```

4. **Configure Environment**: Create a `.env` file for Neo4j credentials
5. **Configure MCP**: Set up your MCP servers
6. **Start Neo4j**: Ensure your Neo4j instance is running
7. **Run Analysis**: Use the CLI directly or the code-analyzer-mcp tool

## 📊 Usage (CLI)

```bash
# Navigate to the project directory
cd c:/code/amcp

# Run the analyzer (using compiled code in dist/)
# Replace <path/to/your/codebase> with the actual path
node dist/index.js analyze <path/to/your/codebase> [options]

# Example: Analyze a multi-language project with specific extensions
node dist/index.js analyze . -e .ts,.py,.java,.cs,.go,.sql,.jsx,.tsx --reset-db --update-schema

# Example: Analyze a different project, ignoring node_modules and dist
node dist/index.js analyze ../my-other-project --ignore "**/node_modules/**,**/dist/**"
```

### Options:
- `<directory>`: Required: Path to the directory to analyze
- `-e, --extensions <exts>`: Comma-separated file extensions (default now includes all supported languages)
- `-i, --ignore <patterns>`: Comma-separated glob patterns to ignore
- `--update-schema`: Force update Neo4j schema (constraints/indexes)
- `--reset-db`: WARNING: Deletes ALL data in the target Neo4j DB before analysis
- `--neo4j-url <url>`: Neo4j connection URL (overrides .env)
- `--neo4j-user <user>`: Neo4j username (overrides .env)
- `--neo4j-password <password>`: Neo4j password (overrides .env)
- `--neo4j-database <database>`: Neo4j database name (overrides .env)
- `-h, --help`: Display help information
- `-v, --version`: Display version information

## 🔮 Powering the Next Generation of AI-Assisted Development

The expanded language support in CodeGraph Analyzer enables entirely new possibilities for AI-assisted development:

- **Truly Context-Aware AI**: Instead of guessing, AI assistants can query the graph to understand exactly how components interact across language boundaries
- **Natural Language Queries**: Ask questions like "Show me all React components that fetch data from Python APIs" or "Find SQL queries that affect the user profile table"
- **Precise, Cross-Language Refactoring**: AI can confidently refactor code, knowing it has identified ALL relevant locations through graph traversal, even across language boundaries
- **Architectural Adherence**: AI can generate new code that aligns with existing patterns and structures by querying the graph for examples, regardless of implementation language

## 🌐 Future Roadmap

We're continuing to expand CodeGraph Analyzer's capabilities:

- **Additional Language Support**: Rust, Ruby, PHP, and more
- **Deeper Semantic Analysis**: Data flow analysis and taint tracking
- **Enhanced AI Integrations**: Advanced MCP tools for tasks like automated testing and security analysis
- **Rich Visualization Tools**: Interactive visual exploration of the code graph

## 🤝 Support & Contribution

This is an open-source project under the MIT License.

<div align="center">
  <h2>⭐ SUPPORT CODEGRAPH ⭐</h2>
  <p><b>Help fund continued development and new features!</b></p>
  
  <a href="https://paypal.me/ChrisRoyseAI" target="_blank">
    <img src="https://img.shields.io/badge/DONATE_NOW-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate Now" width="300"/>
  </a>
  
  <h3>❤️ Your support makes a huge difference! ❤️</h3>
  <p>CodeGraph is maintained by a single developer<br>Every donation directly helps improve the tool</p>
</div>

Contributions (bug reports, feature requests, pull requests) are welcome on the [GitHub Repository](https://github.com/ChrisRoyse/CodeGraph).

---

## 🔄 Supported Languages & Key Parsers

- **TypeScript/JavaScript/TSX/JSX:** `ts-morph`
- **Python:** Python script using Python's built-in `ast` module
- **Java:** `tree-sitter-java`
- **C#:** `tree-sitter-c-sharp`
- **Go:** `tree-sitter-go`
- **C/C++:** `tree-sitter-c`, `tree-sitter-cpp`
- **SQL:** `tree-sitter-sql`
- **HTML/CSS:** Specialized parsers

---

Unlock the complete structure within your polyglot codebase. Start graphing today!

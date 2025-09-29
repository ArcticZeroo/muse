# Memory Feature

## Overview

Muse provides a markdown-based memory system for AI agents. This feature allows agents to build up memory over time, effectively creating living documentation for codebases. Memory persists across sessions and can be shared via version control, supporting collaborative and long-term knowledge management.

## Installation and Usage Patterns

- **Installation**: Muse is installed via  
  ```
  npx -y @arcticzeroo/muse <memory directory>
  ```
- **Optional Context File**: Use `--context <context file>` to provide domain-specific terminology for improved memory operations.
- **Recommended Copilot Instruction**:  
  "Always query memory in muse before searching/writing code."
- **Typical Workflows**:
  - Investigate features/architecture and ingest findings into memory.
  - Process existing copilot instructions and ingest related code knowledge.
  - Query memory for specific topics before coding.

## Memory Organization

- **Markdown Memory Files**: Memory is stored as markdown files within a specified memory directory.
- **Category Structure**: Categories can be nested (e.g., `languages/cpp`, `feature/networking/HTTP`) and are identified by a regex pattern. Each category can have a description for discoverability.
- **Special Files**:
  - `summary.md`: Provides an overview listing of all categories.
  - `versions.jsonc`: Tracks content hashes and descriptions for change tracking.
  - `.user.md`: Represents the special `$USER` category for user preferences and details.
- **File System Watcher**: Uses chokidar to detect external changes to memory files and auto-ingests them.

## Key Concepts

- **Automatic Ingestion**: The system automatically ingests changes made to memory files, even if edited outside the MCP server (e.g., by humans).
- **MCP Sampling**: Muse uses MCP sampling extensively for memory operations. Note that this is currently only supported in Visual Studio Code and may encounter timeout issues.
- **Sampling and Query System**:
  - Uses MCP sampling to query AI models for categorization and content analysis.
  - **getCategoriesForQuery**: AI determines relevant categories for a query based on the summary.
  - **parseQueryCategories**: Parses AI response using regex tags (CATEGORY_TAG, CATEGORY_NAME_TAG, REASON_TAG).
  - Query process: AI receives the summary, determines categories, queries each category, and combines results.
  - Supports both ingestion (finding categories to update) and retrieval (finding categories to read).

## Core Components

- **MemorySession** (`src/lib/session.ts`): Central orchestrator managing memory operations, configuration, events, and versioning.
- **VersionManager** (`src/lib/versioning.ts`): Handles content hashing, change detection, and summary generation for memory files.
- **PromptManager** (`src/lib/constants/prompts.ts`): Manages AI prompts for memory operations, with optional context file support.
- **CategoryQueryManager**: Manages concurrent querying of multiple memory categories with dependency tracking and resolution.
- **MCP_SERVER** (`src/server/mcp-server.ts`): Basic MCP server setup with logging and sampling capabilities.

## Tools API

Muse exposes several tools through the MCP Tools API for interacting with the memory system:

1. **queryMemory**: Query memory before searching the codebase. Can return architecture, files, preferences, and code examples.
2. **ingestMemory**: Add new information to memory after learning something. Accepts a content string and automatically categorizes it.
3. **list**: List all memory categories (prefer `queryMemory` over `list`/`get`).
4. **get**: Retrieve the contents of a specific memory category by name.

All tools use zod for input validation and return structured results via the `createToolResults` utility.

## Architecture

- **Entry Point**: The main entry point is `src/server/index.ts`, which initializes the MCP server, memory session, and related tools.
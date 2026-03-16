# Cerebro AI | Research Synthesis System

Cerebro AI is a highly autonomous research synthesis platform built on Cloudflare's serverless infrastructure. It transforms fragmented information—like voice notes and textual data—into structured, navigable knowledge graphs.

## Core Purpose

The system is designed to act as a "Second Brain" for researchers and deep-thinkers. By leveraging advanced LLMs and stateful agentic patterns, Cerebro automatically identifies entities, establishes relationships, and surfaces hidden connections within complex topics.

## System Architecture

The project utilizes a modern, edge-native stack:

- **Edge API (Hono)**: A lightweight, high-performance web framework serving as the gateway for the frontend and external integrations.
- **Stateful Agents (Durable Objects)**: Each research project is managed by a `CerebroAgent` (a Cloudflare Durable Object), ensuring strong consistency and persistence for the research state.
- **Async Workflows (Cloudflare Workflows)**: Long-running, multi-step research tasks (like deep-dive discovery) are handled by `DeepDiveWorkflow`, allowing for complex state machines that survive restarts and failures.
- **Vector Intelligence (Vectorize & AI)**: Integrated semantic search and content embedding using Cloudflare's Workers AI and Vectorize index.

## Key Mechanisms

### 1. Voice-Driven Discovery
Users can upload audio notes which are transcribed using OpenAI's Whisper (via Workers AI). The resulting text is immediately funneled into the discovery workflow to expand the knowledge graph.

### 2. Resilient JSON Extraction
A critical mechanism in the `DeepDiveWorkflow` is its ability to handle unstable LLM outputs. When extracting structured entities, the system employs a **self-correcting retry loop**:
- **Parsing Guard**: If the AI returns invalid JSON or markdown-wrapped content, the system detects the parsing error.
- **Recursive Feedback**: The specific parse error and the failed output are fed back into the next AI prompt as a "correction hint."
- **N-State Retries**: The workflow attempts this correction up to 7 times, drastically increasing the reliability of knowledge extraction from non-deterministic models.

### 3. Hierarchical Knowledge Mapping
The system automatically links new discoveries back to "anchor" or "seed" nodes, maintaining a coherent structural hierarchy even as the research expands into wildly different sub-topics.

## Getting Started

### Prerequisites

- **Node.js**: Version 18 or higher.
- **Cloudflare Account**: [Sign up here](https://dash.cloudflare.com/sign-up) if you don't have one.
- **npm**: Standard Node package manager.

### Cloudflare Setup & Authentication

Before running the system, you must authenticate with Cloudflare and initialize the required services.

1.  **Login to Wrangler**:
    ```bash
    npx wrangler login
    ```

2.  **Create Vectorize Index**:
    Cerebro uses Vectorize for semantic intelligence. Create the index using the following command:
    ```bash
    npx wrangler vectorize create knowledge-graph-index --dimensions 1024 --metric cosine
    ```

3.  **Apply SQLite Migrations**:
    The system uses Durable Objects with SQLite storage. Initialize the database schema:
    ```bash
    npx wrangler migrations apply cerebro-ai
    ```

## Development

To run the project locally, you will need two terminal sessions:

```bash
# Terminal 1: Backend (Worker & Agents)
npm run dev

# Terminal 2: Frontend (Vite)
npm run frontend
```

After starting both, navigate to `http://localhost:5173` (or the URL provided by the frontend terminal) to access the dashboard.

## Deployment

Deploying to the Cloudflare global network is a single command:

```bash
npm run deploy
```

---

## Repository Safety Note
This repository is configured for public release. 
- **No Hardcoded Secrets**: All sensitive configurations are handled via environment variables or secret bindings.
- **Ignored Sensitive Files**: `.env`, `.dev.vars`, and other local configuration files are explicitly ignored by Git.
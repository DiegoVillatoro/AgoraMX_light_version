# ÁgoraMX Cognition

ÁgoraMX is a multi-agent civic research tutor that helps students investigate legislative initiatives using real documents and a Neo4j knowledge graph.

Unlike a conventional question-answering system, ÁgoraMX does not immediately provide a conclusion. It guides the student through a structured investigation:

1. Ask a research question.
2. Review a retrieval plan.
3. Examine an evidence dossier.
4. Formulate a provisional hypothesis.
5. Cite evidence and identify uncertainty.
6. Receive an evaluation of the reasoning process.
7. Read a final synthesis with explicit references and limitations.

The system is designed to support civic reasoning rather than replace it.

---

## Core principles

ÁgoraMX follows five central principles:

- **Evidence before conclusions**
- **Reasoning before synthesis**
- **Controlled graph access**
- **Explicit uncertainty**
- **Traceable references**

The language model cannot generate or execute arbitrary Cypher. All graph access is performed through predefined, read-only query templates controlled by the application. The fixed queries avoid to the produce syntactically valid but logically incorrect outputs.

Semantic similarity is used as a retrieval mechanism. It does not establish political agreement, coordination, intent, contradiction, guilt, or causality.

---

## System overview

```text
Student question
       │
       ▼
┌────────────────────────────┐
│ 1. Planning Agent          │
│ - Normalizes the question  │
│ - Detects entities         │
│ - Identifies limitations   │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 2. GraphRAG Retriever      │
│ - Vector search            │
│ - Graph expansion          │
│ - Document chunk retrieval │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 3. Evidence Auditor        │
│ - Source quality           │
│ - Relevance                │
│ - Coverage                 │
│ - Missing evidence         │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 4. Devil's Advocate        │
│ - Alternative explanations │
│ - Possible counterevidence │
│ - Invalid conclusions      │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 5. Socratic Tutor          │
│ - Withholds the conclusion │
│ - Requests a hypothesis    │
│ - Requires citations       │
└──────────────┬─────────────┘
               │
        Student reflection
               │
               ▼
┌────────────────────────────┐
│ 6. Reasoning Evaluator     │
│ - Claim/evidence alignment │
│ - Source verification      │
│ - Counterarguments         │
│ - Uncertainty              │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 7. Synthesis Agent         │
│ - Final answer             │
│ - Evidence references      │
│ - Facts vs. inference      │
│ - Explicit limitations     │
└────────────────────────────┘
```

---

## Knowledge graph

The data from initiatives and graph building with Neo4j can be consulted in the following repository: https://github.com/DiegoVillatoro/AgoraMX_knowledge_graph.git

The Neo4j graph represents:

- Legislative initiatives
- Presenting politicians
- Political affiliations at presentation time
- Topics
- Laws and provisions
- Institutions
- Legislative chambers
- Legislatures
- Source systems
- Documents
- Document fragments
- Semantic similarity relationships

Simplified graph structure:

```text
(Person)-[:PRESENTED]->(Initiative)
(Person)-[:MEMBER_OF_AT_PRESENTATION]->(Party)

(Initiative)-[:PRESENTED_IN]->(Chamber)
(Initiative)-[:BELONGS_TO]->(Legislature)
(Initiative)-[:OBTAINED_FROM]->(SourceSystem)
(Initiative)-[:HAS_TOPIC]->(Topic)
(Initiative)-[:AFFECTS]->(Provision)
(Provision)-[:PART_OF]->(Law)
(Initiative)-[:INVOLVES]->(Institution)
(Initiative)-[:HAS_DOCUMENT]->(Document)
(Document)-[:HAS_CHUNK]->(Chunk)

(Initiative)-[:SEMANTICALLY_SIMILAR]->(Initiative)
(Person)-[:SEMANTICALLY_SIMILAR]->(Person)
```

For the complete schema, see:

- [`docs/graph-schema.md`](docs/graph-schema.md)
- [`docs/graph-queries.md`](docs/graph-queries.md)

---

## GraphRAG retrieval

ÁgoraMX uses the graph exclusively as a read-only GraphRAG source.

The retrieval process combines:

1. A multilingual embedding of the research query.
2. Vector search over initiatives.
3. Vector search over document chunks.
4. Controlled expansion to related graph entities.
5. Evidence normalization.
6. Evidence ranking.
7. Assignment of stable evidence identifiers such as `[E1]`.

The application expects these Neo4j vector indexes:

```text
initiative_embedding
chunk_embedding
```

The embedding model is:

```text
sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
```

The model used for querying must be compatible with the model and vector dimensions used to populate the Neo4j indexes.

---

## Project structure

```text
agoramx-cognition/
├── app/
│   ├── config.py          # Typed environment configuration
│   ├── models.py          # Pydantic domain models
│   ├── llm.py             # OpenAI-compatible LLM client
│   ├── graph.py           # Read-only Neo4j GraphRAG
│   ├── agents.py          # Specialized cognitive agents
│   ├── orchestrator.py    # Two-stage investigation workflow
│   ├── main.py            # FastAPI application
│   └── static/            # Browser interface
├── docs/                  # Technical documentation
├── .env.example
└── README.md
```

See [`app/readme.md`](app/readme.md) for the responsibility of each application module.

---

## Requirements

Recommended environment:

- Python 3.11 or newer
- Neo4j with vector index support
- A Neo4j database containing the expected graph schema
- An OpenAI-compatible chat completion endpoint
- Sufficient disk space for the embedding model
- Internet access during the first embedding model download, unless the model already exists locally

Main Python dependencies:

```text
fastapi
uvicorn
pydantic
pydantic-settings
httpx
neo4j
numpy
sentence-transformers
```

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/DiegoVillatoro/AgoraMX_light_version.git
cd agoramx-cognition
```

### 2. Create a virtual environment

```bash
python -m venv .venv
```

Activate it:

```bash
# Linux or macOS
source .venv/bin/activate

# Windows PowerShell
.venv\Scripts\Activate.ps1
```

### 3. Install dependencies

If the project includes a requirements file:

```bash
pip install -r requirements.txt
```

Otherwise:

```bash
pip install \
  fastapi \
  "uvicorn[standard]" \
  pydantic \
  pydantic-settings \
  httpx \
  neo4j \
  numpy \
  sentence-transformers
```

### 4. Configure the environment

```bash
cp .env.example .env
```

Update the Neo4j and LLM values in `.env`.

### 5. Start the Neo4j service

The default configuration expects the politic database build running

### 6. Start the application

```bash
uvicorn app.main:app --reload
```

Open:

```text
http://localhost:8000
```

API documentation is available at:

```text
http://localhost:8000/docs
```

---

## Environment configuration

Example `.env`:

```dotenv
# Neo4j
NEO4J_URI=neo4j://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=change-me
NEO4J_DATABASE=neo4j

# Embedding model
MODEL_DIR=./app/models/paraphrase-multilingual-MiniLM-L12-v2

# OpenAI-compatible LLM endpoint
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=local
LLM_MODEL=gpt-4.1-mini
LLM_TEMPERATURE=0.1

# Retrieval limits
MAX_GRAPH_RESULTS=12
MAX_CHUNK_RESULTS=10
MAX_EVIDENCE_ITEMS=20

# Session management
SESSION_TTL_MINUTES=60

# Comma-separated list
CORS_ORIGINS=http://localhost:8000
```

---

## Investigation lifecycle

ÁgoraMX uses a two-request workflow.

### First request: open an investigation

```http
POST /api/investigate
Content-Type: application/json
```

```json
{
  "question": "Which initiatives address access to water, and which laws do they seek to amend?"
}
```

The response contains:

- A query plan
- Retrieved evidence
- A graph snapshot
- An evidence audit
- Alternative interpretations
- A Socratic challenge
- A session identifier

Its stage is:

```json
{
  "stage": "reflection_required"
}
```

### Second request: submit the reflection

```json
{
  "session_id": "generated-session-id",
  "question": "Which initiatives address access to water, and which laws do they seek to amend?",
  "reflection": "The evidence suggests ... [E1] ... [E3]. An alternative explanation is ... Additional evidence is needed ..."
}
```

The response contains:

- A reasoning evaluation
- A final evidence-based synthesis

Its stage is:

```json
{
  "stage": "completed"
}
```

See [`docs/api.md`](docs/api.md) for the complete REST contract.

---

## Evidence references

Every recovered item receives an identifier:

```text
[E1]
[E2]
[E3]
```

An evidence item can represent:

- An initiative
- A document chunk
- A graph relation

Agents must cite these identifiers when making claims. The final synthesis is restricted to the retrieval evidence.

An identifier only identifies an item in the current investigation. It is not intended to be a permanent global identifier.

---

## Read-only guarantees

The application establishes Neo4j sessions with:

```python
default_access_mode="READ"
```

In addition:

- The language model never receives permission to execute Cypher.
- Cypher statements are application-defined templates.
- The API does not expose a generic query endpoint.
- No `CREATE`, `MERGE`, `SET`, `DELETE`, `REMOVE`, or write procedure is required by the application.

For production, the Neo4j credentials should also belong to a database user with read-only privileges. Application-level read mode should not be treated as a substitute for database authorization.

---

## Safety and epistemic policy

The agents follow a shared policy:

- Separate documented facts from inference.
- Do not infer guilt, corruption, dishonesty, or criminal conduct.
- Do not interpret semantic similarity as coordination or intent.
- Do not treat presentation of an initiative as evidence of a vote.
- Do not treat missing evidence as proof that something is false.
- Do not invent sources or records.
- Use only the evidence supplied in the investigation.
- Cite evidence with `[E#]`.
- State concrete limitations and missing information.

See [`docs/agents-and-prompts.md`](docs/agents-and-prompts.md).

---

## Current graph capabilities

The system can:

- Search initiatives by semantic similarity.
- Associate initiatives with presenters.
- inspect political affiliation at presentation time.
- Identify initiative topics.
- Retrieve affected laws and provisions.
- Retrieve associated documents and PDF chunks.
- Inspect semantic similarity among initiatives.
- Inspect semantic similarity among presenters.

The system cannot currently confirm:

- Individual roll-call votes
- Legislative attendance
- Public interviews or statements
- Social media publications
- Real-time news
- Judicial findings not represented in the graph
- Corruption, guilt, intent, or political coordination

See [`docs/limitations.md`](docs/limitations.md).

---

## Documentation map

| Document | Purpose |
|---|---|
| [`docs/graph-schema.md`](docs/graph-schema.md) | Nodes, properties, and relationships |
| [`docs/graph-queries.md`](docs/graph-queries.md) | Controlled Cypher query patterns |
| [`docs/agents-and-prompts.md`](docs/agents-and-prompts.md) | Agent responsibilities and prompt policy |
| [`docs/cognitive-workflow.md`](docs/cognitive-workflow.md) | Pedagogical investigation process |
| [`docs/api.md`](docs/api.md) | REST API contract |
| [`docs/security-and-privacy.md`](docs/security-and-privacy.md) | Security and privacy controls |
| [`docs/limitations.md`](docs/limitations.md) | Known constraints |

---

## Important implementation note

A documented of controlled Cypher query patterns is presented in [`docs/graph-queries.md`](docs/graph-queries.md).

---

## Production considerations

The MVP uses an in-memory session store. This is appropriate only for local demonstrations.

A production deployment should consider:

- Redis or PostgreSQL for investigation state
- Expiration and deletion policies
- Pseudonymous user identifiers
- Encryption in transit and at rest
- Read-only Neo4j credentials
- Authentication and authorization
- Request size limits
- Rate limiting
- LLM output validation and retry policies
- Audit logs without storing unnecessary personal data
- Worker isolation for embedding operations
- Monitoring for Neo4j and LLM latency

---

## Disclaimer

ÁgoraMX is a research and educational tool. Its output does not replace consultation of official legislative documents.

Semantic similarity is a retrieval signal. It does not prove intention, agreement, coordination, contradiction, wrongdoing, or guilt.

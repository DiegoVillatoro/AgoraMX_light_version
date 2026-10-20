# System Architecture

## Purpose

ÁgoraMX combines a read-only Neo4j GraphRAG layer with specialized language-model agents to create a guided civic research experience.

The architecture separates:

- Retrieval
- Evidence normalization
- Evidence quality assessment
- Pedagogical interaction
- Reasoning evaluation
- Final synthesis

This separation makes it easier to inspect where a conclusion came from and which component is responsible for each decision.

---

## High-level architecture

```mermaid
flowchart TD
    U[Student] --> UI[Browser Interface]
    UI --> API[FastAPI REST API]
    API --> ORCH[Investigation Orchestrator]

    ORCH --> PLAN[Planning Agent]
    PLAN --> GRAG[Read-only GraphRAG]

    GRAG --> EMB[Sentence Transformer]
    GRAG --> NEO[(Neo4j)]

    ORCH --> AUDIT[Evidence Audit Agent]
    ORCH --> COUNTER[Devil's Advocate Agent]
    ORCH --> TUTOR[Socratic Tutor Agent]

    TUTOR --> UI
    UI --> REF[Student Reflection]
    REF --> API

    ORCH --> EVAL[Reasoning Evaluator]
    ORCH --> SYNTH[Synthesis Agent]

    EVAL --> UI
    SYNTH --> UI

    PLAN --> LLM[OpenAI-compatible LLM]
    AUDIT --> LLM
    COUNTER --> LLM
    TUTOR --> LLM
    EVAL --> LLM
    SYNTH --> LLM
```

---

## Main components

### Browser interface

The static frontend manages the five visible stages:

1. Question
2. Plan
3. Evidence dossier
4. Reflection
5. Evaluation and synthesis

It also renders a graph snapshot derived from recovered evidence.

The frontend does not query Neo4j directly.

### FastAPI application

`app/main.py`:

- Starts and closes shared application resources.
- Initializes Neo4j and the LLM client.
- Builds the investigation orchestrator.
- Serves static files.
- Exposes the REST API.
- Converts application exceptions into HTTP responses.

### Investigation orchestrator

`app/orchestrator.py` coordinates the workflow.

It supports two operations:

- Open an investigation.
- Complete an investigation after receiving the student's reflection.

The orchestrator, rather than the frontend, determines the order of the agents.

### LLM client

`app/llm.py` calls an OpenAI-compatible chat completions endpoint.

It supports:

- Plain-text completions
- Pydantic-validated structured completions

Structured agents receive a JSON Schema and are instructed to return a JSON object matching that schema.

### Read-only GraphRAG

`app/graph.py`:

- Generates the query embedding.
- Executes predefined vector queries.
- Expands initiative relationships.
- Normalizes graph records into `EvidenceItem` objects.
- Builds a frontend-oriented graph snapshot.
- Reports available and unavailable graph capabilities.

### Session store

The MVP uses `InMemoryCaseStore`.

It stores:

- Session identifier
- Original question
- Query plan
- Evidence dossier
- Evidence audit
- Counter-analysis
- Creation time

This prevents the second request from replacing the original evidence dossier with arbitrary client-provided evidence.

---

## First-stage sequence

```mermaid
sequenceDiagram
    actor Student
    participant UI
    participant API
    participant Planner
    participant GraphRAG
    participant Neo4j
    participant Auditor
    participant Counter
    participant Tutor
    participant Store

    Student->>UI: Submit research question
    UI->>API: POST /api/investigate
    API->>Planner: Create QueryPlan
    Planner-->>API: Structured plan
    API->>GraphRAG: retrieve(plan)
    GraphRAG->>Neo4j: Controlled vector queries
    Neo4j-->>GraphRAG: Initiatives and chunks
    GraphRAG-->>API: Evidence dossier
    API->>Auditor: Assess evidence
    Auditor-->>API: EvidenceAudit
    API->>Counter: Produce alternatives
    Counter-->>API: CounterAnalysis
    API->>Tutor: Build challenge
    Tutor-->>API: CognitiveChallenge
    API->>Store: Save investigation state
    API-->>UI: reflection_required
    UI-->>Student: Show dossier and challenge
```

---

## Second-stage sequence

```mermaid
sequenceDiagram
    actor Student
    participant UI
    participant API
    participant Store
    participant Evaluator
    participant Synthesizer

    Student->>UI: Submit reflection
    UI->>API: POST /api/investigate
    API->>Store: Load trusted case state
    Store-->>API: Plan, evidence, audit, counter-analysis
    API->>Evaluator: Evaluate reflection
    Evaluator-->>API: ReasoningEvaluation
    API->>Synthesizer: Produce final synthesis
    Synthesizer-->>API: Referenced answer
    API-->>UI: completed
    UI-->>Student: Show evaluation and synthesis
```

---

## Trust boundaries

### Trusted application-controlled data

- Cypher templates
- Neo4j connection settings
- Stored evidence dossier
- Pydantic schemas
- Shared agent policy
- Retrieval limits

### Untrusted or partially trusted data

- Student questions
- Student reflections
- Neo4j document content
- LLM output
- Source URLs
- External document text

LLM output must be considered generated data even after schema validation. Schema validation confirms shape, not factual correctness.

---

## Synchronous work inside async requests

The Neo4j driver calls and `SentenceTransformer.encode()` are synchronous.

The orchestrator therefore runs retrieval using:

```python
await asyncio.to_thread(
    self.graph.retrieve,
    plan,
)
```

For a larger deployment, use one or more of:

- A dedicated retrieval worker pool
- An async Neo4j driver
- A separate embedding service
- Cached query embeddings
- Bounded concurrency

---

## Read-only strategy

Read-only behavior is enforced at multiple layers:

1. The LLM cannot submit Cypher.
2. The application contains predefined queries.
3. Neo4j sessions use `READ` access mode.
4. The REST API exposes no general-purpose graph query route.
5. Production credentials should have database-level read-only permissions.

Defense in depth is necessary. Session access mode alone should not be considered a complete authorization policy.

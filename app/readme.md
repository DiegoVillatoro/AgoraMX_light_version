# Application Modules

The `app/` package contains the executable ÁgoraMX application.

It coordinates the civic investigation workflow, communicates with Neo4j and
the configured language model, validates data exchanged between components,
and exposes the FastAPI web application.

ÁgoraMX follows a controlled dependency flow:

```text
Browser
   │
   ▼
FastAPI routes
   │
   ▼
Investigation orchestrator
   ├── Cognitive agents
   ├── Read-only GraphRAG
   └── Session store
          │
          ▼
  Neo4j and LLM services
```

The language model does not receive a generic Neo4j tool and cannot generate
or execute arbitrary Cypher. Graph access is implemented in `graph.py` using
application-controlled query templates.

---

## Module overview

```text
app/
├── config.py
├── models.py
├── llm.py
├── graph.py
├── agents.py
├── orchestrator.py
├── main.py
├── static/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── models/
    └── paraphrase-multilingual-MiniLM-L12-v2/
```

---

## `config.py`

### Responsibility

Provides typed environment configuration using `pydantic-settings`.

It defines:

- Neo4j connection settings.
- Embedding model location.
- LLM endpoint and model settings.
- Retrieval limits.
- Investigation-session expiration.
- CORS origins.

### Main objects

#### `Settings`

Represents the effective application configuration.

Environment variables are case-insensitive and may be loaded from `.env`.

#### `get_settings()`

Returns a cached `Settings` instance.

### What belongs here

- Environment variable declarations.
- Defaults suitable for local development.
- Conversion of configuration strings into typed values.
- Configuration validation.

### What does not belong here

- Secrets committed to source control.
- Neo4j queries.
- Agent prompts.
- Application business logic.
- Network initialization.

### Security note

The default Neo4j password is intended only as a development placeholder.
Production startup should fail when known default credentials are detected.

---

## `models.py`

### Responsibility

Defines the typed contracts exchanged across the application.

Pydantic models are used to:

- Validate API input.
- Validate structured LLM output.
- Represent retrieved evidence.
- Represent graph visualizations.
- Return stable API responses.

### Main models

| Model | Responsibility |
|---|---|
| `InvestigationRequest` | Input for both investigation stages |
| `QueryPlan` | Structured output from the Planning Agent |
| `EvidenceItem` | Normalized source or graph evidence |
| `EvidenceAudit` | Evidence sufficiency and quality assessment |
| `CounterAnalysis` | Alternative interpretations and methodological objections |
| `CognitiveChallenge` | Student reflection instructions |
| `ReasoningEvaluation` | Rubric-based reasoning assessment |
| `GraphNode` | Node included in the browser graph snapshot |
| `GraphEdge` | Relationship included in the browser graph snapshot |
| `GraphSnapshot` | Visualization-oriented graph subgraph |
| `InvestigationResponse` | Complete API response |

### Evidence identifiers

Evidence identifiers such as `E1` are local to one investigation.

They are not:

- Permanent graph identifiers.
- Globally unique references.
- Substitutes for `sil_id`, `document_id`, or `chunk_id`.

### Validation boundary

Pydantic validates structure and field types. It does not prove that an LLM
statement is factually supported by an evidence item.

Production deployments should add deterministic citation and claim-support
validation.

---

## `llm.py`

### Responsibility

Communicates with an OpenAI-compatible chat-completion endpoint.

The module provides:

- Plain-text completion.
- Structured completion using a Pydantic JSON Schema.
- Basic extraction of JSON from model output.

### Main class

#### `LLMClient`

Configuration:

- Base URL.
- API key.
- Model name.
- Temperature.

Methods:

- `complete()` returns unstructured model text.
- `structured()` requests JSON conforming to a Pydantic model.
- `_extract_json()` removes optional Markdown fences and parses JSON.

### Trust boundary

All LLM output is untrusted until validated.

Schema validation establishes that output has the required shape. It does not
establish:

- Factual accuracy.
- Citation correctness.
- Absence of prompt injection.
- Absence of PII.
- Political neutrality.
- Compliance with every prompt instruction.

### Production improvements

A production client should add:

- Bounded retries.
- Exponential backoff.
- Output-size limits.
- Connection pooling.
- Separate connect, read, and write timeouts.
- Structured-output support when provided by the model server.
- Citation validation.
- PII output scanning.
- Safe error normalization.
- Model and prompt version metadata.

The LLM service should use TLS whenever it is not restricted to loopback.

---

## `graph.py`

### Responsibility

Implements read-only GraphRAG retrieval from Neo4j.

It is responsible for:

1. Loading the multilingual embedding model.
2. Embedding the retrieval query.
3. Searching the `initiative_embedding` vector index.
4. Searching the `chunk_embedding` vector index.
5. Expanding initiatives to controlled graph relationships.
6. Normalizing Neo4j rows into `EvidenceItem` objects.
7. Building the graph snapshot shown by the browser.
8. Reporting graph capabilities and limitations.

### Read-only design

Neo4j sessions use:

```python
default_access_mode="READ"
```

Cypher is defined by the application. User input is passed as parameters and
must never be directly interpolated into Cypher strings.

Production deployments must also use a Neo4j user with database-level
read-only permissions.

### Embedding compatibility

The model used at query time must be compatible with the model used to build
the Neo4j indexes.

Compatibility includes:

- Model family and version.
- Vector dimension.
- Normalization behavior.
- Similarity function.
- Input preprocessing.

### Graph snapshot

`build_graph_snapshot()` creates a visualization-oriented projection from the
retrieved evidence.

It does not query additional data and must not be interpreted as the complete
Neo4j neighborhood.

---

## `agents.py`

### Responsibility

Defines the specialized cognitive agents and their prompts.

All agents share `SYSTEM_POLICY`, which requires them to:

- Separate facts from inference.
- Avoid unsupported accusations.
- Treat semantic similarity only as a retrieval signal.
- Avoid treating initiative presentation as evidence of voting.
- Avoid treating missing evidence as proof of falsity.
- Use only the authorized evidence.
- Cite evidence using `[E#]`.
- State uncertainty and missing information.

### Agents

#### `PlanningAgent`

Transforms the user's question into a structured investigation plan.

It detects:

- Intent.
- People.
- Topics.
- Laws.
- Subquestions.
- Required graph capabilities.
- Unavailable capabilities.
- Safety notes.
- A semantic retrieval query.

It must not answer the research question.

#### `EvidenceAuditAgent`

Evaluates whether the dossier can support an answer.

It assesses:

- Source quality.
- Coverage.
- Supported subquestions.
- Unsupported subquestions.
- Missing evidence.
- Interpretation risks.

Its scores are heuristic model judgments, not calibrated probabilities.

#### `CounterEvidenceAgent`

Acts as a methodological devil's advocate.

It identifies:

- Alternative interpretations.
- Possible counterevidence.
- Premature conclusions.
- Questions requiring additional evidence.

It must not invent counterevidence.

#### `SocraticTutorAgent`

Creates the reflection task.

It asks the student to:

- Formulate a provisional hypothesis.
- Cite evidence.
- Separate facts from inferences.
- Consider an alternative explanation.
- Identify missing evidence.

It must not reveal the final answer.

#### `ReasoningEvaluatorAgent`

Evaluates reasoning rather than political ideology.

The rubric covers:

- Claim-evidence alignment.
- Source verification.
- Counterarguments.
- Uncertainty.
- Synthesis and clarity.

Its score should be treated as formative. It must not autonomously determine
a student's official grade.

#### `SynthesisAgent`

Produces the final evidence-constrained answer.

The output must contain:

- A brief answer.
- Documented facts.
- Possible inferences.
- Alternative interpretations.
- Conclusions that cannot be established.
- Evidence needed to continue.
- References.

---

## `orchestrator.py`

### Responsibility

Coordinates the two-stage investigation workflow.

### Stage one: open case

`_open_case()`:

1. Runs the Planning Agent.
2. Performs GraphRAG retrieval.
3. Builds the graph snapshot.
4. Audits the evidence.
5. Generates counteranalysis.
6. Generates the Socratic challenge.
7. Saves the investigation state.
8. Returns `reflection_required`.

### Stage two: complete case

`_complete()`:

1. Requires a session ID.
2. Retrieves the stored investigation.
3. Confirms that the question matches the session.
4. Evaluates the student's reflection.
5. Produces the final synthesis.
6. Returns `completed`.

### `InMemoryCaseStore`

The in-memory store is suitable only for demonstrations.

Limitations:

- State disappears on restart.
- State is not shared between workers.
- No authentication or ownership is enforced.
- Memory usage is process-local.
- Expiration occurs only when store methods run.

Production deployments should use Redis or PostgreSQL with:

- Expiration.
- Encryption.
- Session ownership.
- Pseudonymous identifiers.
- Deletion procedures.
- Access auditing.

---

## `main.py`

### Responsibility

Creates and exposes the FastAPI application.

It handles:

- Application startup and shutdown.
- Neo4j initialization.
- LLM client initialization.
- Agent construction.
- Orchestrator construction.
- CORS.
- Static file serving.
- Health checks.
- Investigation requests.

### Routes

| Method | Path | Responsibility |
|---|---|---|
| `GET` | `/` | Serve the browser interface |
| `GET` | `/api/health` | Check Neo4j connectivity |
| `POST` | `/api/investigate` | Open or complete an investigation |
| `GET` | `/docs` | Interactive OpenAPI documentation |
| `GET` | `/openapi.json` | OpenAPI schema |

---

## `static/`

### Responsibility

Contains the browser interface.

Expected files:

```text
static/
├── index.html
├── styles.css
└── app.js
```

The interface manages:

- Question submission.
- Investigation progress.
- Plan review.
- Evidence display.
- Graph visualization.
- Student reflection.
- Evaluation display.
- Final synthesis display.
- Theme preference.
- API health status.

### Browser security

The frontend must:

- Use `textContent` for untrusted text.
- Sanitize rendered Markdown.
- Validate source URLs.
- Avoid assigning LLM content directly to `innerHTML`.
- Use `rel="noopener noreferrer"` for external links.
- Apply a restrictive Content Security Policy.
- Avoid storing investigations in `localStorage` unless required.

---

## Adding a new agent

When introducing another agent:

1. Define a structured output model in `models.py`.
2. Define the agent in `agents.py`.
3. Apply `SYSTEM_POLICY`.
4. Pass only the minimum required evidence.
5. Treat retrieved and user content as untrusted.
6. Integrate the agent in `orchestrator.py`.
7. Add unit and adversarial tests.
8. Update the REST response only when necessary.
9. Document its limitations.

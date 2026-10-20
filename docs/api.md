# REST API Contract

This document describes the HTTP contract exposed by ÁgoraMX Cognition.

## Base URL

Local development:

```text
http://localhost:8000
```

API prefix:

```text
/api
```

## Content type

JSON endpoints accept and return:

```http
Content-Type: application/json
```

## Authentication

The MVP does not implement authentication.

This is acceptable only for local demonstrations. Production deployments must
add authentication and enforce investigation ownership.

---

## Endpoint summary

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Browser application |
| `GET` | `/api/health` | Neo4j health check |
| `POST` | `/api/investigate` | Open or complete an investigation |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/openapi.json` | OpenAPI document |

---

## `GET /api/health`

Checks whether the application can connect to Neo4j.

### Success response

Status:

```http
200 OK
```

```json
{
  "status": "ok",
  "neo4j": "connected",
  "graph_mode": "read_only"
}
```

### Unavailable response

Status:

```http
503 Service Unavailable
```

```json
{
  "detail": "Neo4j is unavailable."
}
```

The production endpoint should not return raw driver errors.

### Semantics

This endpoint verifies Neo4j connectivity only. It does not currently prove
that:

- The LLM endpoint is available.
- The embedding model is loaded correctly.
- Required vector indexes exist.
- Index dimensions match the embedding model.
- A complete investigation can be executed.

A production readiness endpoint should validate those dependencies
separately.

---

## `POST /api/investigate`

Runs one stage of the investigation workflow.

The request shape determines the operation:

- Without `reflection`: open an investigation.
- With `reflection`: complete an existing investigation.

---

## Open an investigation

### Request

```http
POST /api/investigate
Content-Type: application/json
```

```json
{
  "question": "Which initiatives address access to water and which laws do they seek to amend?"
}
```

### Fields

| Field | Type | Required | Constraints |
|---|---|---:|---|
| `question` | string | Yes | 10–3000 characters |
| `session_id` | string or null | No | Ignored when opening a case |
| `reflection` | string or null | No | Must be absent or null |

### Success response

Status:

```http
200 OK
```

The response has:

```json
{
  "session_id": "bd04cce1-1b22-453f-a6e7-2651a51e0296",
  "stage": "reflection_required",
  "question": "Which initiatives address access to water and which laws do they seek to amend?",
  "plan": {},
  "evidence": [],
  "audit": {},
  "counter_analysis": {},
  "graph_snapshot": {
    "nodes": [],
    "edges": []
  },
  "challenge": {},
  "evaluation": null,
  "final_answer": null,
  "graph_capabilities": [],
  "graph_limitations": []
}
```

---

## Submit a reflection

### Request

```http
POST /api/investigate
Content-Type: application/json
```

```json
{
  "session_id": "bd04cce1-1b22-453f-a6e7-2651a51e0296",
  "question": "Which initiatives address access to water and which laws do they seek to amend?",
  "reflection": "The dossier documents ... [E1] and ... [E3]. This supports a provisional interpretation, but it does not establish how any presenter voted. An alternative explanation is ... Additional evidence would be required ..."
}
```

### Fields

| Field | Type | Required | Constraints |
|---|---|---:|---|
| `session_id` | string | Yes | Must identify a non-expired case |
| `question` | string | Yes | Must match the stored question |
| `reflection` | string | Yes | Maximum 6000 characters |

### Success response

Status:

```http
200 OK
```

```json
{
  "session_id": "bd04cce1-1b22-453f-a6e7-2651a51e0296",
  "stage": "completed",
  "question": "Which initiatives address access to water and which laws do they seek to amend?",
  "plan": {},
  "evidence": [],
  "audit": {},
  "counter_analysis": {},
  "graph_snapshot": {
    "nodes": [],
    "edges": []
  },
  "challenge": null,
  "evaluation": {},
  "final_answer": "## Brief answer\n...",
  "graph_capabilities": [],
  "graph_limitations": []
}
```

---

## Data models

### Query plan

```json
{
  "normalized_question": "string",
  "intent": "general_research",
  "people": [],
  "topics": [],
  "laws": [],
  "subquestions": [],
  "required_capabilities": [],
  "unavailable_capabilities": [],
  "safety_notes": [],
  "retrieval_query": "string"
}
```

Allowed `intent` values:

```text
find_initiatives
compare_people
analyze_consistency
trace_topic
verify_claim
general_research
```

### Evidence item

```json
{
  "evidence_id": "E1",
  "kind": "initiative",
  "title": "Initiative title",
  "excerpt": "Evidence text",
  "source_url": "https://example.test/document",
  "source_label": "Legislative record",
  "sil_id": "SIL-123",
  "politician": "Presenter name",
  "date": "2025-01-15",
  "page": null,
  "score": 0.91,
  "primary_source": true,
  "direct_support": true,
  "metadata": {}
}
```

Allowed `kind` values:

```text
initiative
document_chunk
graph_relation
```

The current retriever creates `initiative` and `document_chunk` items.
`graph_relation` is reserved for future normalized relationship evidence.

### Evidence audit

```json
{
  "answerability": "partial",
  "source_quality_score": 80,
  "coverage_score": 65,
  "supported_questions": [],
  "unsupported_questions": [],
  "missing_evidence": [],
  "risk_flags": [],
  "notes": "string"
}
```

Allowed `answerability` values:

```text
sufficient
partial
insufficient
```

Scores are heuristic assessments. They are not calibrated probabilities.

### Counteranalysis

```json
{
  "alternative_interpretations": [],
  "possible_counterevidence": [],
  "invalid_conclusions": [],
  "questions_to_resolve": []
}
```

### Cognitive challenge

```json
{
  "instructions": "string",
  "questions": [],
  "required_evidence_ids": ["E1", "E3"],
  "warning": "string"
}
```

### Reasoning evaluation

```json
{
  "total_score": 78,
  "claim_evidence_score": 20,
  "source_verification_score": 18,
  "counterargument_score": 15,
  "uncertainty_score": 12,
  "synthesis_score": 13,
  "strengths": [],
  "weaknesses": [],
  "unsupported_claims": [],
  "feedback": "string",
  "improved_reasoning_steps": []
}
```

The expected total is:

```text
claim_evidence_score
+ source_verification_score
+ counterargument_score
+ uncertainty_score
+ synthesis_score
```

The current model does not enforce that arithmetic invariant. Production code
should validate it.

### Graph snapshot

```json
{
  "nodes": [
    {
      "id": "initiative:SIL-123",
      "label": "Initiative title",
      "node_type": "initiative",
      "evidence_ids": ["E1"],
      "metadata": {}
    }
  ],
  "edges": [
    {
      "source": "person:presenter name",
      "target": "initiative:SIL-123",
      "relationship": "PRESENTED",
      "evidence_ids": ["E1"]
    }
  ]
}
```

The snapshot is a visualization projection, not the complete graph.

---

## Error responses

### Validation failure

Status:

```http
422 Unprocessable Entity
```

Produced by FastAPI/Pydantic when a request violates the input schema.

### Invalid request state

Status:

```http
400 Bad Request
```

Examples:

- Reflection supplied without a session ID.
- Question does not match the stored session.

```json
{
  "detail": "session_id is required when submitting a reflection."
}
```

### Missing or expired session

Status:

```http
404 Not Found
```

```json
{
  "detail": "The session does not exist or has expired."
}
```

### Dependency failure

Possible status:

```http
500 Internal Server Error
```

The MVP currently uses `500` for most unexpected failures.

Production deployments should distinguish:

| Status | Situation |
|---|---|
| `429` | Rate limit exceeded |
| `502` | Invalid upstream LLM response |
| `503` | Neo4j or LLM unavailable |
| `504` | Upstream timeout |

---

## Idempotency

Opening an investigation is not idempotent. Repeating the same request creates
a new session and may produce different model output.

Submitting a reflection is also not guaranteed to be idempotent in the MVP.

Production deployments may accept an `Idempotency-Key` header.

---

## Timeouts

The LLM client currently uses a 120-second HTTP timeout.

Reverse proxies and clients must use compatible timeout values.

Long-running requests should eventually be replaced by:

- A job resource.
- Polling.
- Server-sent events.
- WebSocket progress notifications.

---

## Rate limits

The MVP defines no rate limits.

Recommended initial production limits:

```text
5 investigation openings per minute per user
10 reflection submissions per minute per user
2 concurrent investigations per user
```

Exact limits should be determined through load testing.

---

## Evidence-reference rules

References use:

```text
[E1]
[E2]
[E3]
```

Rules:

1. The identifier must exist in the current response.
2. It must not be reused across investigations as a permanent ID.
3. Citation existence does not prove that a claim is supported.
4. The browser should link a citation to the corresponding evidence item.
5. Production code should reject generated references that are not in the
   current evidence allowlist.

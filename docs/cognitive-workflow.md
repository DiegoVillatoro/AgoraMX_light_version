# Cognitive Investigation Workflow

This document describes the cognitive and technical workflow used by ÁgoraMX
to guide a student through an evidence-based investigation.

ÁgoraMX does not immediately answer the student's question. It first requires
the student to inspect an evidence dossier, formulate a provisional
hypothesis, cite sources, consider alternatives, and identify uncertainty.

The workflow is designed to support civic reasoning rather than replace it.

---

## Objectives

The investigation workflow has five primary objectives:

1. **Place evidence before conclusions.**
2. **Require active student reasoning.**
3. **Separate documented facts from interpretation.**
4. **Make uncertainty and missing information visible.**
5. **Produce traceable conclusions with evidence references.**

The system should help the student answer:

- What does the available evidence document?
- Which conclusions are directly supported?
- Which conclusions require inference?
- What alternative interpretations are possible?
- What information is missing?
- What should be investigated next?

---

## Workflow classification

ÁgoraMX uses an:

> **Orchestrated, sequential, multi-agent GraphRAG workflow with a mandatory human-in-the-loop reflection stage.**

It is orchestrated because `InvestigationOrchestrator` determines the execution
order.

It is sequential because each stage depends on outputs from previous stages.

It is multi-agent because specialized LLM roles perform different cognitive
tasks:

- Planning.
- Evidence auditing.
- Counteranalysis.
- Socratic tutoring.
- Reasoning evaluation.
- Final synthesis.

The GraphRAG Retriever is a deterministic application component rather than an
LLM agent.

---

## High-level workflow

```text
Student question
       │
       ▼
┌────────────────────────────┐
│ 1. Question validation     │
│ - Validate length          │
│ - Normalize input          │
│ - Apply safety controls    │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 2. Planning Agent          │
│ - Normalize question       │
│ - Detect entities          │
│ - Generate subquestions    │
│ - Identify limitations     │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 3. GraphRAG retrieval      │
│ - Embed retrieval query    │
│ - Search initiatives       │
│ - Search document chunks   │
│ - Expand graph context     │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 4. Evidence normalization  │
│ - Deduplicate results      │
│ - Rank evidence            │
│ - Assign [E#] identifiers  │
│ - Build graph snapshot     │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 5. Evidence Audit Agent    │
│ - Assess source quality    │
│ - Assess question coverage │
│ - Identify missing data    │
│ - Declare answerability    │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 6. Counter-Evidence Agent  │
│ - Alternative readings     │
│ - Possible counterevidence │
│ - Premature conclusions    │
│ - Unresolved questions     │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 7. Socratic Tutor Agent    │
│ - Withhold final answer    │
│ - Request hypothesis       │
│ - Require citations        │
│ - Require uncertainty      │
└──────────────┬─────────────┘
               │
               ▼
       Student reflection
               │
               ▼
┌────────────────────────────┐
│ 8. Reflection validation   │
│ - Confirm session          │
│ - Confirm question         │
│ - Validate references      │
│ - Check reflection limits  │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 9. Reasoning Evaluator     │
│ - Claim/evidence alignment │
│ - Source verification      │
│ - Counterarguments         │
│ - Uncertainty              │
│ - Synthesis and clarity    │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 10. Synthesis Agent        │
│ - Evidence-based answer    │
│ - Facts vs. inference      │
│ - Alternative readings     │
│ - Explicit limitations     │
│ - References               │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ 11. Output validation      │
│ - Validate citations       │
│ - Detect unsupported claims│
│ - Apply safety rules       │
│ - Return final response    │
└────────────────────────────┘
```

---

## Investigation states

The public API currently exposes two workflow states:

```text
reflection_required
completed
```

The internal workflow contains more detailed states.

```text
received
   │
   ▼
planning
   │
   ▼
retrieving
   │
   ▼
auditing
   │
   ▼
counteranalysis
   │
   ▼
challenge_generation
   │
   ▼
reflection_required
   │
   ▼
evaluating
   │
   ▼
synthesizing
   │
   ▼
completed
```

A production implementation may expose these internal states through a job or
progress API without exposing internal prompts or sensitive diagnostics.

---

## Phase 1: Open an investigation

The first phase begins when the student submits a research question without a
reflection.

Example:

```json
{
  "question": "Which initiatives address access to water, and which laws do they seek to amend?"
}
```

The API calls:

```python
InvestigationOrchestrator._open_case(question)
```

This phase produces:

- A structured query plan.
- An evidence dossier.
- A graph snapshot.
- An evidence audit.
- A counteranalysis.
- A Socratic challenge.
- A session identifier.

It does not produce the final answer.

---

## Stage 1: Question validation

The request model validates the question:

```python
class InvestigationRequest(BaseModel):
    question: str = Field(
        min_length=10,
        max_length=3000,
    )
```

The application should reject:

- Questions shorter than 10 characters.
- Questions longer than 3000 characters.
- Invalid JSON.
- Requests exceeding the configured body limit.

Production validation should also apply:

- Unicode normalization.
- Control-character removal.
- PII warnings or redaction.
- Prompt-injection detection.
- Abuse-rate controls.
- Request-size limits.

Question validation should not silently change the student's political or
substantive meaning.

---

## Stage 2: Planning

The Planning Agent converts the question into a `QueryPlan`.

```python
class QueryPlan(BaseModel):
    normalized_question: str
    intent: str
    people: list[str]
    topics: list[str]
    laws: list[str]
    subquestions: list[str]
    required_capabilities: list[str]
    unavailable_capabilities: list[str]
    safety_notes: list[str]
    retrieval_query: str
```

### Planning responsibilities

The agent must:

1. Preserve the meaning of the question.
2. Identify the likely research intent.
3. Extract relevant people.
4. Extract topics.
5. Extract laws.
6. Decompose complex questions.
7. Identify required graph capabilities.
8. Identify unsupported capabilities.
9. Produce a broad semantic retrieval query.
10. Avoid answering the research question.

### Supported intents

```text
find_initiatives
compare_people
analyze_consistency
trace_topic
verify_claim
general_research
```

### Planning output example

```json
{
  "normalized_question": "Which legislative initiatives concern access to water, and which legal provisions do they propose changing?",
  "intent": "trace_topic",
  "people": [],
  "topics": [
    "access to water",
    "human right to water"
  ],
  "laws": [],
  "subquestions": [
    "Which initiatives address access to water?",
    "Who presented those initiatives?",
    "Which laws or provisions would be affected?",
    "What differences exist between the proposed changes?"
  ],
  "required_capabilities": [
    "Semantic initiative retrieval",
    "Topic inspection",
    "Affected-provision retrieval",
    "Document chunk retrieval"
  ],
  "unavailable_capabilities": [],
  "safety_notes": [
    "Similarity between initiatives does not demonstrate coordination."
  ],
  "retrieval_query": "Legislative initiatives concerning access to water, the human right to water, water services, and amendments to related laws"
}
```

### Planning invariant

The plan may guide retrieval, but it is not evidence.

Entities detected by the Planning Agent must not be presented as graph facts
until confirmed by retrieval.

---

## Stage 3: GraphRAG retrieval

The application converts `retrieval_query` into a multilingual embedding.

```python
embedding = self.embed(plan.retrieval_query)
```

It then searches two Neo4j vector indexes:

```text
initiative_embedding
chunk_embedding
```

### Initiative retrieval

Initiative retrieval searches for semantically relevant `Initiative` nodes and
expands them to approved relationships:

```text
(Person)-[:PRESENTED]->(Initiative)
(Person)-[:MEMBER_OF_AT_PRESENTATION]->(Party)
(Initiative)-[:HAS_TOPIC]->(Topic)
(Initiative)-[:AFFECTS]->(Provision)
(Provision)-[:PART_OF]->(Law)
(Initiative)-[:HAS_DOCUMENT]->(Document)
```

It can return:

- Initiative identifiers.
- Titles.
- Summaries.
- Dates.
- Status.
- Source URLs.
- Presenters.
- Political affiliation at presentation time.
- Topics.
- Affected laws and provisions.
- Associated documents.
- Vector similarity scores.

### Chunk retrieval

Chunk retrieval searches for relevant `Chunk` nodes and traces them back to:

```text
(Chunk)<-[:HAS_CHUNK]-(Document)
(Document)<-[:HAS_DOCUMENT]-(Initiative)
```

It can return:

- Chunk identifier.
- Chunk text.
- Page number.
- Chunk position.
- Document URL.
- Document filename.
- Associated initiative.
- Presenters.
- Similarity score.

### Controlled access

The LLM does not generate the Cypher used by this stage.

Retrieval uses:

- Predefined Cypher.
- Parameters.
- Result limits.
- Read-only Neo4j sessions.

### Retrieval invariant

Semantic similarity is a discovery signal, not a factual conclusion.

A retrieval score must not be interpreted as:

- Confidence that a claim is true.
- Political agreement.
- Shared intent.
- Coordination.
- Causality.
- Contradiction.
- Legal equivalence.

---

## Stage 4: Evidence normalization

Raw Neo4j records are converted into `EvidenceItem` objects.

```python
class EvidenceItem(BaseModel):
    evidence_id: str
    kind: Literal[
        "initiative",
        "document_chunk",
        "graph_relation",
    ]
    title: str
    excerpt: str
    source_url: str
    source_label: str
    sil_id: str
    politician: str
    date: str
    page: int | None
    score: float
    primary_source: bool
    direct_support: bool
    metadata: dict[str, Any]
```

### Evidence identifiers

Each item receives an investigation-local identifier:

```text
E1
E2
E3
```

References are displayed as:

```text
[E1]
[E2]
[E3]
```

### Identifier properties

An evidence identifier is:

- Stable during the current investigation.
- Unique within the current investigation.
- Available to the student and agents.
- Linked to a specific evidence item.

An evidence identifier is not:

- A permanent global identifier.
- A replacement for `sil_id`.
- A source-quality guarantee.
- Proof that every claim citing it is supported.

### Ranking

The current implementation sorts evidence by:

1. Direct-support flag.
2. Primary-source flag.
3. Similarity score.

A production version should also consider:

- Provenance quality.
- Exact entity matches.
- Date relevance.
- Source diversity.
- Duplicate documents.
- Chunk overlap.
- Initiative versus fragment balance.

### Deduplication

Evidence should be deduplicated using stable fields such as:

```text
sil_id
document_id
chunk_id
content_hash
text_hash
```

The same underlying source should not receive multiple identifiers solely
because it was recovered through multiple strategies.

---

## Stage 5: Graph snapshot construction

The application converts initiative evidence into a browser-oriented graph
snapshot.

The snapshot may contain:

- Initiatives.
- People.
- Topics.
- Laws or provisions.
- Documents.
- Evidence-supported relationships.

Example:

```text
(Person)-[PRESENTED]->(Initiative)
(Initiative)-[HAS_TOPIC]->(Topic)
(Initiative)-[AFFECTS]->(Law or provision)
(Initiative)-[HAS_DOCUMENT]->(Document)
```

Every node and edge includes the evidence identifiers that support its
appearance.

### Snapshot limitation

The graph snapshot is a projection of the retrieved evidence.

It is not:

- The complete Neo4j graph.
- A complete neighborhood.
- Proof that omitted relationships do not exist.
- An independent source of evidence.

---

## Stage 6: Evidence audit

The Evidence Audit Agent receives:

- The original question.
- The query plan.
- The normalized evidence dossier.

It returns an `EvidenceAudit`.

```python
class EvidenceAudit(BaseModel):
    answerability: Literal[
        "sufficient",
        "partial",
        "insufficient",
    ]
    source_quality_score: int
    coverage_score: int
    supported_questions: list[str]
    unsupported_questions: list[str]
    missing_evidence: list[str]
    risk_flags: list[str]
    notes: str
```

### Answerability categories

#### `sufficient`

The evidence substantially supports an answer to the research question.

This does not mean that the answer is certain or complete.

#### `partial`

Some parts can be answered, but important claims require evidence that is not
in the dossier.

#### `insufficient`

The available evidence does not support a responsible substantive answer.

The workflow may still continue as an educational exercise, but the final
synthesis must explicitly state that the question cannot be answered from the
available dossier.

### Audit dimensions

The agent examines:

- Source quality.
- Directness.
- Relevance.
- Coverage.
- Missing data.
- Unsupported subquestions.
- Interpretation risks.

### Audit scores

The following scores are heuristic:

```text
source_quality_score
coverage_score
```

They are not:

- Calibrated probabilities.
- Legal assessments.
- Objective measures of truth.
- Substitutes for human source review.

### Audit invariant

The final synthesis must not express greater certainty than the evidence audit
allows.

---

## Stage 7: Counteranalysis

The Counter-Evidence Agent performs methodological opposition.

It returns:

```python
class CounterAnalysis(BaseModel):
    alternative_interpretations: list[str]
    possible_counterevidence: list[str]
    invalid_conclusions: list[str]
    questions_to_resolve: list[str]
```

### Alternative interpretations

These are other reasonable explanations of the same evidence.

Example:

```text
Two initiatives may share terminology because both reference the same legal
framework, not because their presenters coordinated.
```

### Possible counterevidence

This identifies evidence that could challenge a provisional interpretation.

Example:

```text
The final enacted text, committee amendments, or roll-call vote could differ
from the initiative as presented.
```

The agent must distinguish possible counterevidence from evidence actually
contained in the dossier.

### Invalid conclusions

These are conclusions that the current evidence cannot support.

Examples:

- A presenter voted for the initiative.
- Similar presenters coordinated politically.
- A person intended a particular outcome.
- An allegation establishes wrongdoing.
- Absence from the graph proves inactivity.

### Counteranalysis invariant

The agent must challenge overconfidence without manufacturing facts.

---

## Stage 8: Socratic challenge

The Socratic Tutor converts the dossier, audit, and counteranalysis into a
student exercise.

It returns:

```python
class CognitiveChallenge(BaseModel):
    instructions: str
    questions: list[str]
    required_evidence_ids: list[str]
    warning: str
```

### Required student actions

The challenge should ask the student to:

1. Formulate a provisional hypothesis.
2. Cite at least two evidence identifiers.
3. Distinguish documented facts from inferences.
4. Include an alternative explanation.
5. Identify missing evidence.

### Example challenge

```text
Using the evidence dossier, formulate a provisional conclusion about how the
retrieved initiatives address access to water.

Your response must:

1. Identify at least two documented facts.
2. Cite at least two evidence items using [E#].
3. Clearly label any inference.
4. Consider an alternative interpretation.
5. Explain what additional evidence would be needed.
```

### Tutor invariant

The Tutor must not answer the original research question.

Its role is to create productive cognitive work before synthesis.

---

## Investigation pause

After generating the challenge, the application saves:

```python
InvestigationState(
    session_id=session_id,
    question=question,
    plan=plan,
    evidence=evidence,
    audit=audit,
    counter=counter,
    created_at=...,
)
```

The API returns:

```json
{
  "stage": "reflection_required"
}
```

At this point:

- The evidence dossier is visible.
- The graph snapshot is visible.
- The audit is visible.
- The counteranalysis is visible.
- The challenge is visible.
- The final answer remains hidden.

This pause is the mandatory human-in-the-loop stage.

---

## Phase 2: Complete the investigation

The second phase begins when the student submits:

- The existing `session_id`.
- The original question.
- A reflection.

Example:

```json
{
  "session_id": "bd04cce1-1b22-453f-a6e7-2651a51e0296",
  "question": "Which initiatives address access to water, and which laws do they seek to amend?",
  "reflection": "The dossier documents ... [E1] and ... [E3]. I infer that ... An alternative explanation is ... The final enacted text and voting records are missing."
}
```

The orchestrator calls:

```python
InvestigationOrchestrator._complete(request)
```

---

## Stage 9: Session validation

Before evaluating the reflection, the application verifies:

1. A session identifier was supplied.
2. The session exists.
3. The session has not expired.
4. The submitted question matches the stored question.

The MVP compares:

```python
state.question.strip() == request.question.strip()
```

A production implementation should additionally verify:

- Authenticated session ownership.
- Investigation status.
- Single-use or idempotency rules.
- Maximum reflection size.
- Valid evidence identifiers.
- PII handling.
- Expiration.
- Version compatibility.

### Session security

A UUID is difficult to guess, but it is not authorization.

Production sessions must be bound to an authenticated or pseudonymous owner.

---

## Stage 10: Reflection validation

The browser currently encourages the student to include at least two
references.

Server-side validation should independently verify:

- At least two evidence references are present.
- Every reference exists in the investigation.
- Duplicate citations are counted only once.
- References belong to the current session.
- The reflection is not empty.
- The reflection does not exceed the maximum length.

Example citation extraction:

```python
import re

EVIDENCE_REFERENCE = re.compile(r"$$E(\d+)$$")

def extract_evidence_ids(text: str) -> set[str]:
    return {
        f"E{number}"
        for number in EVIDENCE_REFERENCE.findall(text)
    }
```

Validation:

```python
available_ids = {
    item.evidence_id
    for item in state.evidence
}

submitted_ids = extract_evidence_ids(reflection)
unknown_ids = submitted_ids - available_ids

if unknown_ids:
    raise ValueError(
        "The reflection contains unknown evidence references."
    )
```

### Reflection invariant

A valid identifier does not prove that the student's claim is supported by
that evidence. The evaluator must still assess claim-evidence alignment.

---

## Stage 11: Reasoning evaluation

The Reasoning Evaluator assesses the student's reasoning.

It must not assess whether the student agrees with:

- The model.
- A political party.
- A politician.
- An instructor's ideology.
- A preferred policy position.

### Rubric

| Dimension | Maximum |
|---|---:|
| Claim-evidence alignment | 25 |
| Source verification | 25 |
| Counterargument consideration | 20 |
| Uncertainty management | 15 |
| Synthesis and clarity | 15 |
| **Total** | **100** |

### Claim-evidence alignment

The evaluator considers whether:

- Claims cite relevant evidence.
- The student avoids overstatement.
- The student distinguishes facts from inference.
- Evidence is interpreted consistently with its content.

### Source verification

The evaluator considers whether:

- The student recognizes source type.
- Primary-source status is considered.
- Document pages or URLs are inspected where possible.
- Source limitations are acknowledged.

### Counterarguments

The evaluator considers whether:

- A meaningful alternative explanation is included.
- The alternative is relevant.
- Possible counterevidence is identified.
- The student avoids a one-sided conclusion.

### Uncertainty

The evaluator considers whether:

- Missing evidence is stated.
- Confidence matches evidence coverage.
- Unknowns are not presented as facts.
- Absence of evidence is not treated as proof.

### Synthesis and clarity

The evaluator considers whether:

- The reasoning has a coherent structure.
- The provisional conclusion follows from the analysis.
- Facts, inferences, and open questions are distinguishable.

### Evaluation output

```python
class ReasoningEvaluation(BaseModel):
    total_score: int
    claim_evidence_score: int
    source_verification_score: int
    counterargument_score: int
    uncertainty_score: int
    synthesis_score: int
    strengths: list[str]
    weaknesses: list[str]
    unsupported_claims: list[str]
    feedback: str
    improved_reasoning_steps: list[str]
```

### Evaluation limitations

The evaluation is formative.

It must not be used as the sole basis for:

- Official grading.
- Discipline.
- Admissions.
- Student progression.
- Political profiling.
- Assessment of intelligence or character.

An educator should review any consequential use.

---

## Stage 12: Final synthesis

The Synthesis Agent receives:

- The original question.
- The student reflection.
- The reasoning evaluation.
- The evidence audit.
- The counteranalysis.
- The authorized evidence dossier.

It produces:

```text
## Brief answer

## Documented facts

## Possible inferences

## Alternative interpretations

## What cannot be concluded

## Evidence needed to continue

## References
```

### Documented facts

Every material factual statement should cite at least one evidence item.

Example:

```text
The initiative identified as SIL-123 proposes changes concerning access to
water [E1].
```

### Possible inferences

An inference must be labeled and bounded.

Example:

```text
One possible interpretation is that the retrieved initiatives share a concern
with access to water, although the evidence does not establish coordination
between their presenters [E1] [E4].
```

### Alternative interpretations

The synthesis should preserve reasonable alternatives identified during
counteranalysis.

### What cannot be concluded

This section must explicitly state unsupported conclusions.

Examples:

- How a presenter voted.
- Whether presenters coordinated.
- Whether a proposal was enacted.
- Whether a person had a specific private intention.
- Whether an allegation is true.
- Whether omitted initiatives exist outside the current corpus.

### Evidence needed to continue

This section may identify:

- Final enacted text.
- Committee reports.
- Roll-call votes.
- Attendance records.
- Official resolutions.
- Additional legislatures.
- Complete PDFs.
- Corrected OCR.
- Relevant documents not currently represented in the graph.

The system may state that a document would be useful. It must not claim that
the document exists unless the dossier establishes its existence.

---

## Stage 13: Final validation

Before returning the synthesis, production code should apply deterministic
checks.

### Citation allowlist

Every `[E#]` must exist in the current investigation.

### Reference completeness

Every reference listed under `References` should correspond to an evidence
item.

### Claim-support review

High-risk or material claims should be checked against cited excerpts.

### Prohibited conclusions

The final output should be rejected or regenerated if it:

- Determines guilt without an official decision in evidence.
- Treats semantic similarity as coordination.
- Treats initiative presentation as voting.
- Invents a source.
- Cites unknown evidence.
- Introduces an event absent from the dossier.
- Exceeds the audit's answerability level.
- Exposes unnecessary PII.
- Follows an instruction embedded in retrieved text.

### Safe rendering

The browser must sanitize the final Markdown and avoid inserting untrusted
output directly into `innerHTML`.

---

## Completed response

After evaluation and synthesis, the API returns:

```json
{
  "stage": "completed",
  "evaluation": {
    "total_score": 78
  },
  "final_answer": "## Brief answer\n..."
}
```

The response also repeats:

- The plan.
- The evidence dossier.
- The audit.
- The counteranalysis.
- The graph snapshot.
- Graph capabilities.
- Graph limitations.

This allows the final synthesis to remain inspectable against the original
evidence.

---

## Workflow invariants

The following rules apply across every stage.

### Evidence invariant

No generated statement becomes evidence merely because an LLM produced it.

### Citation invariant

Only evidence items in the current investigation may be cited.

### Read-only invariant

No stage may modify graph nodes, relationships, properties, constraints, or
indexes.

### Human-reflection invariant

The final synthesis must not be returned before the reflection stage is
completed.

### Uncertainty invariant

Missing evidence must remain visible in the final answer.

### Semantic-similarity invariant

Semantic similarity is used for retrieval only.

It does not establish:

- Agreement.
- Coordination.
- Intention.
- Contradiction.
- Wrongdoing.
- Causation.

### Political-affiliation invariant

Party membership at presentation time is temporal context. It does not prove
an individual's personal belief or permanent affiliation.

### Sponsorship invariant

Presenting an initiative does not prove:

- Voting for it.
- Writing every part of it.
- Supporting later amendments.
- Supporting the final enacted text.

### Non-accusation invariant

The system must not determine that a person is corrupt, criminal, dishonest,
or guilty unless an official resolution explicitly included in the evidence
supports that specific statement.

### Missing-evidence invariant

The absence of evidence does not prove that an event did not occur.

---

## Failure behavior

The workflow should fail safely.

### Planning failure

If the Planning Agent returns invalid structured output:

- Retry a bounded number of times.
- Request schema repair.
- Return a safe dependency error if repair fails.

Do not execute retrieval with a partially parsed plan.

### Retrieval failure

If Neo4j or the embedding model fails:

- Do not continue to evidence auditing.
- Do not ask the LLM to answer without evidence.
- Return an explicit service error.

### Empty retrieval

If no evidence is found:

- Return an empty dossier.
- Mark answerability as `insufficient`.
- Explain that no relevant evidence was recovered.
- Suggest reformulating the question.
- Do not generate a substantive conclusion.

### Audit failure

If the audit cannot be generated:

- Preserve the dossier.
- Do not present an unreviewed synthesis as reliable.
- Allow the user to retry.

### Expired session

If the session expires before reflection submission:

- Return `404`.
- Do not silently open a new case.
- Ask the user to restart the investigation.

### Evaluation failure

If the evaluator fails:

- Do not fabricate a score.
- Allow retry.
- Optionally provide the dossier and reflection for human review.

### Synthesis failure

If synthesis validation fails:

- Regenerate a bounded number of times.
- If validation still fails, return the evaluation without an unsafe final
  answer.
- Record a redacted validation event.

---

## Human oversight

The student is the first human-in-the-loop actor.

An instructor or designated reviewer should become involved when:

- The audit is insufficient.
- Sources materially conflict.
- The question alleges wrongdoing.
- Sensitive PII is detected.
- The student disputes the evaluation.
- The output may affect an official grade.
- The synthesis contains a high-risk claim about a living person.
- Citation validation fails.
- Prompt injection is detected.
- The investigation may be published.

A reviewer should be able to:

- Inspect the evidence.
- Inspect version metadata.
- Override or annotate the evaluation.
- Remove unsafe output.
- Mark a source as unreliable.
- Report an upstream graph error.
- Document a correction.

---

## Example complete investigation

### Question

```text
What differences exist between initiatives concerning public access to water?
```

### Plan

The system identifies:

- Topic: access to water.
- Intent: compare initiatives.
- Required capabilities: initiative and document retrieval.
- Limitation: the graph cannot prove how legislators voted.

### Evidence dossier

```text
[E1] Initiative A summary and affected provisions.
[E2] Page 4 of Initiative A's document.
[E3] Initiative B summary and affected provisions.
[E4] Page 7 of Initiative B's document.
```

### Audit

```text
Answerability: partial

Supported:
- The initiatives' presented objectives.
- The laws and provisions they proposed changing.

Unsupported:
- Whether the presenters voted for the proposals.
- Whether the proposals became law.

Missing:
- Final enacted text.
- Roll-call records.
- Committee amendments.
```

### Counteranalysis

```text
The initiatives may use similar language because both rely on the same
constitutional framework. Similarity does not establish coordination.
```

### Student reflection

```text
A documented difference is that Initiative A focuses on service access [E1],
while Initiative B places greater emphasis on administrative responsibilities
[E3]. I infer that they approach the same issue through different legal
mechanisms, although this requires checking the complete proposal text [E2]
[E4]. An alternative explanation is that the difference comes from how the
summaries were written. The final enacted text and voting records are missing.
```

### Evaluation

The evaluator reviews:

- Whether `[E1]` and `[E3]` support the claimed difference.
- Whether the student correctly labels the inference.
- Whether the alternative is meaningful.
- Whether missing evidence is recognized.

### Final synthesis

The system presents:

- A brief bounded answer.
- Documented differences with citations.
- Possible interpretations.
- Alternative explanations.
- Unsupported conclusions.
- Evidence needed to continue.
- A reference list.

---

---

## Acceptance criteria

The workflow is operating correctly when:

- [ ] The first request does not return a final answer.
- [ ] A structured plan is produced.
- [ ] Graph retrieval uses only controlled read-only queries.
- [ ] Evidence receives investigation-local identifiers.
- [ ] The audit identifies supported and unsupported questions.
- [ ] Counteranalysis contains no invented evidence.
- [ ] The Tutor requests a student hypothesis.
- [ ] A session is saved with an expiration time.
- [ ] Completion requires the correct session and question.
- [ ] Reflection references are validated.
- [ ] The evaluator scores reasoning rather than ideology.
- [ ] The synthesis uses only authorized evidence.
- [ ] Every material documented fact has an `[E#]` reference.
- [ ] Missing evidence remains explicit.
- [ ] Semantic similarity is not presented as proof.
- [ ] Unsafe or unsupported conclusions are rejected.
- [ ] The completed response remains inspectable against the dossier.

---

## Summary

The ÁgoraMX workflow is intentionally designed around delayed synthesis.

The application first creates an evidence dossier and exposes its limitations.
The student must then perform an explicit act of reasoning before the system
provides evaluation and synthesis.

The core workflow is:

```text
Question
  → Plan
  → Retrieve
  → Audit
  → Challenge
  → Student reflection
  → Evaluation
  → Evidence-constrained synthesis
```

This design makes the student an active participant in the investigation and
keeps the final answer connected to inspectable legislative evidence.

# Limitations

ÁgoraMX is an educational research assistant. It is not an authoritative
legislative, legal, political, judicial, or electoral decision system.

## Evidence coverage

The system can only reason over evidence retrieved from the configured Neo4j
graph.

The graph currently represents:

- Initiatives.
- Presenters.
- Political affiliation at presentation time.
- Topics.
- Laws and provisions.
- Institutions.
- Chambers.
- Legislatures.
- Source systems.
- Documents.
- Document chunks.
- Semantic similarity.

The graph does not currently provide complete structured coverage of:

- Roll-call votes.
- Attendance.
- Public speeches.
- Interviews.
- Social media.
- News.
- Campaign finance.
- Lobbying.
- Court decisions.
- Administrative sanctions.
- Legislative negotiations.
- Amendments made after presentation.
- Final enacted text.
- Historical changes outside the loaded corpus.

Absence from the graph must not be interpreted as absence in reality.

---

## Retrieval limitations

Vector search returns approximate semantic matches.

A high similarity score does not prove:

- Factual support.
- Political agreement.
- Coordination.
- Shared intention.
- Causality.
- Contradiction.
- Legal equivalence.
- Ideological alignment.

Relevant evidence may be omitted because of:

- Embedding-model limitations.
- Query wording.
- Index configuration.
- Candidate limits.
- OCR errors.
- Missing documents.
- Incomplete graph relationships.
- Truncation by `MAX_EVIDENCE_ITEMS`.

Exact names, acronyms, article numbers, and initiative identifiers may perform
better with lexical or hybrid retrieval than vector retrieval alone.

---

## Score limitations

Neo4j vector scores indicate similarity under the configured vector index.
They are not probabilities and should not be displayed as confidence that a
claim is true.

Scores from different retrieval methods should not be assumed directly
comparable.

---

## Source limitations

A URL does not automatically establish that an item is a primary source.

The current implementation sets:

```python
primary_source=bool(source_url)
```

This only establishes that a URL exists. It does not verify:

- The source domain.
- Document authenticity.
- Whether the URL is official.
- Whether the content has changed.
- Whether the document is complete.
- Whether the document corresponds to the graph metadata.

Production code should determine source quality using provenance metadata and
an approved source registry.

---

## Document extraction limitations

PDF chunks may contain:

- OCR errors.
- Broken words.
- Missing tables.
- Incorrect page numbers.
- Repeated headers.
- Missing footnotes.
- Lost formatting.
- Incomplete legal citations.

A retrieved fragment should be checked against the original document before
being used for consequential claims.

---

## Language-model limitations

The LLM may:

- Misinterpret evidence.
- Omit qualifications.
- Invent unsupported relationships.
- Produce invalid JSON.
- Cite the wrong evidence item.
- Follow instructions found inside retrieved text.
- Generate different answers for the same input.
- Overvalue fluent student writing.
- Reflect social or political biases.
- Fail to preserve legal terminology.

Structured output reduces formatting failures but does not guarantee factual
correctness.

---

## Citation limitations

An `[E#]` reference proves only that the identifier was included in the
investigation.

It does not prove that:

- The cited evidence supports the claim.
- The source is authentic.
- The excerpt is complete.
- The model interpreted it correctly.
- No contradictory evidence exists.

Production deployment requires deterministic citation validation and
claim-to-evidence review.

---

## Political interpretation limitations

ÁgoraMX must not infer:

- A vote from sponsorship.
- Personal belief from party affiliation.
- Intent from similarity.
- Coordination from shared topics.
- Corruption from an allegation.
- Guilt without an official decision.
- Falsity from missing evidence.
- Legislative success from proposal status alone.

The graph describes recorded relationships. It does not reveal internal
motivation.

---

## Evaluation limitations

The Reasoning Evaluator uses an LLM-generated rubric assessment.

The score:

- Is not a psychometrically validated measure.
- Is not guaranteed to be consistent.
- May vary by model or prompt version.
- May favor certain writing styles.
- May penalize dialect or language errors.
- May fail to detect sophisticated unsupported reasoning.
- Should not determine official grades without educator review.

The score is intended as formative feedback.

---

## Session limitations

The MVP stores sessions in memory.

Consequences:

- Sessions disappear on restart.
- Multiple workers do not share sessions.
- Horizontal scaling is unsupported.
- The store provides no user ownership.
- Expiration is opportunistic.
- A valid session ID acts as a bearer secret.

Do not use the in-memory store for production student data.

---

## Security limitations

The MVP does not include:

- User authentication.
- Authorization.
- Rate limiting.
- CSRF protection for authenticated deployments.
- PII redaction.
- Prompt-injection detection.
- Citation allowlist validation.
- Persistent audit logging.
- A correction or appeal workflow.
- A full content security policy.
- Browser Markdown sanitization in the supplied code.
- Automated secret rotation.

---

## Current implementation defects

The supplied `_vector_chunks()` draft is not executable as written because it:

1. Includes two consecutive vector queries.
2. Duplicates the presenter match.
3. References `$people` without passing it.
4. Produces presenter maps that are later joined as strings.

These issues must be corrected before the retrieval behavior can be evaluated.

---

## Version sensitivity

Behavior depends on:

- Neo4j version.
- Cypher version.
- Vector-index configuration.
- Python dependencies.
- Embedding-model version.
- LLM version.
- LLM quantization.
- Prompt version.
- Graph corpus version.

A production response should include those versions for reproducibility.

---

## Not legal or official advice

ÁgoraMX does not replace:

- Official legislative records.
- Legal counsel.
- Judicial documents.
- Election authorities.
- Institutional academic assessment.
- Professional fact-checking.

Users should consult linked original documents.

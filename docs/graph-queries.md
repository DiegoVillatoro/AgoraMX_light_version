# Controlled Graph Queries

## Purpose

ÁgoraMX does not allow the language model to generate Cypher.

Every graph operation is implemented as a predefined, parameterized, read-only query. The planning agent may produce search terms and entity filters, but it cannot change query structure.

This approach reduces:

- Cypher injection risk
- Accidental writes
- Unbounded graph traversal
- Unexpected procedure calls
- Query behavior that cannot be audited

---

## Query categories

The MVP uses two primary retrieval queries:

1. Initiative vector search with graph expansion
2. Document chunk vector search

Additional read-only query templates may be added for narrowly defined research tasks.

---

## Initiative vector retrieval

The query:

1. Searches `initiative_embedding`.
2. Retrieves a larger candidate set.
3. Expands each initiative to presenters, parties, topics, provisions, laws, and documents.
4. Applies entity filters.
5. Returns a bounded result set.

Example:

```cypher
CALL db.index.vector.queryNodes(
    'initiative_embedding',
    $candidate_count,
    $embedding
)
YIELD node AS i, score

OPTIONAL MATCH (p:Person)-[pr:PRESENTED]->(i)

OPTIONAL MATCH
    (p)-[membership:MEMBER_OF_AT_PRESENTATION]->(party:Party)
WHERE membership.initiative_id = i.sil_id

OPTIONAL MATCH (i)-[:HAS_TOPIC]->(t:Topic)

OPTIONAL MATCH
    (i)-[a:AFFECTS]->(pv:Provision)-[:PART_OF]->(law:Law)

OPTIONAL MATCH (i)-[:HAS_DOCUMENT]->(d:Document)

WITH
    i,
    score,
    collect(DISTINCT {
        name: p.name,
        person_id: p.person_id,
        role: pr.role,
        party: coalesce(party.abbreviation, party.name)
    }) AS presenters,
    collect(DISTINCT {
        name: t.name,
        level: t.level
    }) AS topics,
    collect(DISTINCT {
        law: law.name,
        article: pv.article,
        fraction: pv.fraction,
        operation: a.operation
    }) AS provisions,
    collect(DISTINCT {
        url: d.url,
        filename: d.filename,
        exists_locally: d.exists_locally
    }) AS documents

WHERE
    size($people) = 0
    OR any(
        requested IN $people
        WHERE any(
            presenter IN presenters
            WHERE toLower(coalesce(presenter.name, ''))
                  CONTAINS toLower(requested)
        )
    )

RETURN
    i.sil_id AS sil_id,
    i.title AS title,
    i.summary AS summary,
    toString(i.presentation_date) AS presentation_date,
    toString(i.publication_date) AS publication_date,
    i.status AS status,
    i.source_url AS source_url,
    score,
    presenters,
    topics,
    provisions,
    documents
ORDER BY score DESC
LIMIT $result_limit
```

### Topic filtering

The current draft accepts `$topics` but does not apply it.

A controlled topic filter can be added after collection:

```cypher
AND (
    size($topics) = 0
    OR any(
        requested_topic IN $topics
        WHERE any(
            topic IN topics
            WHERE toLower(coalesce(topic.name, ''))
                  CONTAINS toLower(requested_topic)
        )
    )
)
```

The complete `WHERE` clause would become:

```cypher
WHERE
    (
        size($people) = 0
        OR any(
            requested IN $people
            WHERE any(
                presenter IN presenters
                WHERE toLower(coalesce(presenter.name, ''))
                      CONTAINS toLower(requested)
            )
        )
    )
    AND
    (
        size($topics) = 0
        OR any(
            requested_topic IN $topics
            WHERE any(
                topic IN topics
                WHERE toLower(coalesce(topic.name, ''))
                      CONTAINS toLower(requested_topic)
            )
        )
    )
```

---

## Corrected chunk vector retrieval

The original draft of `_vector_chunks()` contains two consecutive queries in the same Cypher string, a duplicated `PRESENTED` match, and a reference to `$people` without supplying the parameter.

The method should accept the people filter:

```python
def _vector_chunks(
    self,
    embedding: list[float],
    people: list[str],
) -> list[dict[str, Any]]:
```

The caller should pass it:

```python
chunk_rows = self._vector_chunks(
    embedding=embedding,
    people=plan.people,
)
```

A corrected query is:

```python
def _vector_chunks(
    self,
    embedding: list[float],
    people: list[str],
) -> list[dict[str, Any]]:
    return self._query(
        """
        CALL db.index.vector.queryNodes(
            'chunk_embedding',
            $candidate_count,
            $embedding
        )
        YIELD node AS c, score

        MATCH (d:Document)-[:HAS_CHUNK]->(c)
        MATCH (i:Initiative)-[:HAS_DOCUMENT]->(d)

        OPTIONAL MATCH (p:Person)-[:PRESENTED]->(i)
        OPTIONAL MATCH
            (p)-[membership:MEMBER_OF_AT_PRESENTATION]->(party:Party)
        WHERE membership.initiative_id = i.sil_id

        WITH
            c,
            d,
            i,
            score,
            collect(DISTINCT {
                name: p.name,
                party: coalesce(party.abbreviation, party.name)
            }) AS presenters

        WHERE
            size($people) = 0
            OR any(
                requested IN $people
                WHERE any(
                    presenter IN presenters
                    WHERE toLower(coalesce(presenter.name, ''))
                          CONTAINS toLower(requested)
                )
            )

        RETURN
            c.chunk_id AS chunk_id,
            c.text AS text,
            c.page AS page,
            c.chunk_index AS chunk_index,
            d.url AS document_url,
            d.filename AS filename,
            i.sil_id AS sil_id,
            i.title AS initiative_title,
            i.source_url AS initiative_url,
            toString(i.presentation_date) AS presentation_date,
            presenters,
            score
        ORDER BY score DESC
        LIMIT $result_limit
        """,
        candidate_count=max(
            self.max_chunk_results * 3,
            30,
        ),
        result_limit=self.max_chunk_results,
        embedding=embedding,
        people=people,
    )
```

---

## Presenter normalization

The chunk query returns presenters as maps:

```json
[
  {
    "name": "Example Person",
    "party": "ABC"
  }
]
```

The current evidence builder attempts to join the list directly:

```python
", ".join(row.get("presenters") or [])
```

That operation expects strings and will fail when the elements are dictionaries.

Use:

```python
presenter_names = [
    presenter.get("name", "")
    for presenter in row.get("presenters", [])
    if presenter.get("name")
]
```

Then:

```python
politician=", ".join(presenter_names)
```

---

## Example read-only exploration queries

These queries are examples for developers and graph administrators. They are not automatically available to the language model.

### Find initiatives presented by a person

```cypher
MATCH (p:Person)-[:PRESENTED]->(i:Initiative)
WHERE toLower(p.name) CONTAINS toLower($person_name)
RETURN
    p.name AS person,
    i.sil_id AS sil_id,
    i.title AS title,
    i.presentation_date AS presentation_date,
    i.status AS status
ORDER BY i.presentation_date DESC
LIMIT $limit
```

### Find initiatives associated with a topic

```cypher
MATCH (i:Initiative)-[:HAS_TOPIC]->(t:Topic)
WHERE toLower(t.name) CONTAINS toLower($topic)
RETURN
    i.sil_id AS sil_id,
    i.title AS title,
    t.name AS topic,
    t.level AS topic_level
ORDER BY i.presentation_date DESC
LIMIT $limit
```

### Find affected laws and provisions

```cypher
MATCH
    (i:Initiative)-[a:AFFECTS]->(p:Provision)-[:PART_OF]->(l:Law)
WHERE i.sil_id = $sil_id
RETURN
    i.title AS initiative,
    a.operation AS operation,
    l.name AS law,
    p.article AS article,
    p.fraction AS fraction
ORDER BY l.name, p.article, p.fraction
```

### Retrieve document chunks for one initiative

```cypher
MATCH
    (i:Initiative)-[:HAS_DOCUMENT]->(d:Document)
    -[:HAS_CHUNK]->(c:Chunk)
WHERE i.sil_id = $sil_id
RETURN
    d.filename AS document,
    d.url AS source_url,
    c.chunk_id AS chunk_id,
    c.page AS page,
    c.chunk_index AS chunk_index,
    c.text AS text
ORDER BY d.filename, c.chunk_index
```

### Find institutions involved in an initiative

```cypher
MATCH (i:Initiative)-[:INVOLVES]->(institution:Institution)
WHERE i.sil_id = $sil_id
RETURN
    i.title AS initiative,
    institution.name AS institution,
    institution.abbreviation AS abbreviation
ORDER BY institution.name
```

### Find initiative context

```cypher
MATCH (i:Initiative)
WHERE i.sil_id = $sil_id

OPTIONAL MATCH (i)-[:PRESENTED_IN]->(chamber:Chamber)
OPTIONAL MATCH (i)-[:BELONGS_TO]->(legislature:Legislature)
OPTIONAL MATCH (i)-[:OBTAINED_FROM]->(source:SourceSystem)

RETURN
    i.title AS initiative,
    chamber.name AS chamber,
    legislature.name AS legislature,
    source.name AS source_system
```

### Inspect similar initiatives

```cypher
MATCH
    (source:Initiative)-[r:SEMANTICALLY_SIMILAR]
    ->(target:Initiative)
WHERE source.sil_id = $sil_id
RETURN
    target.sil_id AS sil_id,
    target.title AS title,
    r.score AS similarity_score,
    r.model AS embedding_model
ORDER BY similarity_score DESC
LIMIT $limit
```

### Inspect similar people

```cypher
MATCH
    (source:Person)-[r:SEMANTICALLY_SIMILAR]
    ->(target:Person)
WHERE source.person_id = $person_id
RETURN
    target.person_id AS person_id,
    target.name AS person,
    r.score AS similarity_score
ORDER BY similarity_score DESC
LIMIT $limit
```

---

## Queries that must not be exposed

Do not provide an endpoint that accepts arbitrary Cypher such as:

```json
{
  "query": "MATCH (n) RETURN n"
}
```

Do not execute query strings produced by the LLM.

Do not use dynamic labels, relationship types, property names, or procedure names based directly on user input.

When a new research capability is needed:

1. Define its evidentiary meaning.
2. Add a bounded query template.
3. Add typed parameters.
4. Add tests.
5. Add the capability to the planning policy.
6. Document what the query can and cannot establish.

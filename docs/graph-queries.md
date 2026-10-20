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

---

## Example read-only exploration queries

These queries are examples for developers and graph administrators. They are not automatically available to the language model.

### Find initiatives presented by a person
Replace $person_name by actual name and $limit to number for test

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
Replace $topic by actual topic and $limit to number for test

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
Replace $sil_id by actual id of initiative like "5057564" for test

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
Replace $sil_id by actual id of initiative like "5057564" for test

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

### Find initiative context
Replace $sil_id by actual id of initiative like "5057564" for test

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
Replace $sil_id by actual id and $limit to number for test

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

---

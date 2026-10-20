from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal

import numpy as np
from neo4j import GraphDatabase
from sentence_transformers import SentenceTransformer

from app.config import Settings
from app.models import (
    EvidenceItem,
    GraphEdge,
    GraphNode,
    GraphSnapshot,
    QueryPlan,
)


logger = logging.getLogger("agoramx.graphrag")

PROJECT_DIR = Path(__file__).resolve().parent.parent

MODEL_NAME = (
    "sentence-transformers/"
    "paraphrase-multilingual-MiniLM-L12-v2"
)


def resolve_model_path(model_dir: str) -> Path:
    """
    Convierte MODEL_DIR en una ruta absoluta.

    Las rutas relativas se interpretan respecto a la raíz del
    proyecto, no respecto al directorio desde el cual se ejecutó
    uvicorn.
    """
    path = Path(model_dir).expanduser()

    if not path.is_absolute():
        path = PROJECT_DIR / path

    return path.resolve()


def load_embedding_model(
    configured_model_dir: str,
) -> SentenceTransformer:
    """
    Carga el modelo local si existe.

    Si todavía no existe:
    1. Lo descarga.
    2. Lo guarda en MODEL_DIR.
    3. Devuelve el modelo cargado.
    """
    model_path = resolve_model_path(configured_model_dir)
    modules_file = model_path / "modules.json"

    if modules_file.is_file():
        logger.info(
            "Cargando modelo de embeddings desde %s",
            model_path,
        )

        return SentenceTransformer(
            str(model_path),
            local_files_only=True,
        )

    logger.warning(
        "No se encontró el modelo local en %s.",
        model_path,
    )
    logger.info(
        "Descargando modelo de embeddings: %s",
        MODEL_NAME,
    )

    try:
        model = SentenceTransformer(
            MODEL_NAME,
            trust_remote_code=False,
        )
    except Exception as exc:
        raise RuntimeError(
            "No fue posible encontrar el modelo local ni "
            "descargarlo.\n"
            f"Ruta local esperada: {model_path}\n"
            f"Modelo remoto: {MODEL_NAME}\n"
            "Verifica tu conexión a Internet o configura "
            "MODEL_DIR con una ruta válida."
        ) from exc

    model_path.mkdir(
        parents=True,
        exist_ok=True,
    )

    model.save(str(model_path))

    logger.info(
        "Modelo guardado en %s",
        model_path,
    )

    return model


class ReadOnlyGraphRAG:
    """
    Acceso exclusivamente de lectura.

    No se permite al LLM generar Cypher. Todas las consultas son
    plantillas controladas por la aplicación.
    """

    def __init__(self, settings: Settings):
        self.driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(
                settings.neo4j_user,
                settings.neo4j_password,
            ),
        )

        self.database = settings.neo4j_database

        self.max_graph_results = (
            settings.max_graph_results
        )
        self.max_chunk_results = (
            settings.max_chunk_results
        )
        self.max_evidence_items = (
            settings.max_evidence_items
        )

        self.model_path = resolve_model_path(
            settings.model_dir,
        )

        self.embedding_model = load_embedding_model(
            settings.model_dir,
        )

    def close(self) -> None:
        self.driver.close()

    def verify(self) -> None:
        self.driver.verify_connectivity()

    def _query(
        self,
        cypher: str,
        **parameters: Any,
    ) -> list[dict[str, Any]]:
        """
        Ejecuta una consulta parametrizada en modo de solo lectura.
        """
        with self.driver.session(
            database=self.database,
            default_access_mode="READ",
        ) as session:
            result = session.run(
                cypher,
                **parameters,
            )

            return [
                record.data()
                for record in result
            ]

    def embed(self, text: str) -> list[float]:
        """
        Genera un embedding normalizado para la consulta.
        """
        normalized_text = text.strip()

        if not normalized_text:
            raise ValueError(
                "No se puede generar un embedding "
                "para una consulta vacía."
            )

        vector = self.embedding_model.encode(
            [normalized_text],
            normalize_embeddings=True,
            convert_to_numpy=True,
        )[0]

        return np.asarray(
            vector,
            dtype=np.float32,
        ).tolist()

    def retrieve(
        self,
        plan: QueryPlan,
    ) -> list[EvidenceItem]:
        retrieval_query = plan.retrieval_query.strip()

        if not retrieval_query:
            retrieval_query = plan.normalized_question.strip()

        if not retrieval_query:
            raise ValueError(
                "El plan no contiene una consulta de recuperación."
            )

        embedding = self.embed(retrieval_query)

        people = [
            value.strip()
            for value in plan.people
            if value and value.strip()
        ]

        topics = [
            value.strip()
            for value in plan.topics
            if value and value.strip()
        ]

        logger.info(
            "Recuperando evidencia. people=%s topics=%s query=%r",
            people,
            topics,
            retrieval_query,
        )

        initiative_rows = self._vector_initiatives(
            embedding=embedding,
            people=people,
            topics=topics,
        )

        chunk_rows = self._vector_chunks(
            embedding=embedding,
            people=people,
            topics=topics,
        )

        logger.info(
            "Neo4j devolvió %d iniciativas y %d fragmentos.",
            len(initiative_rows),
            len(chunk_rows),
        )

        evidence = self._build_evidence(
            initiatives=initiative_rows,
            chunks=chunk_rows,
        )

        logger.info(
            "Se construyeron %d elementos de evidencia.",
            len(evidence),
        )

        return evidence[:self.max_evidence_items]

    def _vector_initiatives(
        self,
        embedding: list[float],
        people: list[str],
        topics: list[str],
    ) -> list[dict[str, Any]]:
        candidate_count = max(
            self.max_graph_results * 10,
            100,
        )

        return self._query(
            """
            CALL db.index.vector.queryNodes(
                'initiative_embedding',
                $candidate_count,
                $embedding
            )
            YIELD node AS initiative, score AS vector_score

            OPTIONAL MATCH
                (person:Person)-[
                    presentation:PRESENTED
                ]->(initiative)

            OPTIONAL MATCH
                (person)-[
                    membership:MEMBER_OF_AT_PRESENTATION
                ]->(party:Party)
            WHERE
                membership.initiative_id = initiative.sil_id

            OPTIONAL MATCH
                (initiative)-[:HAS_TOPIC]->(topic:Topic)

            OPTIONAL MATCH
                (initiative)-[
                    affects:AFFECTS
                ]->(provision:Provision)
                -[:PART_OF]->(law:Law)

            OPTIONAL MATCH
                (initiative)-[:HAS_DOCUMENT]->(document:Document)

            WITH
                initiative,
                vector_score,

                [
                    item IN collect(
                        DISTINCT {
                            name: person.name,
                            person_id: person.person_id,
                            role: presentation.role,
                            party_id: party.party_id,
                            party: party.name,
                            party_abbreviation:
                                party.abbreviation
                        }
                    )
                    WHERE item.name IS NOT NULL
                ] AS presenters,

                [
                    item IN collect(
                        DISTINCT {
                            topic_id: topic.topic_id,
                            name: topic.name,
                            level: topic.level
                        }
                    )
                    WHERE item.name IS NOT NULL
                ] AS topics,

                [
                    item IN collect(
                        DISTINCT {
                            provision_id:
                                provision.provision_id,
                            law_id: law.law_id,
                            law: law.name,
                            article: provision.article,
                            fraction: provision.fraction,
                            operation: affects.operation
                        }
                    )
                    WHERE
                        item.law IS NOT NULL
                        OR item.article IS NOT NULL
                        OR item.fraction IS NOT NULL
                ] AS provisions,

                [
                    item IN collect(
                        DISTINCT {
                            document_id:
                                document.document_id,
                            url: document.url,
                            local_path:
                                document.local_path,
                            filename: document.filename,
                            exists_locally:
                                document.exists_locally,
                            chunk_count:
                                document.chunk_count
                        }
                    )
                    WHERE item.document_id IS NOT NULL
                ] AS documents

            WITH
                initiative,
                vector_score,
                presenters,
                topics,
                provisions,
                documents,

                CASE
                    WHEN size($people) = 0
                    THEN false
                    ELSE any(
                        requested IN $people
                        WHERE any(
                            presenter IN presenters
                            WHERE
                                toLower(
                                    coalesce(
                                        presenter.name,
                                        ''
                                    )
                                ) CONTAINS toLower(requested)
                                OR
                                toLower(requested) CONTAINS
                                toLower(
                                    coalesce(
                                        presenter.name,
                                        ''
                                    )
                                )
                        )
                    )
                END AS person_match,

                CASE
                    WHEN size($topics) = 0
                    THEN false
                    ELSE any(
                        requested IN $topics
                        WHERE any(
                            topic_item IN topics
                            WHERE
                                toLower(
                                    coalesce(
                                        topic_item.name,
                                        ''
                                    )
                                ) CONTAINS toLower(requested)
                                OR
                                toLower(requested) CONTAINS
                                toLower(
                                    coalesce(
                                        topic_item.name,
                                        ''
                                    )
                                )
                        )
                    )
                END AS topic_match

            WITH
                initiative,
                vector_score,
                presenters,
                topics,
                provisions,
                documents,
                person_match,
                topic_match,

                vector_score
                + CASE
                    WHEN person_match THEN 0.03
                    ELSE 0.0
                END
                + CASE
                    WHEN topic_match THEN 0.03
                    ELSE 0.0
                END AS retrieval_score

            RETURN
                initiative.sil_id AS sil_id,
                initiative.title AS title,
                initiative.summary AS summary,

                toString(
                    initiative.presentation_date
                ) AS presentation_date,

                toString(
                    initiative.publication_date
                ) AS publication_date,

                initiative.status AS status,
                initiative.source_url AS source_url,

                vector_score,
                retrieval_score AS score,
                person_match,
                topic_match,

                presenters,
                topics,
                provisions,
                documents

            ORDER BY retrieval_score DESC
            LIMIT $result_limit
            """,
            candidate_count=candidate_count,
            result_limit=self.max_graph_results,
            embedding=embedding,
            people=people,
            topics=topics,
        )

    def _vector_chunks(
        self,
        embedding: list[float],
        people: list[str],
        topics: list[str],
    ) -> list[dict[str, Any]]:
        candidate_count = max(
            self.max_chunk_results * 10,
            100,
        )

        return self._query(
            """
            CALL db.index.vector.queryNodes(
                'chunk_embedding',
                $candidate_count,
                $embedding
            )
            YIELD node AS chunk, score AS vector_score

            MATCH
                (document:Document)-[:HAS_CHUNK]->(chunk)

            MATCH
                (initiative:Initiative)
                -[:HAS_DOCUMENT]->(document)

            OPTIONAL MATCH
                (person:Person)-[
                    presentation:PRESENTED
                ]->(initiative)

            OPTIONAL MATCH
                (person)-[
                    membership:MEMBER_OF_AT_PRESENTATION
                ]->(party:Party)
            WHERE
                membership.initiative_id = initiative.sil_id

            OPTIONAL MATCH
                (initiative)-[:HAS_TOPIC]->(topic:Topic)

            WITH
                chunk,
                document,
                initiative,
                vector_score,

                [
                    item IN collect(
                        DISTINCT {
                            name: person.name,
                            person_id: person.person_id,
                            role: presentation.role,
                            party_id: party.party_id,
                            party: party.name,
                            party_abbreviation:
                                party.abbreviation
                        }
                    )
                    WHERE item.name IS NOT NULL
                ] AS presenters,

                [
                    item IN collect(
                        DISTINCT {
                            topic_id: topic.topic_id,
                            name: topic.name,
                            level: topic.level
                        }
                    )
                    WHERE item.name IS NOT NULL
                ] AS topics

            WITH
                chunk,
                document,
                initiative,
                vector_score,
                presenters,
                topics,

                CASE
                    WHEN size($people) = 0
                    THEN false
                    ELSE any(
                        requested IN $people
                        WHERE any(
                            presenter IN presenters
                            WHERE
                                toLower(
                                    coalesce(
                                        presenter.name,
                                        ''
                                    )
                                ) CONTAINS toLower(requested)
                                OR
                                toLower(requested) CONTAINS
                                toLower(
                                    coalesce(
                                        presenter.name,
                                        ''
                                    )
                                )
                        )
                    )
                END AS person_match,

                CASE
                    WHEN size($topics) = 0
                    THEN false
                    ELSE any(
                        requested IN $topics
                        WHERE any(
                            topic_item IN topics
                            WHERE
                                toLower(
                                    coalesce(
                                        topic_item.name,
                                        ''
                                    )
                                ) CONTAINS toLower(requested)
                                OR
                                toLower(requested) CONTAINS
                                toLower(
                                    coalesce(
                                        topic_item.name,
                                        ''
                                    )
                                )
                        )
                    )
                END AS topic_match

            WITH
                chunk,
                document,
                initiative,
                vector_score,
                presenters,
                topics,
                person_match,
                topic_match,

                vector_score
                + CASE
                    WHEN person_match THEN 0.03
                    ELSE 0.0
                END
                + CASE
                    WHEN topic_match THEN 0.03
                    ELSE 0.0
                END AS retrieval_score

            RETURN
                chunk.chunk_id AS chunk_id,
                chunk.text AS text,
                chunk.page AS page,
                chunk.chunk_index AS chunk_index,

                document.document_id AS document_id,
                document.url AS document_url,
                document.local_path AS local_path,
                document.filename AS filename,

                initiative.sil_id AS sil_id,
                initiative.title AS initiative_title,
                initiative.source_url AS initiative_url,

                toString(
                    initiative.presentation_date
                ) AS presentation_date,

                vector_score,
                retrieval_score AS score,
                person_match,
                topic_match,

                presenters,
                topics

            ORDER BY retrieval_score DESC
            LIMIT $result_limit
            """,
            candidate_count=candidate_count,
            result_limit=self.max_chunk_results,
            embedding=embedding,
            people=people,
            topics=topics,
        )

    @staticmethod
    def _presenter_names(
        presenters: Any,
    ) -> list[str]:
        if not isinstance(presenters, list):
            return []

        output: list[str] = []

        for presenter in presenters:
            if isinstance(presenter, str):
                name = presenter.strip()
            elif isinstance(presenter, dict):
                name = str(
                    presenter.get("name") or ""
                ).strip()
            else:
                name = ""

            if name and name not in output:
                output.append(name)

        return output


    @staticmethod
    def _topic_names(
        topics: Any,
    ) -> list[str]:
        if not isinstance(topics, list):
            return []

        output: list[str] = []

        for topic in topics:
            if isinstance(topic, str):
                name = topic.strip()
            elif isinstance(topic, dict):
                name = str(
                    topic.get("name") or ""
                ).strip()
            else:
                name = ""

            if name and name not in output:
                output.append(name)

        return output

    @staticmethod
    def _extract_presenter_names(
        presenters: Any,
    ) -> list[str]:
        """
        Convierte la colección de presentadores devuelta por
        Neo4j en una lista de nombres.

        Tolera tanto diccionarios como cadenas para evitar errores
        al construir EvidenceItem.
        """
        if not isinstance(presenters, list):
            return []

        names: list[str] = []

        for presenter in presenters:
            if isinstance(presenter, str):
                name = presenter.strip()
            elif isinstance(presenter, dict):
                name = str(
                    presenter.get("name") or ""
                ).strip()
            else:
                name = ""

            if name and name not in names:
                names.append(name)

        return names

    @staticmethod
    def _extract_topic_names(
        topics: Any,
    ) -> list[str]:
        """
        Convierte la colección de temas en nombres únicos.
        """
        if not isinstance(topics, list):
            return []

        names: list[str] = []

        for topic in topics:
            if isinstance(topic, str):
                name = topic.strip()
            elif isinstance(topic, dict):
                name = str(
                    topic.get("name") or ""
                ).strip()
            else:
                name = ""

            if name and name not in names:
                names.append(name)

        return names

    @staticmethod
    def _format_provisions(
        provisions: Any,
    ) -> list[str]:
        """
        Convierte las disposiciones afectadas en etiquetas
        legibles.
        """
        if not isinstance(provisions, list):
            return []

        output: list[str] = []

        for provision in provisions:
            if not isinstance(provision, dict):
                continue

            operation = str(
                provision.get("operation") or ""
            ).strip()

            law = str(
                provision.get("law") or ""
            ).strip()

            article = str(
                provision.get("article") or ""
            ).strip()

            fraction = str(
                provision.get("fraction") or ""
            ).strip()

            parts = [
                operation,
                law,
                f"artículo {article}" if article else "",
                f"fracción {fraction}" if fraction else "",
            ]

            label = " ".join(
                part
                for part in parts
                if part
            ).strip()

            if label and label not in output:
                output.append(label)

        return output

    @staticmethod
    def _normalize_documents(
        documents: Any,
    ) -> list[dict[str, Any]]:
        """
        Elimina documentos vacíos y duplicados.
        """
        if not isinstance(documents, list):
            return []

        output: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()

        for document in documents:
            if not isinstance(document, dict):
                continue

            url = str(
                document.get("url") or ""
            ).strip()

            filename = str(
                document.get("filename") or ""
            ).strip()

            if not url and not filename:
                continue

            identity = (
                url,
                filename,
            )

            if identity in seen:
                continue

            seen.add(identity)

            output.append(
                {
                    "url": url,
                    "filename": filename,
                    "exists_locally": document.get(
                        "exists_locally"
                    ),
                }
            )

        return output
    @staticmethod
    def _deduplicate_evidence(
        evidence: list[EvidenceItem],
    ) -> list[EvidenceItem]:
        output: list[EvidenceItem] = []
        seen: set[tuple[str, str]] = set()

        for item in evidence:
            if item.kind == "initiative":
                identity = (
                    "initiative",
                    item.sil_id
                    or item.title.strip().lower(),
                )
            else:
                chunk_identity = str(
                    item.metadata.get("chunk_id")
                    or (
                        f"{item.sil_id}:"
                        f"{item.metadata.get('chunk_index')}:"
                        f"{item.page}"
                    )
                )

                identity = (
                    "document_chunk",
                    chunk_identity,
                )

            if identity in seen:
                continue

            seen.add(identity)
            output.append(item)

        return output

    @classmethod
    def _build_evidence(
        cls,
        initiatives: list[dict[str, Any]],
        chunks: list[dict[str, Any]],
    ) -> list[EvidenceItem]:
        output: list[EvidenceItem] = []

        for row in initiatives:
            presenter_names = cls._presenter_names(
                row.get("presenters"),
            )

            topic_names = cls._topic_names(
                row.get("topics"),
            )

            provisions: list[str] = []

            for item in row.get("provisions") or []:
                if not isinstance(item, dict):
                    continue

                parts = [
                    str(
                        item.get("operation") or ""
                    ).strip(),
                    str(
                        item.get("law") or ""
                    ).strip(),
                    (
                        f"artículo {item.get('article')}"
                        if item.get("article")
                        else ""
                    ),
                    (
                        f"fracción {item.get('fraction')}"
                        if item.get("fraction")
                        else ""
                    ),
                ]

                provision = " ".join(
                    part
                    for part in parts
                    if part
                ).strip()

                if (
                    provision
                    and provision not in provisions
                ):
                    provisions.append(provision)

            documents = [
                document
                for document in (
                    row.get("documents") or []
                )
                if (
                    isinstance(document, dict)
                    and document.get("document_id")
                )
            ]

            excerpt_parts = [
                str(row.get("summary") or "").strip(),
                (
                    f"Temas: {', '.join(topic_names)}."
                    if topic_names
                    else ""
                ),
                (
                    "Disposiciones afectadas: "
                    + "; ".join(provisions)
                    + "."
                    if provisions
                    else ""
                ),
                (
                    "Promoventes: "
                    + ", ".join(presenter_names)
                    + "."
                    if presenter_names
                    else ""
                ),
                (
                    f"Estado: {row.get('status')}."
                    if row.get("status")
                    else ""
                ),
            ]

            excerpt = "\n".join(
                part
                for part in excerpt_parts
                if part
            )

            source_url = str(
                row.get("source_url") or ""
            ).strip()

            output.append(
                EvidenceItem(
                    evidence_id="",
                    kind="initiative",
                    title=(
                        row.get("title")
                        or "Iniciativa"
                    ),
                    excerpt=excerpt[:4000],
                    source_url=source_url,
                    source_label="Registro legislativo",
                    sil_id=str(
                        row.get("sil_id") or ""
                    ),
                    politician=", ".join(
                        presenter_names
                    ),
                    date=str(
                        row.get("presentation_date")
                        or row.get("publication_date")
                        or ""
                    ),
                    score=float(
                        row.get("score") or 0.0
                    ),
                    primary_source=bool(source_url),
                    direct_support=True,
                    metadata={
                        "status": row.get("status"),
                        "topics": topic_names,
                        "provisions": provisions,
                        "documents": documents,
                        "presenters": (
                            row.get("presenters") or []
                        ),
                        "vector_score": row.get(
                            "vector_score"
                        ),
                        "person_match": row.get(
                            "person_match"
                        ),
                        "topic_match": row.get(
                            "topic_match"
                        ),
                    },
                )
            )

        for row in chunks:
            presenter_names = cls._presenter_names(
                row.get("presenters"),
            )

            topic_names = cls._topic_names(
                row.get("topics"),
            )

            document_url = str(
                row.get("document_url") or ""
            ).strip()

            initiative_url = str(
                row.get("initiative_url") or ""
            ).strip()

            source_url = (
                document_url
                or initiative_url
            )

            filename = str(
                row.get("filename") or ""
            ).strip()

            output.append(
                EvidenceItem(
                    evidence_id="",
                    kind="document_chunk",
                    title=(
                        row.get("initiative_title")
                        or filename
                        or "Fragmento documental"
                    ),
                    excerpt=str(
                        row.get("text") or ""
                    )[:5000],
                    source_url=source_url,
                    source_label=(
                        filename
                        or "Documento legislativo"
                    ),
                    sil_id=str(
                        row.get("sil_id") or ""
                    ),
                    politician=", ".join(
                        presenter_names
                    ),
                    date=str(
                        row.get("presentation_date")
                        or ""
                    ),
                    page=row.get("page"),
                    score=float(
                        row.get("score") or 0.0
                    ),
                    primary_source=bool(source_url),
                    direct_support=True,
                    metadata={
                        "chunk_id": row.get(
                            "chunk_id"
                        ),
                        "chunk_index": row.get(
                            "chunk_index"
                        ),
                        "document_id": row.get(
                            "document_id"
                        ),
                        "document_url": document_url,
                        "initiative_url": initiative_url,
                        "topics": topic_names,
                        "presenters": (
                            row.get("presenters") or []
                        ),
                        "vector_score": row.get(
                            "vector_score"
                        ),
                        "person_match": row.get(
                            "person_match"
                        ),
                        "topic_match": row.get(
                            "topic_match"
                        ),
                    },
                )
            )

        output = cls._deduplicate_evidence(
            output,
        )

        output.sort(
            key=lambda item: (
                item.direct_support,
                item.primary_source,
                item.score,
            ),
            reverse=True,
        )

        for index, item in enumerate(
            output,
            start=1,
        ):
            item.evidence_id = f"E{index}"

        return output

    @staticmethod
    def _deduplicate_evidence(
        evidence: list[EvidenceItem],
    ) -> list[EvidenceItem]:
        """
        Evita repetir iniciativas o fragmentos recuperados.
        """
        output: list[EvidenceItem] = []
        seen: set[tuple[str, str]] = set()

        for item in evidence:
            if item.kind == "initiative":
                identity_value = (
                    item.sil_id
                    or item.title.strip().lower()
                )
            else:
                identity_value = str(
                    item.metadata.get("chunk_id")
                    or (
                        f"{item.sil_id}:"
                        f"{item.metadata.get('chunk_index')}:"
                        f"{item.page}"
                    )
                )

            identity = (
                item.kind,
                identity_value,
            )

            if identity in seen:
                continue

            seen.add(identity)
            output.append(item)

        return output

    def capabilities(self) -> dict[str, list[str]]:
        return {
            "available": [
                "Buscar iniciativas por similitud semántica.",
                "Relacionar iniciativas con promoventes.",
                "Identificar temas de las iniciativas.",
                (
                    "Consultar leyes, artículos y fracciones "
                    "afectadas."
                ),
                "Recuperar fragmentos de documentos PDF.",
                "Examinar similitud entre iniciativas.",
                (
                    "Examinar similitud temática entre "
                    "promoventes."
                ),
            ],
            "unavailable": [
                (
                    "Confirmar votaciones nominales "
                    "individuales."
                ),
                "Confirmar asistencia legislativa.",
                (
                    "Evaluar declaraciones públicas "
                    "o entrevistas."
                ),
                (
                    "Verificar publicaciones de redes "
                    "sociales."
                ),
                (
                    "Confirmar acusaciones o procesos "
                    "judiciales."
                ),
                (
                    "Consultar noticias externas en "
                    "tiempo real."
                ),
                (
                    "Determinar por sí solo corrupción, "
                    "culpabilidad o intención política."
                ),
            ],
        }

    @staticmethod
    def build_graph_snapshot(
        evidence: list[EvidenceItem],
    ) -> GraphSnapshot:
        """
        Construye una representación visual derivada únicamente
        de la evidencia recuperada.
        """
        nodes: dict[str, GraphNode] = {}
        edges: dict[str, GraphEdge] = {}

        def add_node(
            node_id: str,
            label: str,
            node_type: Literal[
                "initiative",
                "person",
                "topic",
                "law",
                "document",
            ],
            evidence_id: str,
            metadata: dict[str, Any] | None = None,
        ) -> None:
            normalized_id = node_id.strip()
            normalized_label = label.strip()

            if not normalized_id or not normalized_label:
                return

            if normalized_id not in nodes:
                nodes[normalized_id] = GraphNode(
                    id=normalized_id,
                    label=normalized_label,
                    node_type=node_type,
                    evidence_ids=[evidence_id],
                    metadata=metadata or {},
                )
                return

            existing_node = nodes[normalized_id]

            if evidence_id not in existing_node.evidence_ids:
                existing_node.evidence_ids.append(
                    evidence_id
                )

            if metadata:
                for key, value in metadata.items():
                    if (
                        value is not None
                        and value != ""
                    ):
                        existing_node.metadata[key] = value

        def add_edge(
            source: str,
            target: str,
            relationship: str,
            evidence_id: str,
        ) -> None:
            if not source or not target:
                return

            edge_id = (
                f"{source}|{relationship}|{target}"
            )

            if edge_id not in edges:
                edges[edge_id] = GraphEdge(
                    source=source,
                    target=target,
                    relationship=relationship,
                    evidence_ids=[evidence_id],
                )
                return

            if (
                evidence_id
                not in edges[edge_id].evidence_ids
            ):
                edges[edge_id].evidence_ids.append(
                    evidence_id
                )

        for item in evidence:
            initiative_key = (
                item.sil_id.strip()
                or item.title.strip().lower()
            )

            initiative_id = (
                f"initiative:{initiative_key}"
            )

            if item.kind == "initiative":
                add_node(
                    node_id=initiative_id,
                    label=item.title,
                    node_type="initiative",
                    evidence_id=item.evidence_id,
                    metadata={
                        "sil_id": item.sil_id,
                        "date": item.date,
                        "score": item.score,
                        "source_url": item.source_url,
                        "status": item.metadata.get(
                            "status"
                        ),
                    },
                )

                presenters_metadata = (
                    item.metadata.get("presenters")
                )

                if isinstance(
                    presenters_metadata,
                    list,
                ):
                    presenters = [
                        presenter
                        for presenter in presenters_metadata
                        if isinstance(presenter, dict)
                        and presenter.get("name")
                    ]
                else:
                    presenters = [
                        {
                            "name": value.strip(),
                        }
                        for value in item.politician.split(",")
                        if value.strip()
                    ]

                for presenter in presenters:
                    presenter_name = str(
                        presenter.get("name") or ""
                    ).strip()

                    if not presenter_name:
                        continue

                    person_key = str(
                        presenter.get("person_id")
                        or presenter_name.lower()
                    ).strip()

                    person_id = f"person:{person_key}"

                    add_node(
                        node_id=person_id,
                        label=presenter_name,
                        node_type="person",
                        evidence_id=item.evidence_id,
                        metadata={
                            "party": presenter.get(
                                "party"
                            ),
                            "role": presenter.get(
                                "role"
                            ),
                            "institution": presenter.get(
                                "institution"
                            ),
                        },
                    )

                    add_edge(
                        source=person_id,
                        target=initiative_id,
                        relationship="PRESENTÓ",
                        evidence_id=item.evidence_id,
                    )

                for topic in item.metadata.get(
                    "topics",
                    [],
                ):
                    topic_name = str(topic).strip()

                    if not topic_name:
                        continue

                    topic_id = (
                        f"topic:{topic_name.lower()}"
                    )

                    add_node(
                        node_id=topic_id,
                        label=topic_name,
                        node_type="topic",
                        evidence_id=item.evidence_id,
                    )

                    add_edge(
                        source=initiative_id,
                        target=topic_id,
                        relationship="TRATA SOBRE",
                        evidence_id=item.evidence_id,
                    )

                for provision in item.metadata.get(
                    "provisions",
                    [],
                ):
                    provision_label = str(
                        provision
                    ).strip()

                    if not provision_label:
                        continue

                    law_id = (
                        f"law:{provision_label.lower()}"
                    )

                    add_node(
                        node_id=law_id,
                        label=provision_label,
                        node_type="law",
                        evidence_id=item.evidence_id,
                    )

                    add_edge(
                        source=initiative_id,
                        target=law_id,
                        relationship="AFECTA",
                        evidence_id=item.evidence_id,
                    )

                for document in item.metadata.get(
                    "documents",
                    [],
                ):
                    if not isinstance(document, dict):
                        continue

                    filename = str(
                        document.get("filename") or ""
                    ).strip()

                    url = str(
                        document.get("url") or ""
                    ).strip()

                    document_key = (
                        filename
                        or url
                    )

                    if not document_key:
                        continue

                    document_id = (
                        "document:"
                        + document_key.lower()
                    )

                    add_node(
                        node_id=document_id,
                        label=(
                            filename
                            or "Documento legislativo"
                        ),
                        node_type="document",
                        evidence_id=item.evidence_id,
                        metadata={
                            "url": url,
                            "exists_locally": (
                                document.get(
                                    "exists_locally"
                                )
                            ),
                        },
                    )

                    add_edge(
                        source=initiative_id,
                        target=document_id,
                        relationship="TIENE DOCUMENTO",
                        evidence_id=item.evidence_id,
                    )

            elif item.kind == "document_chunk":
                add_node(
                    node_id=initiative_id,
                    label=item.title,
                    node_type="initiative",
                    evidence_id=item.evidence_id,
                    metadata={
                        "sil_id": item.sil_id,
                        "date": item.date,
                    },
                )

                document_url = str(
                    item.metadata.get(
                        "document_url"
                    )
                    or item.source_url
                    or ""
                ).strip()

                document_label = (
                    item.source_label
                    or "Documento legislativo"
                )

                document_key = (
                    document_url
                    or document_label.lower()
                )

                document_id = (
                    f"document:{document_key}"
                )

                add_node(
                    node_id=document_id,
                    label=document_label,
                    node_type="document",
                    evidence_id=item.evidence_id,
                    metadata={
                        "url": document_url,
                        "page": item.page,
                        "chunk_id": item.metadata.get(
                            "chunk_id"
                        ),
                    },
                )

                add_edge(
                    source=initiative_id,
                    target=document_id,
                    relationship="TIENE FRAGMENTO",
                    evidence_id=item.evidence_id,
                )

        return GraphSnapshot(
            nodes=list(nodes.values()),
            edges=list(edges.values()),
        )
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal

import numpy as np
from neo4j import GraphDatabase, READ_ACCESS
from neo4j.exceptions import Neo4jError
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

# La raíz del proyecto es el directorio padre de app/.
PROJECT_DIR = Path(__file__).resolve().parent.parent

MODEL_NAME = (
    "sentence-transformers/"
    "paraphrase-multilingual-MiniLM-L12-v2"
)

INITIATIVE_VECTOR_INDEX = "initiative_embedding"
CHUNK_VECTOR_INDEX = "chunk_embedding"

SUPPORTED_NODE_TYPES = {
    "initiative",
    "person",
    "topic",
    "law",
    "document",
}


# ============================================================
# Modelo de embeddings
# ============================================================


def resolve_model_path(model_dir: str) -> Path:
    """
    Convierte MODEL_DIR en una ruta absoluta.

    Las rutas relativas se interpretan respecto a la raíz del
    proyecto, independientemente del directorio desde el cual se
    ejecute uvicorn.

    Ejemplos:

    MODEL_DIR=./models/model-name
        -> <proyecto>/models/model-name

    MODEL_DIR=./app/models/model-name
        -> <proyecto>/app/models/model-name
    """
    path = Path(model_dir).expanduser()

    if not path.is_absolute():
        path = PROJECT_DIR / path

    return path.resolve()


def load_embedding_model(
    configured_model_dir: str,
) -> SentenceTransformer:
    """
    Carga el modelo local configurado.

    Si no existe:
    1. Descarga el modelo oficial configurado en MODEL_NAME.
    2. Lo guarda en MODEL_DIR.
    3. Devuelve el modelo cargado.

    La aplicación debe utilizar el mismo modelo y dimensión que
    fueron usados para crear los embeddings de Neo4j.
    """
    model_path = resolve_model_path(
        configured_model_dir
    )

    modules_file = model_path / "modules.json"

    if modules_file.is_file():
        logger.info(
            "Cargando modelo local de embeddings desde %s",
            model_path,
        )

        return SentenceTransformer(
            str(model_path),
            local_files_only=True,
            trust_remote_code=False,
        )

    logger.warning(
        "No se encontró un modelo local válido en %s.",
        model_path,
    )
    logger.info(
        "Descargando modelo de embeddings %s.",
        MODEL_NAME,
    )

    try:
        model = SentenceTransformer(
            MODEL_NAME,
            trust_remote_code=False,
        )
    except Exception as exc:
        raise RuntimeError(
            "No fue posible cargar el modelo de embeddings.\n"
            f"Ruta local esperada: {model_path}\n"
            f"Modelo remoto: {MODEL_NAME}\n"
            "Verifica MODEL_DIR, la conexión a Internet y las "
            "dependencias de sentence-transformers."
        ) from exc

    model_path.mkdir(
        parents=True,
        exist_ok=True,
    )

    model.save(str(model_path))

    logger.info(
        "Modelo de embeddings guardado en %s.",
        model_path,
    )

    return model


# ============================================================
# Cliente GraphRAG
# ============================================================


class ReadOnlyGraphRAG:
    """
    Recuperador GraphRAG exclusivamente de lectura.

    El LLM nunca genera ni ejecuta Cypher. Todas las consultas
    están definidas por la aplicación y todos los valores externos
    se envían como parámetros.

    El recuperador combina:

    - Similitud vectorial de iniciativas.
    - Similitud vectorial de fragmentos documentales.
    - Expansión controlada de relaciones del grafo.
    - Bonificaciones pequeñas por persona, tema y ley.
    - Contexto de relaciones semánticas preexistentes.
    """

    def __init__(
        self,
        settings: Settings,
    ):
        self.driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(
                settings.neo4j_user,
                settings.neo4j_password,
            ),
        )

        self.database = settings.neo4j_database

        self.max_graph_results = max(
            1,
            settings.max_graph_results,
        )
        self.max_chunk_results = max(
            1,
            settings.max_chunk_results,
        )
        self.max_evidence_items = max(
            1,
            settings.max_evidence_items,
        )

        self.model_path = resolve_model_path(
            settings.model_dir
        )

        self.embedding_model = load_embedding_model(
            settings.model_dir
        )

        model_dimension = (
            self.embedding_model.get_sentence_embedding_dimension()
        )

        if model_dimension is None:
            raise RuntimeError(
                "No fue posible determinar la dimensión del "
                "modelo de embeddings."
            )

        self.embedding_dimension = int(
            model_dimension
        )

    # --------------------------------------------------------
    # Ciclo de vida
    # --------------------------------------------------------

    def close(self) -> None:
        self.driver.close()

    def verify(self) -> None:
        """
        Verifica:

        - Conectividad con Neo4j.
        - Existencia de ambos índices vectoriales.
        - Estado ONLINE.
        - Compatibilidad de dimensión cuando Neo4j la expone.
        - Compatibilidad del modelo declarado en los nodos.
        """
        self.driver.verify_connectivity()
        self._verify_vector_indexes()
        self._verify_embedding_models()

    # --------------------------------------------------------
    # Ejecución segura
    # --------------------------------------------------------

    def _query(
        self,
        cypher: str,
        **parameters: Any,
    ) -> list[dict[str, Any]]:
        """
        Ejecuta una consulta dentro de una transacción READ.

        Aunque las consultas de este archivo no contienen
        operaciones de escritura, READ_ACCESS agrega una segunda
        barrera en el driver.
        """

        def run_read(
            transaction: Any,
        ) -> list[dict[str, Any]]:
            result = transaction.run(
                cypher,
                **parameters,
            )

            return [
                record.data()
                for record in result
            ]

        try:
            with self.driver.session(
                database=self.database,
                default_access_mode=READ_ACCESS,
            ) as session:
                return session.execute_read(
                    run_read
                )
        except Neo4jError:
            logger.exception(
                "Falló una consulta GraphRAG de solo lectura."
            )
            raise

    # --------------------------------------------------------
    # Verificación de índices y embeddings
    # --------------------------------------------------------

    def _verify_vector_indexes(self) -> None:
        expected = {
            INITIATIVE_VECTOR_INDEX,
            CHUNK_VECTOR_INDEX,
        }

        rows = self._query(
            """
            SHOW VECTOR INDEXES
            YIELD
                name,
                state,
                labelsOrTypes,
                properties,
                options
            WHERE name IN $index_names
            RETURN
                name,
                state,
                labelsOrTypes,
                properties,
                options
            """,
            index_names=sorted(expected),
        )

        found = {
            str(row.get("name"))
            for row in rows
        }

        missing = expected - found

        if missing:
            raise RuntimeError(
                "No se encontraron los índices vectoriales "
                "requeridos: "
                + ", ".join(sorted(missing))
            )

        for row in rows:
            name = str(
                row.get("name") or ""
            )

            state = str(
                row.get("state") or ""
            ).upper()

            if state != "ONLINE":
                raise RuntimeError(
                    f"El índice vectorial {name!r} no está "
                    f"ONLINE. Estado actual: {state or 'desconocido'}."
                )

            configured_dimension = (
                self._extract_index_dimension(
                    row.get("options")
                )
            )

            if (
                configured_dimension is not None
                and configured_dimension
                != self.embedding_dimension
            ):
                raise RuntimeError(
                    f"El índice {name!r} usa dimensión "
                    f"{configured_dimension}, pero el modelo "
                    f"cargado genera dimensión "
                    f"{self.embedding_dimension}."
                )

    def _verify_embedding_models(self) -> None:
        """
        Detecta incompatibilidades evidentes entre los modelos
        registrados en Neo4j y el modelo cargado.

        No se exige que embedding_model exista en todos los nodos,
        pero, si existe, debe ser consistente.
        """
        rows = self._query(
            """
            CALL {
                MATCH (initiative:Initiative)
                WHERE initiative.embedding IS NOT NULL
                RETURN
                    'Initiative' AS node_type,
                    collect(
                        DISTINCT initiative.embedding_model
                    ) AS embedding_models

                UNION ALL

                MATCH (chunk:Chunk)
                WHERE chunk.embedding IS NOT NULL
                RETURN
                    'Chunk' AS node_type,
                    collect(
                        DISTINCT chunk.embedding_model
                    ) AS embedding_models
            }

            RETURN
                node_type,
                [
                    value IN embedding_models
                    WHERE value IS NOT NULL
                    AND trim(toString(value)) <> ''
                ] AS embedding_models
            """
        )

        configured_name = MODEL_NAME.lower()
        configured_path_name = (
            self.model_path.name.lower()
        )

        for row in rows:
            models = [
                str(value).strip()
                for value in (
                    row.get("embedding_models") or []
                )
                if str(value).strip()
            ]

            if not models:
                continue

            compatible = any(
                configured_name in model.lower()
                or model.lower() in configured_name
                or configured_path_name in model.lower()
                or model.lower() in configured_path_name
                for model in models
            )

            if not compatible:
                logger.warning(
                    "Los nodos %s declaran modelos %s, pero la "
                    "aplicación cargó %s. Verifica que los "
                    "embeddings sean compatibles.",
                    row.get("node_type"),
                    models,
                    MODEL_NAME,
                )

    @staticmethod
    def _extract_index_dimension(
        options: Any,
    ) -> int | None:
        """
        Extrae vector.dimensions de las diferentes estructuras que
        Neo4j puede devolver dentro de SHOW VECTOR INDEXES.
        """
        if not isinstance(options, dict):
            return None

        index_config = (
            options.get("indexConfig")
            or options.get("index_config")
            or {}
        )

        if not isinstance(index_config, dict):
            return None

        raw_dimension = (
            index_config.get("vector.dimensions")
            or index_config.get("vector_dimensions")
        )

        if raw_dimension is None:
            return None

        try:
            return int(raw_dimension)
        except (TypeError, ValueError):
            return None

    # --------------------------------------------------------
    # Embeddings
    # --------------------------------------------------------

    def embed(
        self,
        text: str,
    ) -> list[float]:
        """
        Genera un embedding normalizado para la consulta.
        """
        normalized_text = " ".join(
            text.split()
        ).strip()

        if not normalized_text:
            raise ValueError(
                "No se puede generar un embedding para una "
                "consulta vacía."
            )

        vector = self.embedding_model.encode(
            normalized_text,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )

        array = np.asarray(
            vector,
            dtype=np.float32,
        ).reshape(-1)

        if array.size != self.embedding_dimension:
            raise RuntimeError(
                "El modelo devolvió un vector de dimensión "
                f"{array.size}; se esperaba "
                f"{self.embedding_dimension}."
            )

        if not np.isfinite(array).all():
            raise RuntimeError(
                "El modelo produjo un embedding con valores "
                "no finitos."
            )

        return array.tolist()

    # --------------------------------------------------------
    # Recuperación principal
    # --------------------------------------------------------

    def retrieve(
        self,
        plan: QueryPlan,
    ) -> list[EvidenceItem]:
        retrieval_query = (
            plan.retrieval_query.strip()
            or plan.normalized_question.strip()
        )

        if not retrieval_query:
            raise ValueError(
                "El plan no contiene una consulta de recuperación."
            )

        embedding = self.embed(
            retrieval_query
        )

        people = self._normalize_strings(
            plan.people
        )
        topics = self._normalize_strings(
            plan.topics
        )
        laws = self._normalize_strings(
            plan.laws
        )

        logger.info(
            "Recuperando evidencia: people=%s topics=%s "
            "laws=%s query=%r",
            people,
            topics,
            laws,
            retrieval_query,
        )

        initiative_rows = self._vector_initiatives(
            embedding=embedding,
            people=people,
            topics=topics,
            laws=laws,
        )

        chunk_rows = self._vector_chunks(
            embedding=embedding,
            people=people,
            topics=topics,
            laws=laws,
        )

        evidence = self._build_evidence(
            initiatives=initiative_rows,
            chunks=chunk_rows,
        )

        logger.info(
            "Recuperación terminada: %d iniciativas, "
            "%d fragmentos y %d evidencias finales.",
            len(initiative_rows),
            len(chunk_rows),
            len(evidence),
        )

        return evidence[
            : self.max_evidence_items
        ]

    # --------------------------------------------------------
    # Recuperación vectorial de iniciativas
    # --------------------------------------------------------

    def _vector_initiatives(
        self,
        embedding: list[float],
        people: list[str],
        topics: list[str],
        laws: list[str],
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
            YIELD
                node AS initiative,
                score AS vector_score

            /*
             * Cada colección se calcula en una subconsulta para
             * evitar el producto cartesiano entre presentadores,
             * temas, disposiciones, instituciones y documentos.
             */

            CALL (initiative) {
                OPTIONAL MATCH
                    (person:Person)-[
                        presentation:PRESENTED
                    ]->(initiative)

                OPTIONAL MATCH
                    (person)-[
                        membership:
                            MEMBER_OF_AT_PRESENTATION
                    ]->(party:Party)

                RETURN [
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
                ] AS presenters
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[:HAS_TOPIC]->(topic:Topic)

                RETURN [
                    item IN collect(
                        DISTINCT {
                            topic_id: topic.topic_id,
                            name: topic.name,
                            level: topic.level
                        }
                    )
                    WHERE item.name IS NOT NULL
                ] AS initiative_topics
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[
                        affects:AFFECTS
                    ]->(provision:Provision)

                OPTIONAL MATCH
                    (provision)-[:PART_OF]->(law:Law)

                RETURN [
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
                        item.provision_id IS NOT NULL
                        OR item.law IS NOT NULL
                ] AS provisions
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[
                        involvement:INVOLVES
                    ]->(institution:Institution)

                RETURN [
                    item IN collect(
                        DISTINCT {
                            institution_id:
                                institution.institution_id,
                            name: institution.name,
                            abbreviation:
                                institution.abbreviation,
                            role: involvement.role
                        }
                    )
                    WHERE item.name IS NOT NULL
                ] AS institutions
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[:HAS_DOCUMENT]
                    ->(document:Document)

                RETURN [
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
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[:PRESENTED_IN]
                    ->(chamber:Chamber)

                RETURN head(
                    [
                        item IN collect(
                            DISTINCT {
                                name: chamber.name
                            }
                        )
                        WHERE item.name IS NOT NULL
                    ]
                ) AS chamber
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[:BELONGS_TO]
                    ->(legislature:Legislature)

                RETURN head(
                    [
                        item IN collect(
                            DISTINCT {
                                name: legislature.name
                            }
                        )
                        WHERE item.name IS NOT NULL
                    ]
                ) AS legislature
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[:OBTAINED_FROM]
                    ->(source_system:SourceSystem)

                RETURN head(
                    [
                        item IN collect(
                            DISTINCT {
                                name: source_system.name
                            }
                        )
                        WHERE item.name IS NOT NULL
                    ]
                ) AS source_system
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[
                        similarity:SEMANTICALLY_SIMILAR
                    ]-(similar:Initiative)

                WHERE similar <> initiative

                WITH
                    similar,
                    similarity
                ORDER BY coalesce(
                    similarity.score,
                    similarity.similarity,
                    0.0
                ) DESC
                LIMIT 5

                RETURN [
                    item IN collect(
                        {
                            sil_id: similar.sil_id,
                            title: similar.title,
                            score: coalesce(
                                similarity.score,
                                similarity.similarity,
                                0.0
                            )
                        }
                    )
                    WHERE item.sil_id IS NOT NULL
                    OR item.title IS NOT NULL
                ] AS similar_initiatives
            }

            WITH
                initiative,
                vector_score,
                presenters,
                initiative_topics,
                provisions,
                institutions,
                documents,
                chamber,
                legislature,
                source_system,
                similar_initiatives,

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
                                ) CONTAINS
                                toLower(requested)
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
                            topic_item IN initiative_topics
                            WHERE
                                toLower(
                                    coalesce(
                                        topic_item.name,
                                        ''
                                    )
                                ) CONTAINS
                                toLower(requested)
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
                END AS topic_match,

                CASE
                    WHEN size($laws) = 0
                    THEN false
                    ELSE any(
                        requested IN $laws
                        WHERE any(
                            provision_item IN provisions
                            WHERE
                                toLower(
                                    coalesce(
                                        provision_item.law,
                                        ''
                                    )
                                ) CONTAINS
                                toLower(requested)
                                OR
                                toLower(requested) CONTAINS
                                toLower(
                                    coalesce(
                                        provision_item.law,
                                        ''
                                    )
                                )
                        )
                    )
                END AS law_match

            WITH
                initiative,
                vector_score,
                presenters,
                initiative_topics,
                provisions,
                institutions,
                documents,
                chamber,
                legislature,
                source_system,
                similar_initiatives,
                person_match,
                topic_match,
                law_match,

                vector_score
                + CASE
                    WHEN person_match THEN 0.03
                    ELSE 0.0
                END
                + CASE
                    WHEN topic_match THEN 0.03
                    ELSE 0.0
                END
                + CASE
                    WHEN law_match THEN 0.03
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
                initiative.embedding_model AS embedding_model,
                initiative.content_hash AS content_hash,

                vector_score,
                retrieval_score AS score,

                person_match,
                topic_match,
                law_match,

                presenters,
                initiative_topics AS topics,
                provisions,
                institutions,
                documents,
                chamber,
                legislature,
                source_system,
                similar_initiatives

            ORDER BY
                retrieval_score DESC,
                presentation_date DESC

            LIMIT $result_limit
            """,
            candidate_count=candidate_count,
            result_limit=self.max_graph_results,
            embedding=embedding,
            people=people,
            topics=topics,
            laws=laws,
        )

    # --------------------------------------------------------
    # Recuperación vectorial de fragmentos
    # --------------------------------------------------------

    def _vector_chunks(
        self,
        embedding: list[float],
        people: list[str],
        topics: list[str],
        laws: list[str],
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
            YIELD
                node AS chunk,
                score AS vector_score

            MATCH
                (document:Document)-[:HAS_CHUNK]->(chunk)

            MATCH
                (initiative:Initiative)
                -[:HAS_DOCUMENT]->(document)

            CALL (initiative) {
                OPTIONAL MATCH
                    (person:Person)-[
                        presentation:PRESENTED
                    ]->(initiative)

                OPTIONAL MATCH
                    (person)-[
                        membership:
                            MEMBER_OF_AT_PRESENTATION
                    ]->(party:Party)

                RETURN [
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
                ] AS presenters
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[:HAS_TOPIC]->(topic:Topic)

                RETURN [
                    item IN collect(
                        DISTINCT {
                            topic_id: topic.topic_id,
                            name: topic.name,
                            level: topic.level
                        }
                    )
                    WHERE item.name IS NOT NULL
                ] AS initiative_topics
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[
                        affects:AFFECTS
                    ]->(provision:Provision)

                OPTIONAL MATCH
                    (provision)-[:PART_OF]->(law:Law)

                RETURN [
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
                        item.provision_id IS NOT NULL
                        OR item.law IS NOT NULL
                ] AS provisions
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[:PRESENTED_IN]
                    ->(chamber:Chamber)

                RETURN head(
                    [
                        item IN collect(
                            DISTINCT {
                                name: chamber.name
                            }
                        )
                        WHERE item.name IS NOT NULL
                    ]
                ) AS chamber
            }

            CALL (initiative) {
                OPTIONAL MATCH
                    (initiative)-[:BELONGS_TO]
                    ->(legislature:Legislature)

                RETURN head(
                    [
                        item IN collect(
                            DISTINCT {
                                name: legislature.name
                            }
                        )
                        WHERE item.name IS NOT NULL
                    ]
                ) AS legislature
            }

            WITH
                chunk,
                document,
                initiative,
                vector_score,
                presenters,
                initiative_topics,
                provisions,
                chamber,
                legislature,

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
                                ) CONTAINS
                                toLower(requested)
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
                            topic_item IN initiative_topics
                            WHERE
                                toLower(
                                    coalesce(
                                        topic_item.name,
                                        ''
                                    )
                                ) CONTAINS
                                toLower(requested)
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
                END AS topic_match,

                CASE
                    WHEN size($laws) = 0
                    THEN false
                    ELSE any(
                        requested IN $laws
                        WHERE any(
                            provision_item IN provisions
                            WHERE
                                toLower(
                                    coalesce(
                                        provision_item.law,
                                        ''
                                    )
                                ) CONTAINS
                                toLower(requested)
                                OR
                                toLower(requested) CONTAINS
                                toLower(
                                    coalesce(
                                        provision_item.law,
                                        ''
                                    )
                                )
                        )
                    )
                END AS law_match

            WITH
                chunk,
                document,
                initiative,
                vector_score,
                presenters,
                initiative_topics,
                provisions,
                chamber,
                legislature,
                person_match,
                topic_match,
                law_match,

                vector_score
                + CASE
                    WHEN person_match THEN 0.03
                    ELSE 0.0
                END
                + CASE
                    WHEN topic_match THEN 0.03
                    ELSE 0.0
                END
                + CASE
                    WHEN law_match THEN 0.03
                    ELSE 0.0
                END AS retrieval_score

            RETURN
                chunk.chunk_id AS chunk_id,
                chunk.text AS text,
                chunk.text_hash AS text_hash,
                chunk.page AS page,
                chunk.chunk_index AS chunk_index,
                chunk.character_count AS character_count,
                chunk.embedding_model AS embedding_model,

                document.document_id AS document_id,
                document.url AS document_url,
                document.local_path AS local_path,
                document.filename AS filename,
                document.exists_locally AS exists_locally,

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
                law_match,

                presenters,
                initiative_topics AS topics,
                provisions,
                chamber,
                legislature

            ORDER BY
                retrieval_score DESC,
                initiative.sil_id,
                chunk.chunk_index

            LIMIT $result_limit
            """,
            candidate_count=candidate_count,
            result_limit=self.max_chunk_results,
            embedding=embedding,
            people=people,
            topics=topics,
            laws=laws,
        )

    # ========================================================
    # Normalización
    # ========================================================

    @staticmethod
    def _normalize_strings(
        values: list[str],
    ) -> list[str]:
        output: list[str] = []
        seen: set[str] = set()

        for value in values:
            normalized = " ".join(
                str(value).split()
            ).strip()

            identity = normalized.casefold()

            if not normalized or identity in seen:
                continue

            seen.add(identity)
            output.append(normalized)

        return output

    @staticmethod
    def _presenter_names(
        presenters: Any,
    ) -> list[str]:
        if not isinstance(presenters, list):
            return []

        output: list[str] = []
        seen: set[str] = set()

        for presenter in presenters:
            if isinstance(presenter, str):
                name = presenter.strip()
            elif isinstance(presenter, dict):
                name = str(
                    presenter.get("name") or ""
                ).strip()
            else:
                name = ""

            identity = name.casefold()

            if not name or identity in seen:
                continue

            seen.add(identity)
            output.append(name)

        return output

    @staticmethod
    def _topic_names(
        topics: Any,
    ) -> list[str]:
        if not isinstance(topics, list):
            return []

        output: list[str] = []
        seen: set[str] = set()

        for topic in topics:
            if isinstance(topic, str):
                name = topic.strip()
            elif isinstance(topic, dict):
                name = str(
                    topic.get("name") or ""
                ).strip()
            else:
                name = ""

            identity = name.casefold()

            if not name or identity in seen:
                continue

            seen.add(identity)
            output.append(name)

        return output

    @staticmethod
    def _institution_names(
        institutions: Any,
    ) -> list[str]:
        if not isinstance(institutions, list):
            return []

        output: list[str] = []
        seen: set[str] = set()

        for institution in institutions:
            if not isinstance(institution, dict):
                continue

            name = str(
                institution.get("name") or ""
            ).strip()

            abbreviation = str(
                institution.get("abbreviation") or ""
            ).strip()

            label = name

            if abbreviation and abbreviation.casefold() not in (
                name.casefold()
            ):
                label = f"{name} ({abbreviation})"

            identity = label.casefold()

            if not label or identity in seen:
                continue

            seen.add(identity)
            output.append(label)

        return output

    @staticmethod
    def _format_provisions(
        provisions: Any,
    ) -> list[str]:
        if not isinstance(provisions, list):
            return []

        output: list[str] = []
        seen: set[str] = set()

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
                (
                    f"artículo {article}"
                    if article
                    else ""
                ),
                (
                    f"fracción {fraction}"
                    if fraction
                    else ""
                ),
            ]

            label = " ".join(
                part
                for part in parts
                if part
            ).strip()

            identity = label.casefold()

            if not label or identity in seen:
                continue

            seen.add(identity)
            output.append(label)

        return output

    @staticmethod
    def _normalize_documents(
        documents: Any,
    ) -> list[dict[str, Any]]:
        if not isinstance(documents, list):
            return []

        output: list[dict[str, Any]] = []
        seen: set[str] = set()

        for document in documents:
            if not isinstance(document, dict):
                continue

            document_id = str(
                document.get("document_id") or ""
            ).strip()

            url = str(
                document.get("url") or ""
            ).strip()

            filename = str(
                document.get("filename") or ""
            ).strip()

            identity = (
                document_id
                or url
                or filename.casefold()
            )

            if not identity or identity in seen:
                continue

            seen.add(identity)

            output.append(
                {
                    "document_id": document_id,
                    "url": url,
                    "local_path": str(
                        document.get("local_path") or ""
                    ).strip(),
                    "filename": filename,
                    "exists_locally": document.get(
                        "exists_locally"
                    ),
                    "chunk_count": document.get(
                        "chunk_count"
                    ),
                }
            )

        return output

    @staticmethod
    def _safe_mapping_name(
        value: Any,
    ) -> str:
        if not isinstance(value, dict):
            return ""

        return str(
            value.get("name") or ""
        ).strip()

    # ========================================================
    # Construcción de evidencia
    # ========================================================

    @classmethod
    def _build_evidence(
        cls,
        initiatives: list[dict[str, Any]],
        chunks: list[dict[str, Any]],
    ) -> list[EvidenceItem]:
        evidence: list[EvidenceItem] = []

        for row in initiatives:
            presenter_names = cls._presenter_names(
                row.get("presenters")
            )

            topic_names = cls._topic_names(
                row.get("topics")
            )

            institution_names = (
                cls._institution_names(
                    row.get("institutions")
                )
            )

            provisions = cls._format_provisions(
                row.get("provisions")
            )

            documents = cls._normalize_documents(
                row.get("documents")
            )

            chamber_name = cls._safe_mapping_name(
                row.get("chamber")
            )

            legislature_name = (
                cls._safe_mapping_name(
                    row.get("legislature")
                )
            )

            source_system_name = (
                cls._safe_mapping_name(
                    row.get("source_system")
                )
            )

            excerpt_parts = [
                str(
                    row.get("summary") or ""
                ).strip(),
                (
                    "Promoventes: "
                    + ", ".join(presenter_names)
                    + "."
                    if presenter_names
                    else ""
                ),
                (
                    "Temas: "
                    + ", ".join(topic_names)
                    + "."
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
                    "Instituciones involucradas: "
                    + ", ".join(institution_names)
                    + "."
                    if institution_names
                    else ""
                ),
                (
                    f"Cámara: {chamber_name}."
                    if chamber_name
                    else ""
                ),
                (
                    f"Legislatura: {legislature_name}."
                    if legislature_name
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

            sil_id = str(
                row.get("sil_id") or ""
            ).strip()

            title = str(
                row.get("title") or "Iniciativa"
            ).strip()

            evidence.append(
                EvidenceItem(
                    evidence_id="",
                    kind="initiative",
                    title=title,
                    excerpt=excerpt[:5000],
                    source_url=source_url,
                    source_label=(
                        source_system_name
                        or "Registro legislativo"
                    ),
                    sil_id=sil_id,
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
                    primary_source=bool(
                        source_url
                        or documents
                    ),
                    direct_support=True,
                    metadata={
                        "status": row.get("status"),
                        "publication_date": row.get(
                            "publication_date"
                        ),
                        "topics": topic_names,
                        "topic_records": (
                            row.get("topics") or []
                        ),
                        "provisions": provisions,
                        "provision_records": (
                            row.get("provisions") or []
                        ),
                        "institutions": (
                            row.get("institutions") or []
                        ),
                        "documents": documents,
                        "presenters": (
                            row.get("presenters") or []
                        ),
                        "chamber": chamber_name,
                        "legislature": legislature_name,
                        "source_system": source_system_name,
                        "similar_initiatives": (
                            row.get(
                                "similar_initiatives"
                            )
                            or []
                        ),
                        "embedding_model": row.get(
                            "embedding_model"
                        ),
                        "content_hash": row.get(
                            "content_hash"
                        ),
                        "vector_score": row.get(
                            "vector_score"
                        ),
                        "person_match": bool(
                            row.get("person_match")
                        ),
                        "topic_match": bool(
                            row.get("topic_match")
                        ),
                        "law_match": bool(
                            row.get("law_match")
                        ),
                    },
                )
            )

        for row in chunks:
            presenter_names = cls._presenter_names(
                row.get("presenters")
            )

            topic_names = cls._topic_names(
                row.get("topics")
            )

            provisions = cls._format_provisions(
                row.get("provisions")
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

            text = str(
                row.get("text") or ""
            ).strip()

            evidence.append(
                EvidenceItem(
                    evidence_id="",
                    kind="document_chunk",
                    title=str(
                        row.get("initiative_title")
                        or filename
                        or "Fragmento documental"
                    ).strip(),
                    excerpt=text[:5000],
                    source_url=source_url,
                    source_label=(
                        filename
                        or "Documento legislativo"
                    ),
                    sil_id=str(
                        row.get("sil_id") or ""
                    ).strip(),
                    politician=", ".join(
                        presenter_names
                    ),
                    date=str(
                        row.get("presentation_date")
                        or ""
                    ),
                    page=cls._safe_int(
                        row.get("page")
                    ),
                    score=float(
                        row.get("score") or 0.0
                    ),
                    primary_source=bool(
                        document_url
                        or row.get("exists_locally")
                    ),
                    direct_support=bool(text),
                    metadata={
                        "chunk_id": row.get(
                            "chunk_id"
                        ),
                        "chunk_index": row.get(
                            "chunk_index"
                        ),
                        "text_hash": row.get(
                            "text_hash"
                        ),
                        "character_count": row.get(
                            "character_count"
                        ),
                        "document_id": row.get(
                            "document_id"
                        ),
                        "document_url": document_url,
                        "initiative_url": initiative_url,
                        "local_path": row.get(
                            "local_path"
                        ),
                        "exists_locally": row.get(
                            "exists_locally"
                        ),
                        "topics": topic_names,
                        "topic_records": (
                            row.get("topics") or []
                        ),
                        "provisions": provisions,
                        "provision_records": (
                            row.get("provisions") or []
                        ),
                        "presenters": (
                            row.get("presenters") or []
                        ),
                        "chamber": cls._safe_mapping_name(
                            row.get("chamber")
                        ),
                        "legislature": (
                            cls._safe_mapping_name(
                                row.get("legislature")
                            )
                        ),
                        "embedding_model": row.get(
                            "embedding_model"
                        ),
                        "vector_score": row.get(
                            "vector_score"
                        ),
                        "person_match": bool(
                            row.get("person_match")
                        ),
                        "topic_match": bool(
                            row.get("topic_match")
                        ),
                        "law_match": bool(
                            row.get("law_match")
                        ),
                    },
                )
            )

        evidence = cls._deduplicate_evidence(
            evidence
        )

        evidence.sort(
            key=lambda item: (
                item.direct_support,
                item.primary_source,
                item.score,
                item.kind == "document_chunk",
            ),
            reverse=True,
        )

        for index, item in enumerate(
            evidence,
            start=1,
        ):
            item.evidence_id = f"E{index}"

        return evidence

    @staticmethod
    def _safe_int(
        value: Any,
    ) -> int | None:
        if value is None:
            return None

        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _deduplicate_evidence(
        evidence: list[EvidenceItem],
    ) -> list[EvidenceItem]:
        """
        Evita repetir iniciativas o fragmentos.

        La identidad primaria es:

        - Iniciativa: sil_id.
        - Fragmento: chunk_id.
        - Fallback: combinación estable de metadatos.
        """
        output: list[EvidenceItem] = []
        seen: set[tuple[str, str]] = set()

        for item in evidence:
            if item.kind == "initiative":
                identity_value = (
                    item.sil_id.strip()
                    or item.title.strip().casefold()
                )
            else:
                chunk_id = str(
                    item.metadata.get("chunk_id") or ""
                ).strip()

                if chunk_id:
                    identity_value = chunk_id
                else:
                    identity_value = (
                        f"{item.sil_id}:"
                        f"{item.metadata.get('document_id')}:"
                        f"{item.metadata.get('chunk_index')}:"
                        f"{item.page}:"
                        f"{item.excerpt[:100]}"
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

    # ========================================================
    # Capacidades
    # ========================================================

    def capabilities(
        self,
    ) -> dict[str, list[str]]:
        return {
            "available": [
                (
                    "Buscar iniciativas por similitud "
                    "semántica."
                ),
                (
                    "Recuperar fragmentos de documentos "
                    "legislativos por similitud semántica."
                ),
                (
                    "Relacionar iniciativas con sus "
                    "promoventes."
                ),
                (
                    "Consultar el partido asociado con una "
                    "persona al momento de presentación, según "
                    "las relaciones disponibles en el grafo."
                ),
                (
                    "Identificar temas asociados con las "
                    "iniciativas."
                ),
                (
                    "Consultar leyes, artículos y fracciones "
                    "afectadas."
                ),
                (
                    "Identificar instituciones involucradas."
                ),
                (
                    "Consultar cámara, legislatura y sistema "
                    "fuente."
                ),
                (
                    "Examinar relaciones de similitud semántica "
                    "entre iniciativas."
                ),
                (
                    "Examinar relaciones de similitud semántica "
                    "entre personas."
                ),
            ],
            "unavailable": [
                (
                    "Confirmar votaciones nominales "
                    "individuales."
                ),
                (
                    "Confirmar asistencia legislativa."
                ),
                (
                    "Evaluar declaraciones públicas, "
                    "entrevistas o discursos no incluidos en "
                    "los documentos."
                ),
                (
                    "Verificar publicaciones de redes sociales."
                ),
                (
                    "Confirmar acusaciones, investigaciones o "
                    "procesos judiciales."
                ),
                (
                    "Consultar noticias externas en tiempo real."
                ),
                (
                    "Determinar corrupción, culpabilidad, "
                    "deshonestidad o intención política."
                ),
                (
                    "Inferir coordinación o acuerdo únicamente "
                    "a partir de similitud semántica."
                ),
                (
                    "Inferir una votación individual a partir "
                    "de la presentación de una iniciativa."
                ),
            ],
        }

    # ========================================================
    # Grafo visual derivado de la evidencia
    # ========================================================

    @staticmethod
    def build_graph_snapshot(
        evidence: list[EvidenceItem],
    ) -> GraphSnapshot:
        """
        Construye el grafo visual exclusivamente con información
        contenida en la evidencia recuperada.

        models.py actualmente limita GraphNode.node_type a:

        - initiative
        - person
        - topic
        - law
        - document

        Por esa razón, Party, Institution, Chamber, Legislature y
        SourceSystem se conservan como metadatos. No se crean nodos
        con tipos incompatibles con el modelo Pydantic.
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

            if (
                not normalized_id
                or not normalized_label
                or node_type not in SUPPORTED_NODE_TYPES
            ):
                return

            if normalized_id not in nodes:
                nodes[normalized_id] = GraphNode(
                    id=normalized_id,
                    label=normalized_label,
                    node_type=node_type,
                    evidence_ids=[evidence_id],
                    metadata={
                        key: value
                        for key, value in (
                            metadata or {}
                        ).items()
                        if value is not None
                        and value != ""
                        and value != []
                    },
                )
                return

            existing = nodes[normalized_id]

            if evidence_id not in existing.evidence_ids:
                existing.evidence_ids.append(
                    evidence_id
                )

            for key, value in (
                metadata or {}
            ).items():
                if (
                    value is not None
                    and value != ""
                    and value != []
                ):
                    existing.metadata[key] = value

        def add_edge(
            source: str,
            target: str,
            relationship: str,
            evidence_id: str,
        ) -> None:
            if (
                not source
                or not target
                or source == target
            ):
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

            existing = edges[edge_id]

            if evidence_id not in existing.evidence_ids:
                existing.evidence_ids.append(
                    evidence_id
                )

        for item in evidence:
            initiative_key = (
                item.sil_id.strip()
                or item.title.strip().casefold()
            )

            if not initiative_key:
                continue

            initiative_id = (
                f"initiative:{initiative_key}"
            )

            add_node(
                node_id=initiative_id,
                label=item.title,
                node_type="initiative",
                evidence_id=item.evidence_id,
                metadata={
                    "sil_id": item.sil_id,
                    "date": item.date,
                    "score": item.score,
                    "source_url": (
                        item.metadata.get("initiative_url")
                        or item.source_url
                    ),
                    "status": item.metadata.get(
                        "status"
                    ),
                    "chamber": item.metadata.get(
                        "chamber"
                    ),
                    "legislature": item.metadata.get(
                        "legislature"
                    ),
                    "source_system": item.metadata.get(
                        "source_system"
                    ),
                    "institutions": item.metadata.get(
                        "institutions"
                    ),
                },
            )

            # ------------------------------------------------
            # Personas y partidos como metadatos
            # ------------------------------------------------

            presenters = item.metadata.get(
                "presenters"
            )

            if not isinstance(presenters, list):
                presenters = []

            if not presenters and item.politician:
                presenters = [
                    {"name": value.strip()}
                    for value in item.politician.split(",")
                    if value.strip()
                ]

            for presenter in presenters:
                if not isinstance(presenter, dict):
                    continue

                presenter_name = str(
                    presenter.get("name") or ""
                ).strip()

                if not presenter_name:
                    continue

                person_key = str(
                    presenter.get("person_id")
                    or presenter_name.casefold()
                ).strip()

                person_id = (
                    f"person:{person_key}"
                )

                add_node(
                    node_id=person_id,
                    label=presenter_name,
                    node_type="person",
                    evidence_id=item.evidence_id,
                    metadata={
                        "party_id": presenter.get(
                            "party_id"
                        ),
                        "party": presenter.get(
                            "party"
                        ),
                        "party_abbreviation": (
                            presenter.get(
                                "party_abbreviation"
                            )
                        ),
                        "role": presenter.get(
                            "role"
                        ),
                    },
                )

                add_edge(
                    source=person_id,
                    target=initiative_id,
                    relationship="PRESENTÓ",
                    evidence_id=item.evidence_id,
                )

            # ------------------------------------------------
            # Temas
            # ------------------------------------------------

            topic_records = item.metadata.get(
                "topic_records"
            )

            if isinstance(topic_records, list):
                topics = topic_records
            else:
                topics = [
                    {"name": topic}
                    for topic in item.metadata.get(
                        "topics",
                        [],
                    )
                ]

            for topic in topics:
                if isinstance(topic, str):
                    topic_name = topic.strip()
                    topic_id_value = topic_name.casefold()
                    topic_level = None
                elif isinstance(topic, dict):
                    topic_name = str(
                        topic.get("name") or ""
                    ).strip()
                    topic_id_value = str(
                        topic.get("topic_id")
                        or topic_name.casefold()
                    ).strip()
                    topic_level = topic.get("level")
                else:
                    continue

                if not topic_name:
                    continue

                topic_id = (
                    f"topic:{topic_id_value}"
                )

                add_node(
                    node_id=topic_id,
                    label=topic_name,
                    node_type="topic",
                    evidence_id=item.evidence_id,
                    metadata={
                        "level": topic_level,
                    },
                )

                add_edge(
                    source=initiative_id,
                    target=topic_id,
                    relationship="TRATA SOBRE",
                    evidence_id=item.evidence_id,
                )

            # ------------------------------------------------
            # Leyes y disposiciones
            # ------------------------------------------------

            provision_records = item.metadata.get(
                "provision_records"
            )

            if isinstance(
                provision_records,
                list,
            ):
                for provision in provision_records:
                    if not isinstance(
                        provision,
                        dict,
                    ):
                        continue

                    law_name = str(
                        provision.get("law") or ""
                    ).strip()

                    if not law_name:
                        continue

                    law_key = str(
                        provision.get("law_id")
                        or law_name.casefold()
                    ).strip()

                    article = str(
                        provision.get("article") or ""
                    ).strip()

                    fraction = str(
                        provision.get("fraction") or ""
                    ).strip()

                    operation = str(
                        provision.get("operation") or ""
                    ).strip()

                    provision_parts = [
                        law_name,
                        (
                            f"artículo {article}"
                            if article
                            else ""
                        ),
                        (
                            f"fracción {fraction}"
                            if fraction
                            else ""
                        ),
                    ]

                    provision_label = " ".join(
                        part
                        for part in provision_parts
                        if part
                    )

                    law_id = f"law:{law_key}"

                    add_node(
                        node_id=law_id,
                        label=law_name,
                        node_type="law",
                        evidence_id=item.evidence_id,
                        metadata={
                            "provision_id": (
                                provision.get(
                                    "provision_id"
                                )
                            ),
                            "article": article,
                            "fraction": fraction,
                            "operation": operation,
                            "provision_label": (
                                provision_label
                            ),
                        },
                    )

                    add_edge(
                        source=initiative_id,
                        target=law_id,
                        relationship="AFECTA",
                        evidence_id=item.evidence_id,
                    )
            else:
                for provision in item.metadata.get(
                    "provisions",
                    [],
                ):
                    label = str(
                        provision
                    ).strip()

                    if not label:
                        continue

                    law_id = (
                        f"law:{label.casefold()}"
                    )

                    add_node(
                        node_id=law_id,
                        label=label,
                        node_type="law",
                        evidence_id=item.evidence_id,
                    )

                    add_edge(
                        source=initiative_id,
                        target=law_id,
                        relationship="AFECTA",
                        evidence_id=item.evidence_id,
                    )

            # ------------------------------------------------
            # Documentos de iniciativas
            # ------------------------------------------------

            for document in item.metadata.get(
                "documents",
                [],
            ):
                if not isinstance(document, dict):
                    continue

                document_key = str(
                    document.get("document_id")
                    or document.get("url")
                    or document.get("filename")
                    or ""
                ).strip()

                if not document_key:
                    continue

                filename = str(
                    document.get("filename")
                    or "Documento legislativo"
                ).strip()

                document_id = (
                    f"document:{document_key}"
                )

                add_node(
                    node_id=document_id,
                    label=filename,
                    node_type="document",
                    evidence_id=item.evidence_id,
                    metadata={
                        "document_id": document.get(
                            "document_id"
                        ),
                        "url": document.get("url"),
                        "local_path": document.get(
                            "local_path"
                        ),
                        "exists_locally": document.get(
                            "exists_locally"
                        ),
                        "chunk_count": document.get(
                            "chunk_count"
                        ),
                    },
                )

                add_edge(
                    source=initiative_id,
                    target=document_id,
                    relationship="TIENE DOCUMENTO",
                    evidence_id=item.evidence_id,
                )

            # ------------------------------------------------
            # Documento del fragmento
            # ------------------------------------------------

            if item.kind == "document_chunk":
                document_key = str(
                    item.metadata.get("document_id")
                    or item.metadata.get(
                        "document_url"
                    )
                    or item.source_label
                    or ""
                ).strip()

                if document_key:
                    document_id = (
                        f"document:{document_key}"
                    )

                    add_node(
                        node_id=document_id,
                        label=(
                            item.source_label
                            or "Documento legislativo"
                        ),
                        node_type="document",
                        evidence_id=item.evidence_id,
                        metadata={
                            "document_id": (
                                item.metadata.get(
                                    "document_id"
                                )
                            ),
                            "url": item.metadata.get(
                                "document_url"
                            ),
                            "local_path": (
                                item.metadata.get(
                                    "local_path"
                                )
                            ),
                            "exists_locally": (
                                item.metadata.get(
                                    "exists_locally"
                                )
                            ),
                            "page": item.page,
                            "chunk_id": (
                                item.metadata.get(
                                    "chunk_id"
                                )
                            ),
                            "chunk_index": (
                                item.metadata.get(
                                    "chunk_index"
                                )
                            ),
                        },
                    )

                    add_edge(
                        source=initiative_id,
                        target=document_id,
                        relationship="TIENE FRAGMENTO",
                        evidence_id=item.evidence_id,
                    )

            # ------------------------------------------------
            # Similitud semántica entre iniciativas
            # ------------------------------------------------

            similar_initiatives = item.metadata.get(
                "similar_initiatives"
            )

            if isinstance(
                similar_initiatives,
                list,
            ):
                for similar in similar_initiatives:
                    if not isinstance(similar, dict):
                        continue

                    similar_title = str(
                        similar.get("title") or ""
                    ).strip()

                    similar_key = str(
                        similar.get("sil_id")
                        or similar_title.casefold()
                    ).strip()

                    if not similar_key or not similar_title:
                        continue

                    similar_id = (
                        f"initiative:{similar_key}"
                    )

                    add_node(
                        node_id=similar_id,
                        label=similar_title,
                        node_type="initiative",
                        evidence_id=item.evidence_id,
                        metadata={
                            "sil_id": similar.get(
                                "sil_id"
                            ),
                            "semantic_similarity": (
                                similar.get("score")
                            ),
                            "context_only": True,
                        },
                    )

                    add_edge(
                        source=initiative_id,
                        target=similar_id,
                        relationship=(
                            "SEMÁNTICAMENTE SIMILAR"
                        ),
                        evidence_id=item.evidence_id,
                    )

        return GraphSnapshot(
            nodes=list(nodes.values()),
            edges=list(edges.values()),
        )

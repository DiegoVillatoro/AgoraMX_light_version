from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class InvestigationRequest(BaseModel):
    question: str = Field(min_length=10, max_length=3000)
    session_id: str | None = None
    reflection: str | None = Field(
        default=None,
        max_length=6000,
    )


class QueryPlan(BaseModel):
    normalized_question: str
    intent: Literal[
        "find_initiatives",
        "compare_people",
        "analyze_consistency",
        "trace_topic",
        "verify_claim",
        "general_research",
    ] = "general_research"

    people: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    laws: list[str] = Field(default_factory=list)
    subquestions: list[str] = Field(default_factory=list)

    required_capabilities: list[str] = Field(
        default_factory=list
    )
    unavailable_capabilities: list[str] = Field(
        default_factory=list
    )

    safety_notes: list[str] = Field(default_factory=list)
    retrieval_query: str


class EvidenceItem(BaseModel):
    evidence_id: str
    kind: Literal[
        "initiative",
        "document_chunk",
        "graph_relation",
    ]

    title: str
    excerpt: str
    source_url: str = ""
    source_label: str = ""
    sil_id: str = ""
    politician: str = ""
    date: str = ""
    page: int | None = None
    score: float = 0.0

    primary_source: bool = False
    direct_support: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvidenceAudit(BaseModel):
    answerability: Literal[
        "sufficient",
        "partial",
        "insufficient",
    ]
    source_quality_score: int = Field(ge=0, le=100)
    coverage_score: int = Field(ge=0, le=100)

    supported_questions: list[str] = Field(default_factory=list)
    unsupported_questions: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    notes: str = ""


class CounterAnalysis(BaseModel):
    alternative_interpretations: list[str] = Field(
        default_factory=list
    )
    possible_counterevidence: list[str] = Field(
        default_factory=list
    )
    invalid_conclusions: list[str] = Field(
        default_factory=list
    )
    questions_to_resolve: list[str] = Field(
        default_factory=list
    )


class CognitiveChallenge(BaseModel):
    instructions: str
    questions: list[str]
    required_evidence_ids: list[str]
    warning: str


class ReasoningEvaluation(BaseModel):
    total_score: int = Field(ge=0, le=100)
    claim_evidence_score: int = Field(ge=0, le=25)
    source_verification_score: int = Field(ge=0, le=25)
    counterargument_score: int = Field(ge=0, le=20)
    uncertainty_score: int = Field(ge=0, le=15)
    synthesis_score: int = Field(ge=0, le=15)

    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    unsupported_claims: list[str] = Field(default_factory=list)
    feedback: str
    improved_reasoning_steps: list[str] = Field(
        default_factory=list
    )

class GraphNode(BaseModel):
    id: str
    label: str
    node_type: Literal[
        "initiative",
        "person",
        "topic",
        "law",
        "document",
    ]
    evidence_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

class GraphEdge(BaseModel):
    source: str
    target: str
    relationship: str
    evidence_ids: list[str] = Field(default_factory=list)

class GraphSnapshot(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)

class InvestigationResponse(BaseModel):
    session_id: str
    stage: Literal["reflection_required", "completed"]

    question: str
    plan: QueryPlan
    evidence: list[EvidenceItem]
    audit: EvidenceAudit
    counter_analysis: CounterAnalysis

    graph_snapshot: GraphSnapshot = Field(
        default_factory=GraphSnapshot
    )
    
    challenge: CognitiveChallenge | None = None
    evaluation: ReasoningEvaluation | None = None
    final_answer: str | None = None

    graph_capabilities: list[str] = Field(default_factory=list)
    graph_limitations: list[str] = Field(default_factory=list)
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.agents import (
    CounterEvidenceAgent,
    EvidenceAuditAgent,
    PlanningAgent,
    ReasoningEvaluatorAgent,
    SocraticTutorAgent,
    SynthesisAgent,
)
from app.graph import ReadOnlyGraphRAG
from app.models import (
    CounterAnalysis,
    EvidenceAudit,
    EvidenceItem,
    InvestigationRequest,
    InvestigationResponse,
    QueryPlan,
)


@dataclass
class InvestigationState:
    session_id: str
    question: str
    plan: QueryPlan
    evidence: list[EvidenceItem]
    audit: EvidenceAudit
    counter: CounterAnalysis
    created_at: datetime


class InMemoryCaseStore:
    """
    Adecuado exclusivamente para un demo.

    Para despliegue real:
    - Redis con expiración.
    - PostgreSQL con cifrado.
    - Identidad seudonimizada.
    - Políticas de eliminación.
    """

    def __init__(self, ttl_minutes: int = 60):
        self.ttl = timedelta(minutes=ttl_minutes)
        self.cases: dict[str, InvestigationState] = {}

    def save(self, state: InvestigationState) -> None:
        self.cleanup()
        self.cases[state.session_id] = state

    def get(self, session_id: str) -> InvestigationState:
        self.cleanup()

        state = self.cases.get(session_id)

        if not state:
            raise KeyError(
                "La sesión no existe o ya expiró."
            )

        return state

    def cleanup(self) -> None:
        now = datetime.now(timezone.utc)

        expired = [
            key
            for key, state in self.cases.items()
            if now - state.created_at > self.ttl
        ]

        for key in expired:
            self.cases.pop(key, None)


class InvestigationOrchestrator:
    def __init__(
        self,
        graph: ReadOnlyGraphRAG,
        planner: PlanningAgent,
        auditor: EvidenceAuditAgent,
        counter_agent: CounterEvidenceAgent,
        tutor: SocraticTutorAgent,
        evaluator: ReasoningEvaluatorAgent,
        synthesizer: SynthesisAgent,
        store: InMemoryCaseStore,
    ):
        self.graph = graph
        self.planner = planner
        self.auditor = auditor
        self.counter_agent = counter_agent
        self.tutor = tutor
        self.evaluator = evaluator
        self.synthesizer = synthesizer
        self.store = store

    async def investigate(
        self,
        request: InvestigationRequest,
    ) -> InvestigationResponse:
        if request.reflection:
            return await self._complete(request)

        return await self._open_case(request.question)

    async def _open_case(
        self,
        question: str,
    ) -> InvestigationResponse:
        plan = await self.planner.run(question)

        # SentenceTransformer y Neo4j son llamadas síncronas.
        evidence = await asyncio.to_thread(
            self.graph.retrieve,
            plan,
        )
        graph_snapshot = self.graph.build_graph_snapshot(
            evidence
        )
        audit = await self.auditor.run(
            question,
            plan,
            evidence,
        )

        counter = await self.counter_agent.run(
            question,
            evidence,
            audit,
        )

        challenge = await self.tutor.run(
            question,
            evidence,
            audit,
            counter,
        )

        session_id = str(uuid4())

        state = InvestigationState(
            session_id=session_id,
            question=question,
            plan=plan,
            evidence=evidence,
            audit=audit,
            counter=counter,
            created_at=datetime.now(timezone.utc),
        )

        self.store.save(state)

        capabilities = self.graph.capabilities()

        return InvestigationResponse(
            session_id=session_id,
            stage="reflection_required",
            question=question,
            plan=plan,
            evidence=evidence,
            audit=audit,
            counter_analysis=counter,
            graph_snapshot=graph_snapshot,
            challenge=challenge,
            graph_capabilities=capabilities["available"],
            graph_limitations=capabilities["unavailable"],
        )

    async def _complete(
        self,
        request: InvestigationRequest,
    ) -> InvestigationResponse:
        if not request.session_id:
            raise ValueError(
                "session_id es obligatorio al enviar "
                "una reflexión."
            )

        state = self.store.get(request.session_id)

        if state.question.strip() != request.question.strip():
            raise ValueError(
                "La pregunta no corresponde con la sesión."
            )

        reflection = request.reflection or ""

        evaluation = await self.evaluator.run(
            question=state.question,
            reflection=reflection,
            evidence=state.evidence,
            audit=state.audit,
            counter=state.counter,
        )

        final_answer = await self.synthesizer.run(
            question=state.question,
            reflection=reflection,
            evidence=state.evidence,
            audit=state.audit,
            counter=state.counter,
            evaluation=evaluation,
        )

        capabilities = self.graph.capabilities()
        graph_snapshot = self.graph.build_graph_snapshot(
            state.evidence
        )

        return InvestigationResponse(
            session_id=state.session_id,
            stage="completed",
            question=state.question,
            plan=state.plan,
            evidence=state.evidence,
            audit=state.audit,
            counter_analysis=state.counter,
            graph_snapshot=graph_snapshot,
            evaluation=evaluation,
            final_answer=final_answer,
            graph_capabilities=capabilities["available"],
            graph_limitations=capabilities["unavailable"],
        )

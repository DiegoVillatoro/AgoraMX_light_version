from __future__ import annotations

import json

from app.llm import LLMClient
from app.models import (
    CognitiveChallenge,
    CounterAnalysis,
    EvidenceAudit,
    EvidenceItem,
    QueryPlan,
    ReasoningEvaluation,
)


SYSTEM_POLICY = """
Eres parte de ÁgoraMX, un tutor de investigación cívica.

Reglas obligatorias:

1. Distingue hechos documentados, inferencias y preguntas abiertas.
2. Nunca determines que una persona es corrupta, culpable,
   deshonesta o criminal sin una resolución oficial incluida
   explícitamente en la evidencia.
3. Una similitud semántica no demuestra acuerdo, coordinación,
   intención ni contradicción.
4. Presentar una iniciativa no demuestra que una persona haya
   votado por ella.
5. La ausencia de evidencia no demuestra que un hecho sea falso.
6. No inventes fuentes, votaciones, declaraciones o resoluciones.
7. Solo utiliza la evidencia proporcionada.
8. Cita evidencia mediante identificadores como [E1] y [E2].
9. Conserva los matices y señala información faltante.
10. El objetivo es incrementar el razonamiento del estudiante,
    no reemplazarlo.
""".strip()


def evidence_payload(
    evidence: list[EvidenceItem],
) -> str:
    return json.dumps(
        [item.model_dump() for item in evidence],
        ensure_ascii=False,
        indent=2,
    )


class PlanningAgent:
    def __init__(self, llm: LLMClient):
        self.llm = llm

    async def run(self, question: str) -> QueryPlan:
        return await self.llm.structured(
            SYSTEM_POLICY,
            f"""
Analiza esta pregunta de investigación:

{question}

El grafo actual contiene:
- Iniciativas.
- Promoventes.
- Partidos al momento de presentación.
- Temas.
- Instituciones.
- Leyes y disposiciones afectadas.
- Documentos y fragmentos PDF.
- Similitudes semánticas derivadas.

El grafo no contiene todavía:
- Votaciones.
- Noticias.
- Redes sociales.
- Declaraciones públicas.
- Sentencias judiciales estructuradas.
- Asistencias legislativas.

Genera un plan de investigación.
"retrieval_query" debe ser una consulta semántica amplia y clara.
Marca como unavailable_capabilities cualquier elemento necesario
que el grafo actual no pueda probar.
""",
            QueryPlan,
        )


class EvidenceAuditAgent:
    def __init__(self, llm: LLMClient):
        self.llm = llm

    async def run(
        self,
        question: str,
        plan: QueryPlan,
        evidence: list[EvidenceItem],
    ) -> EvidenceAudit:
        return await self.llm.structured(
            SYSTEM_POLICY,
            f"""
Audita si la evidencia recuperada permite responder la pregunta.

Pregunta:
{question}

Plan:
{plan.model_dump_json(indent=2)}

Evidencia:
{evidence_payload(evidence)}

Criterios:
- Una iniciativa puede demostrar que fue presentada y qué
  pretendía modificar.
- No demuestra por sí sola cómo votó alguien.
- Una relación temática no demuestra una postura moral.
- Para acusaciones legales se necesita resolución oficial,
  expediente o documento equivalente.
- Identifica explícitamente preguntas que no pueden responderse.
""",
            EvidenceAudit,
        )


class CounterEvidenceAgent:
    def __init__(self, llm: LLMClient):
        self.llm = llm

    async def run(
        self,
        question: str,
        evidence: list[EvidenceItem],
        audit: EvidenceAudit,
    ) -> CounterAnalysis:
        return await self.llm.structured(
            SYSTEM_POLICY,
            f"""
Actúa como abogado del diablo metodológico.

Pregunta:
{question}

Auditoría:
{audit.model_dump_json(indent=2)}

Evidencia:
{evidence_payload(evidence)}

Encuentra:
- Interpretaciones alternativas razonables.
- Evidencia que sería necesaria para refutar la hipótesis.
- Conclusiones inválidas o prematuras.
- Preguntas que deben resolverse antes de afirmar consistencia,
  contradicción o evolución política.
""",
            CounterAnalysis,
        )


class SocraticTutorAgent:
    def __init__(self, llm: LLMClient):
        self.llm = llm

    async def run(
        self,
        question: str,
        evidence: list[EvidenceItem],
        audit: EvidenceAudit,
        counter: CounterAnalysis,
    ) -> CognitiveChallenge:
        return await self.llm.structured(
            SYSTEM_POLICY,
            f"""
Diseña un ejercicio breve para que el estudiante responda antes
de recibir una síntesis.

Pregunta original:
{question}

Evidencia:
{evidence_payload(evidence)}

Auditoría:
{audit.model_dump_json(indent=2)}

Análisis alternativo:
{counter.model_dump_json(indent=2)}

Pide al estudiante:
1. Formular una hipótesis provisional.
2. Citar al menos dos identificadores [E#].
3. Separar hechos de inferencias.
4. Mencionar una explicación alternativa.
5. Indicar qué evidencia falta.

No respondas la pregunta original.
""",
            CognitiveChallenge,
        )


class ReasoningEvaluatorAgent:
    def __init__(self, llm: LLMClient):
        self.llm = llm

    async def run(
        self,
        question: str,
        reflection: str,
        evidence: list[EvidenceItem],
        audit: EvidenceAudit,
        counter: CounterAnalysis,
    ) -> ReasoningEvaluation:
        return await self.llm.structured(
            SYSTEM_POLICY,
            f"""
Evalúa el razonamiento del estudiante, no su ideología ni si
coincide contigo.

Pregunta:
{question}

Respuesta del estudiante:
{reflection}

Evidencia disponible:
{evidence_payload(evidence)}

Auditoría:
{audit.model_dump_json(indent=2)}

Interpretaciones alternativas:
{counter.model_dump_json(indent=2)}

Rúbrica:
- Alineación entre afirmaciones y evidencia: 25.
- Verificación y calidad de fuentes: 25.
- Consideración de contraargumentos: 20.
- Manejo de incertidumbre: 15.
- Síntesis y claridad: 15.

No concedas puntos por citar identificadores inexistentes.
Identifica afirmaciones que no estén respaldadas.
""",
            ReasoningEvaluation,
        )


class SynthesisAgent:
    def __init__(self, llm: LLMClient):
        self.llm = llm

    async def run(
        self,
        question: str,
        reflection: str,
        evidence: list[EvidenceItem],
        audit: EvidenceAudit,
        counter: CounterAnalysis,
        evaluation: ReasoningEvaluation,
    ) -> str:
        return await self.llm.complete(
            SYSTEM_POLICY,
            f"""
Produce la síntesis final de la investigación.

Pregunta:
{question}

Reflexión del estudiante:
{reflection}

Evaluación del razonamiento:
{evaluation.model_dump_json(indent=2)}

Auditoría:
{audit.model_dump_json(indent=2)}

Interpretaciones alternativas:
{counter.model_dump_json(indent=2)}

Evidencia autorizada:
{evidence_payload(evidence)}

Formato obligatorio:

## Respuesta breve
Una respuesta prudente y directa.

## Hechos documentados
Lista de hechos, cada uno con referencias [E#].

## Inferencias posibles
Explica qué puede inferirse y por qué. Cita [E#].

## Interpretaciones alternativas
Incluye al menos una.

## Lo que no puede concluirse
Enumera límites concretos.

## Evidencia necesaria para continuar
Enumera documentos o datos faltantes.

## Referencias
Lista [E#], título, fecha, página cuando exista y URL.

No introduzcas hechos ajenos a la evidencia autorizada.
No describas como contradicción lo que solo sea diferencia
temática. Si la evidencia es insuficiente, dilo claramente.
""",
        )
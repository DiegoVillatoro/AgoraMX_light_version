from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.agents import (
    CounterEvidenceAgent,
    EvidenceAuditAgent,
    PlanningAgent,
    ReasoningEvaluatorAgent,
    SocraticTutorAgent,
    SynthesisAgent,
)
from app.config import get_settings
from app.graph import ReadOnlyGraphRAG
from app.llm import LLMClient
from app.models import (
    InvestigationRequest,
    InvestigationResponse,
)
from app.orchestrator import (
    InMemoryCaseStore,
    InvestigationOrchestrator,
)


settings = get_settings()

# ---------------------------------------------------------
# Rutas absolutas
# ---------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"


if not STATIC_DIR.is_dir():
    raise RuntimeError(
        "No existe el directorio de archivos estáticos: "
        f"{STATIC_DIR}"
    )

if not INDEX_FILE.is_file():
    raise RuntimeError(
        "No existe el archivo principal de la interfaz: "
        f"{INDEX_FILE}"
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    graph = ReadOnlyGraphRAG(settings)
    graph.verify()

    llm = LLMClient(settings)

    orchestrator = InvestigationOrchestrator(
        graph=graph,
        planner=PlanningAgent(llm),
        auditor=EvidenceAuditAgent(llm),
        counter_agent=CounterEvidenceAgent(llm),
        tutor=SocraticTutorAgent(llm),
        evaluator=ReasoningEvaluatorAgent(llm),
        synthesizer=SynthesisAgent(llm),
        store=InMemoryCaseStore(
            ttl_minutes=settings.session_ttl_minutes
        ),
    )

    app.state.graph = graph
    app.state.orchestrator = orchestrator

    yield

    graph.close()


app = FastAPI(
    title="ÁgoraMX — Tutor de investigación cívica",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.mount(
    "/static",
    StaticFiles(directory=str(STATIC_DIR)),
    name="static",
)


@app.get("/", include_in_schema=False)
async def home():
    return FileResponse(INDEX_FILE)


@app.get("/api/health")
async def health(request: Request):
    try:
        request.app.state.graph.verify()

        return {
            "status": "ok",
            "neo4j": "connected",
            "graph_mode": "read_only",
        }

    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Neo4j no disponible: {exc}",
        ) from exc


@app.post(
    "/api/investigate",
    response_model=InvestigationResponse,
)
async def investigate(
    payload: InvestigationRequest,
    request: Request,
):
    try:
        orchestrator = request.app.state.orchestrator

        return await orchestrator.investigate(payload)

    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "No fue posible completar el análisis: "
                f"{exc}"
            ),
        ) from exc
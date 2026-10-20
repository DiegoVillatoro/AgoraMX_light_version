/* ==========================================================
   ÁgoraMX
   Archivo: /static/js/app.js
   Parte 1 de 3

   Esta parte contiene:
   - Configuración general.
   - Estado de la aplicación.
   - Referencias al DOM.
   - Inicialización.
   - Tema visual.
   - Comprobación de salud de la API.
   - Navegación entre etapas.
   - Validación de la pregunta.
   - Inicio de una investigación.
   - Renderizado del plan.
   ========================================================== */

/* ==========================================================
   1. CONFIGURACIÓN
   ========================================================== */

const CONFIG = Object.freeze({
  api: {
    health: "/api/health",
    investigate: "/api/investigate",
  },

  limits: {
    questionMinLength: 10,
    questionMaxLength: 3000,
    reflectionMaxLength: 6000,
  },

  requestTimeoutMs: 180000,

  storageKeys: {
    theme: "agoramx-theme",
  },

  loadingMessages: [
    {
      step: "planning",
      message: "Analizando la pregunta de investigación.",
    },
    {
      step: "retrieval",
      message: "Consultando los índices vectoriales.",
    },
    {
      step: "graph",
      message: "Expandiendo las relaciones del grafo.",
    },
    {
      step: "audit",
      message: "Auditando la calidad y cobertura de la evidencia.",
    },
    {
      step: "challenge",
      message: "Preparando el reto socrático.",
    },
  ],
});

const REFLECTION_TEMPLATE = `Hipótesis provisional:
Considero provisionalmente que...

Hechos documentados:
- La evidencia [E___] documenta que...
- La evidencia [E___] muestra que...

Inferencias:
- A partir de estos hechos, puede inferirse que...
- Esta es una inferencia y no un hecho confirmado porque...

Explicación alternativa:
- Sin embargo, otra explicación posible es que...
- Para distinguir entre ambas explicaciones sería necesario...

Conclusión provisional:
- La evidencia disponible permite sostener que...
- No puede concluirse que...

Evidencia o información faltante:
- Hace falta consultar...
- También sería necesario verificar...`;

const SECTION_ORDER = Object.freeze([
  "question",
  "plan",
  "evidence",
  "reflection",
  "synthesis",
]);


const INTENT_LABELS = Object.freeze({
  find_initiatives: "Buscar iniciativas",
  compare_people: "Comparar promoventes",
  analyze_consistency: "Analizar consistencia",
  trace_topic: "Rastrear tema",
  verify_claim: "Verificar afirmación",
  general_research: "Investigación general",
});


const ANSWERABILITY_LABELS = Object.freeze({
  sufficient: "Suficiente",
  partial: "Parcial",
  insufficient: "Insuficiente",
});


const EVIDENCE_KIND_LABELS = Object.freeze({
  initiative: "Iniciativa",
  document_chunk: "Fragmento documental",
  graph_relation: "Relación del grafo",
});


const NODE_TYPE_LABELS = Object.freeze({
  initiative: "Iniciativa",
  person: "Persona",
  topic: "Tema",
  law: "Ley o disposición",
  document: "Documento",
});


const NODE_TYPE_SYMBOLS = Object.freeze({
  initiative: "I",
  person: "P",
  topic: "T",
  law: "L",
  document: "D",
});
const EVIDENCE_CITATION_PATTERN_SOURCE = (
  "\\x5B\\s*(E[0-9]+)\\s*\\x5D"
);

const EVIDENCE_ID_PATTERN = /^E[0-9]+$/i;


/* ==========================================================
   2. ESTADO GLOBAL
   ========================================================== */

const state = {
  currentSection: "question",

  sessionId: null,
  question: "",
  reflection: "",

  investigation: null,

  plan: null,
  evidence: [],
  audit: null,
  counterAnalysis: null,
  challenge: null,
  evaluation: null,
  finalAnswer: null,

  graphSnapshot: {
    nodes: [],
    edges: [],
  },

  graphCapabilities: [],
  graphLimitations: [],

  loading: false,
  submittingReflection: false,

  selectedGraphNodeId: null,

  graphView: {
    x: 0,
    y: 0,
    scale: 1,
  },

  graphPositions: new Map(),

  graphDrag: null,

  evidenceFilter: "all",

  health: {
    checked: false,
    online: false,
  },
};


/* ==========================================================
   3. REFERENCIAS AL DOM
   ========================================================== */

const elements = {
  html: document.documentElement,
  body: document.body,

  systemStatus: document.getElementById("system-status"),
  systemStatusIndicator: document.getElementById(
    "system-status-indicator",
  ),
  systemStatusText: document.getElementById(
    "system-status-text",
  ),

  themeToggle: document.getElementById("theme-toggle"),
  themeToggleLabel: document.getElementById(
    "theme-toggle-label",
  ),

  progressSteps: document.getElementById("progress-steps"),

  globalError: document.getElementById("global-error"),
  globalErrorMessage: document.getElementById(
    "global-error-message",
  ),
  dismissError: document.getElementById("dismiss-error"),

  globalMessage: document.getElementById("global-message"),
  globalMessageText: document.getElementById(
    "global-message-text",
  ),

  sections: {
    question: document.getElementById("question-section"),
    plan: document.getElementById("plan-section"),
    evidence: document.getElementById("evidence-section"),
    reflection: document.getElementById("reflection-section"),
    synthesis: document.getElementById("synthesis-section"),
  },

  questionForm: document.getElementById("question-form"),
  questionInput: document.getElementById("question-input"),
  questionCounter: document.getElementById("question-counter"),
  questionError: document.getElementById("question-error"),
  submitQuestion: document.getElementById("submit-question"),
  exampleQuestionButtons: document.querySelectorAll(
    "[data-example-question]",
  ),

  plannedQuestion: document.getElementById("planned-question"),
  planIntent: document.getElementById("plan-intent"),
  normalizedQuestion: document.getElementById(
    "normalized-question",
  ),
  retrievalQuery: document.getElementById("retrieval-query"),

  planSubquestions: document.getElementById(
    "plan-subquestions",
  ),
  planSubquestionsEmpty: document.getElementById(
    "plan-subquestions-empty",
  ),

  planPeople: document.getElementById("plan-people"),
  planTopics: document.getElementById("plan-topics"),
  planLaws: document.getElementById("plan-laws"),

  requiredCapabilities: document.getElementById(
    "required-capabilities",
  ),

  unavailableCapabilities: document.getElementById(
    "unavailable-capabilities",
  ),
  unavailableCapabilitiesEmpty: document.getElementById(
    "unavailable-capabilities-empty",
  ),

  safetyNotesPanel: document.getElementById(
    "safety-notes-panel",
  ),
  safetyNotes: document.getElementById("safety-notes"),

  editQuestion: document.getElementById("edit-question"),
  openEvidence: document.getElementById("open-evidence"),

  investigationLoading: document.getElementById(
    "investigation-loading",
  ),
  investigationLoadingMessage: document.getElementById(
    "investigation-loading-message",
  ),
  loadingSteps: document.getElementById("loading-steps"),

  initiativeCount: document.getElementById("initiative-count"),
  personCount: document.getElementById("person-count"),
  topicCount: document.getElementById("topic-count"),
  evidenceCount: document.getElementById("evidence-count"),

  answerabilityBadge: document.getElementById(
    "answerability-badge",
  ),

  tabList: document.querySelector(".tab-list"),
  tabButtons: document.querySelectorAll("[data-tab]"),
  tabPanels: document.querySelectorAll("[data-tab-panel]"),

  evidenceKindFilter: document.getElementById(
    "evidence-kind-filter",
  ),
  evidenceList: document.getElementById("evidence-list"),
  evidenceEmptyState: document.getElementById(
    "evidence-empty-state",
  ),

  sourceQualityScore: document.getElementById(
    "source-quality-score",
  ),
  coverageScore: document.getElementById("coverage-score"),
  sourceQualityMeter: document.getElementById(
    "source-quality-meter",
  ),
  coverageMeter: document.getElementById("coverage-meter"),

  supportedQuestions: document.getElementById(
    "supported-questions",
  ),
  supportedQuestionsEmpty: document.getElementById(
    "supported-questions-empty",
  ),

  unsupportedQuestions: document.getElementById(
    "unsupported-questions",
  ),
  unsupportedQuestionsEmpty: document.getElementById(
    "unsupported-questions-empty",
  ),

  missingEvidence: document.getElementById("missing-evidence"),
  riskFlags: document.getElementById("risk-flags"),
  auditNotes: document.getElementById("audit-notes"),

  graphCapabilities: document.getElementById(
    "graph-capabilities",
  ),
  graphLimitations: document.getElementById(
    "graph-limitations",
  ),

  returnToPlan: document.getElementById("return-to-plan"),
  continueToReflection: document.getElementById(
    "continue-to-reflection",
  ),

  evidenceGraph: document.getElementById("evidence-graph"),
  graphViewport: document.getElementById("graph-viewport"),
  graphEdges: document.getElementById("graph-edges"),
  graphNodes: document.getElementById("graph-nodes"),
  graphEmptyState: document.getElementById(
    "graph-empty-state",
  ),
  graphProperties: document.getElementById(
    "graph-properties-content",
  ),

  graphZoomOut: document.getElementById("graph-zoom-out"),
  graphZoomLevel: document.getElementById("graph-zoom-level"),
  graphZoomIn: document.getElementById("graph-zoom-in"),
  graphReset: document.getElementById("graph-reset"),

  challengeInstructions: document.getElementById(
    "challenge-instructions",
  ),
  challengeQuestions: document.getElementById(
    "challenge-questions",
  ),
  requiredEvidenceIds: document.getElementById(
    "required-evidence-ids",
  ),
  challengeWarning: document.getElementById(
    "challenge-warning",
  ),

  toggleCounterAnalysis: document.getElementById(
    "toggle-counter-analysis",
  ),
  counterAnalysisContent: document.getElementById(
    "counter-analysis-content",
  ),

  alternativeInterpretations: document.getElementById(
    "alternative-interpretations",
  ),
  possibleCounterevidence: document.getElementById(
    "possible-counterevidence",
  ),
  invalidConclusions: document.getElementById(
    "invalid-conclusions",
  ),
  questionsToResolve: document.getElementById(
    "questions-to-resolve",
  ),

  reflectionForm: document.getElementById("reflection-form"),
  reflectionInput: document.getElementById("reflection-input"),
  reflectionCounter: document.getElementById(
    "reflection-counter",
  ),
  reflectionValidation: document.getElementById(
    "reflection-validation",
  ),
  submitReflection: document.getElementById(
    "submit-reflection",
  ),
  returnToEvidence: document.getElementById(
    "return-to-evidence",
  ),

  reflectionChecks: {
    hypothesis: document.getElementById("check-hypothesis"),
    citations: document.getElementById("check-citations"),
    facts: document.getElementById("check-facts"),
    alternative: document.getElementById("check-alternative"),
    missing: document.getElementById("check-missing"),
  },

  totalScore: document.getElementById("total-score"),
  evaluationFeedback: document.getElementById(
    "evaluation-feedback",
  ),

  claimEvidenceScore: document.getElementById(
    "claim-evidence-score",
  ),
  sourceVerificationScore: document.getElementById(
    "source-verification-score",
  ),
  counterargumentScore: document.getElementById(
    "counterargument-score",
  ),
  uncertaintyScore: document.getElementById(
    "uncertainty-score",
  ),
  synthesisScore: document.getElementById("synthesis-score"),

  claimEvidenceMeter: document.getElementById(
    "claim-evidence-meter",
  ),
  sourceVerificationMeter: document.getElementById(
    "source-verification-meter",
  ),
  counterargumentMeter: document.getElementById(
    "counterargument-meter",
  ),
  uncertaintyMeter: document.getElementById(
    "uncertainty-meter",
  ),
  synthesisMeter: document.getElementById("synthesis-meter"),

  evaluationStrengths: document.getElementById(
    "evaluation-strengths",
  ),
  evaluationWeaknesses: document.getElementById(
    "evaluation-weaknesses",
  ),
  unsupportedClaims: document.getElementById(
    "unsupported-claims",
  ),
  unsupportedClaimsEmpty: document.getElementById(
    "unsupported-claims-empty",
  ),
  improvedReasoningSteps: document.getElementById(
    "improved-reasoning-steps",
  ),

  finalAnswer: document.getElementById("final-answer"),
  copyFinalAnswer: document.getElementById(
    "copy-final-answer",
  ),
  reviewReflection: document.getElementById(
    "review-reflection",
  ),
  startNewInvestigation: document.getElementById(
    "start-new-investigation",
  ),

  evidenceItemTemplate: document.getElementById(
    "evidence-item-template",
  ),
  graphPropertyTemplate: document.getElementById(
    "graph-property-template",
  ),
  listItemTemplate: document.getElementById(
    "list-item-template",
  ),
  evidenceReferenceTemplate: document.getElementById(
    "evidence-reference-template",
  ),

  evidenceDialog: document.getElementById("evidence-dialog"),
  evidenceDialogId: document.getElementById(
    "evidence-dialog-id",
  ),
  evidenceDialogTitle: document.getElementById(
    "evidence-dialog-title",
  ),
  evidenceDialogBody: document.getElementById(
    "evidence-dialog-body",
  ),
  closeEvidenceDialog: document.getElementById(
    "close-evidence-dialog",
  ),
};


/* ==========================================================
   4. UTILIDADES GENERALES
   ========================================================== */

/**
 * Normaliza un valor para utilizarlo como texto.
 */
function asText(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
}


/**
 * Determina si un valor es un arreglo no vacío.
 */
function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}


/**
 * Limita un número entre un valor mínimo y uno máximo.
 */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}


/**
 * Elimina todos los hijos de un elemento.
 */
function clearElement(element) {
  if (!element) {
    return;
  }

  element.replaceChildren();
}


/**
 * Cambia la visibilidad de un elemento utilizando is-hidden.
 */
function setHidden(element, hidden) {
  if (!element) {
    return;
  }

  element.classList.toggle("is-hidden", hidden);

  if (
    element.matches("[role='tabpanel']")
    || element.hasAttribute("hidden")
  ) {
    element.hidden = hidden;
  }
}


/**
 * Crea un elemento HTML con texto seguro.
 */
function createElement(
  tagName,
  {
    className = "",
    text = "",
    attributes = {},
  } = {},
) {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (text !== null && text !== undefined) {
    element.textContent = String(text);
  }

  Object.entries(attributes).forEach(([name, value]) => {
    if (value === null || value === undefined) {
      return;
    }

    element.setAttribute(name, String(value));
  });

  return element;
}


/**
 * Agrega elementos <li> seguros a una lista.
 */
function renderTextList(
  container,
  items,
  {
    ordered = false,
    emptyMessage = "",
  } = {},
) {
  if (!container) {
    return;
  }

  clearElement(container);

  const normalizedItems = Array.isArray(items)
    ? items.filter((item) => asText(item).trim())
    : [];

  if (normalizedItems.length === 0) {
    if (emptyMessage) {
      const item = createElement("li", {
        className: "empty-state",
        text: emptyMessage,
      });

      container.appendChild(item);
    }

    return;
  }

  normalizedItems.forEach((item) => {
    const listItem = createElement("li", {
      text: asText(item),
    });

    container.appendChild(listItem);
  });

  if (ordered) {
    container.setAttribute("data-list-type", "ordered");
  }
}


/**
 * Convierte una lista en una cadena legible.
 */
function formatInlineList(
  values,
  fallback = "Ninguno",
) {
  if (!hasItems(values)) {
    return fallback;
  }

  return values
    .map((value) => asText(value).trim())
    .filter(Boolean)
    .join(", ");
}


/**
 * Convierte una puntuación a un porcentaje seguro.
 */
function scoreToPercent(score, maximum = 100) {
  const numericScore = Number(score) || 0;
  const numericMaximum = Number(maximum) || 100;

  return clamp(
    (numericScore / numericMaximum) * 100,
    0,
    100,
  );
}


/**
 * Formatea un número decimal.
 */
function formatDecimal(value, digits = 2) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(numericValue);
}


/**
 * Intenta formatear una fecha sin alterar cadenas desconocidas.
 */
function formatDate(value) {
  const rawValue = asText(value).trim();

  if (!rawValue) {
    return "";
  }

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}/;

  if (!isoDatePattern.test(rawValue)) {
    return rawValue;
  }

  const dateOnly = rawValue.slice(0, 10);
  const [year, month, day] = dateOnly.split("-").map(Number);

  const date = new Date(year, month - 1, day);

  if (Number.isNaN(date.getTime())) {
    return rawValue;
  }

  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}


/**
 * Desplaza la vista hacia la parte superior.
 */
function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}


/**
 * Pausa la ejecución durante una cantidad de milisegundos.
 */
function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}


/**
 * Devuelve un mensaje legible para una excepción.
 */
function getErrorMessage(error) {
  if (!error) {
    return "Ocurrió un error inesperado.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error.name === "AbortError") {
    return (
      "La solicitud tardó demasiado tiempo. "
      + "Verifica que Neo4j y el servidor del modelo estén disponibles."
    );
  }

  if (error.message) {
    return error.message;
  }

  return "Ocurrió un error inesperado.";
}


/**
 * Activa o desactiva el estado de carga de un botón.
 */
function setButtonLoading(
  button,
  loading,
  {
    loadingText = "Procesando…",
    normalText = null,
  } = {},
) {
  if (!button) {
    return;
  }

  const label = button.querySelector(".button__label");
  const loader = button.querySelector(".button__loader");

  if (loading) {
    if (label && !button.dataset.normalLabel) {
      button.dataset.normalLabel = label.textContent.trim();
    }

    if (label) {
      label.textContent = loadingText;
    }

    if (loader) {
      loader.classList.remove("is-hidden");
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }

  if (label) {
    label.textContent = (
      normalText
      || button.dataset.normalLabel
      || label.textContent
    );
  }

  if (loader) {
    loader.classList.add("is-hidden");
  }

  button.removeAttribute("aria-busy");
  button.disabled = false;
}


/**
 * Realiza una solicitud HTTP con tiempo límite.
 */
async function apiRequest(
  url,
  {
    method = "GET",
    body = null,
    timeoutMs = CONFIG.requestTimeoutMs,
  } = {},
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  const requestOptions = {
    method,
    signal: controller.signal,
    headers: {
      Accept: "application/json",
    },
  };

  if (body !== null) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, requestOptions);

    const contentType = (
      response.headers.get("content-type")
      || ""
    );

    let payload = null;

    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      const text = await response.text();
      payload = text ? { detail: text } : {};
    }

    if (!response.ok) {
      const detail = (
        payload?.detail
        || payload?.message
        || `La solicitud falló con el código ${response.status}.`
      );

      throw new Error(detail);
    }

    return payload;
  } finally {
    window.clearTimeout(timeoutId);
  }
}


/* ==========================================================
   5. MENSAJES GLOBALES
   ========================================================== */

function showError(message) {
  if (!elements.globalError || !elements.globalErrorMessage) {
    return;
  }

  elements.globalErrorMessage.textContent = asText(
    message,
    "Ocurrió un error inesperado.",
  );

  setHidden(elements.globalError, false);
  setHidden(elements.globalMessage, true);

  elements.globalError.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}


function hideError() {
  setHidden(elements.globalError, true);

  if (elements.globalErrorMessage) {
    elements.globalErrorMessage.textContent = "";
  }
}


function showMessage(message) {
  if (
    !elements.globalMessage
    || !elements.globalMessageText
  ) {
    return;
  }

  elements.globalMessageText.textContent = asText(message);

  setHidden(elements.globalMessage, false);
  setHidden(elements.globalError, true);
}


function hideMessage() {
  setHidden(elements.globalMessage, true);

  if (elements.globalMessageText) {
    elements.globalMessageText.textContent = "";
  }
}


/* ==========================================================
   6. TEMA VISUAL
   ========================================================== */

function getPreferredTheme() {
  const storedTheme = localStorage.getItem(
    CONFIG.storageKeys.theme,
  );

  if (
    storedTheme === "light"
    || storedTheme === "dark"
  ) {
    return storedTheme;
  }

  return window.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches
    ? "dark"
    : "light";
}


function applyTheme(theme, persist = true) {
  const normalizedTheme = theme === "dark"
    ? "dark"
    : "light";

  elements.html.dataset.theme = normalizedTheme;

  if (persist) {
    localStorage.setItem(
      CONFIG.storageKeys.theme,
      normalizedTheme,
    );
  }

  const darkModeEnabled = normalizedTheme === "dark";

  if (elements.themeToggle) {
    elements.themeToggle.setAttribute(
      "aria-pressed",
      String(darkModeEnabled),
    );

    elements.themeToggle.setAttribute(
      "aria-label",
      darkModeEnabled
        ? "Activar modo claro"
        : "Activar modo oscuro",
    );
  }

  if (elements.themeToggleLabel) {
    elements.themeToggleLabel.textContent = darkModeEnabled
      ? "Modo claro"
      : "Modo oscuro";
  }
}


function toggleTheme() {
  const currentTheme = elements.html.dataset.theme;
  const nextTheme = currentTheme === "dark"
    ? "light"
    : "dark";

  applyTheme(nextTheme);
}


/* ==========================================================
   7. SALUD DE LOS SERVICIOS
   ========================================================== */

function updateHealthStatus({
  online,
  text,
}) {
  state.health.checked = true;
  state.health.online = online;

  if (elements.systemStatus) {
    elements.systemStatus.classList.toggle(
      "is-online",
      online,
    );

    elements.systemStatus.classList.toggle(
      "is-offline",
      !online,
    );
  }

  if (elements.systemStatusText) {
    elements.systemStatusText.textContent = text;
  }
}


async function checkSystemHealth() {
  if (elements.systemStatusText) {
    elements.systemStatusText.textContent = (
      "Verificando servicios"
    );
  }

  try {
    const health = await apiRequest(
      CONFIG.api.health,
      {
        timeoutMs: 15000,
      },
    );

    const neo4jConnected = (
      health?.neo4j === "connected"
      && health?.status === "ok"
    );

    if (!neo4jConnected) {
      throw new Error(
        "El servidor respondió, pero Neo4j no está disponible.",
      );
    }

    updateHealthStatus({
      online: true,
      text: "Grafo disponible",
    });
  } catch (error) {
    console.error(
      "No fue posible verificar la salud del sistema:",
      error,
    );

    updateHealthStatus({
      online: false,
      text: "Servicios no disponibles",
    });
  }
}


/* ==========================================================
   8. NAVEGACIÓN ENTRE ETAPAS
   ========================================================== */

function getSectionIndex(sectionName) {
  return SECTION_ORDER.indexOf(sectionName);
}


function setCurrentSection(
  sectionName,
  {
    scroll = true,
  } = {},
) {
  if (!SECTION_ORDER.includes(sectionName)) {
    console.warn(
      `Se intentó abrir una sección desconocida: ${sectionName}`,
    );
    return;
  }

  state.currentSection = sectionName;

  Object.entries(elements.sections).forEach(
    ([name, sectionElement]) => {
      setHidden(sectionElement, name !== sectionName);
    },
  );

  const currentIndex = getSectionIndex(sectionName);

  document
    .querySelectorAll(".progress-step")
    .forEach((stepElement) => {
      const stepName = stepElement.dataset.step;
      const stepIndex = getSectionIndex(stepName);

      const isActive = stepName === sectionName;
      const isComplete = (
        stepIndex >= 0
        && stepIndex < currentIndex
      );

      stepElement.classList.toggle(
        "is-active",
        isActive,
      );

      stepElement.classList.toggle(
        "is-complete",
        isComplete,
      );

      if (isActive) {
        stepElement.setAttribute(
          "aria-current",
          "step",
        );
      } else {
        stepElement.removeAttribute("aria-current");
      }
    });

  if (scroll) {
    scrollToTop();
  }
}


/**
 * Permite navegar únicamente a etapas ya disponibles.
 */
function canNavigateToSection(sectionName) {
  switch (sectionName) {
    case "question":
      return true;

    case "plan":
      return Boolean(state.plan);

    case "evidence":
      return (
        Boolean(state.plan)
        && Array.isArray(state.evidence)
      );

    case "reflection":
      return Boolean(state.challenge);

    case "synthesis":
      return (
        Boolean(state.evaluation)
        && Boolean(state.finalAnswer)
      );

    default:
      return false;
  }
}


function handleProgressNavigation(event) {
  const step = event.target.closest(".progress-step");

  if (!step) {
    return;
  }

  const sectionName = step.dataset.step;

  if (!canNavigateToSection(sectionName)) {
    return;
  }

  setCurrentSection(sectionName);
}


/* ==========================================================
   9. VALIDACIÓN DE LA PREGUNTA
   ========================================================== */

function getQuestionValue() {
  return elements.questionInput
    ? elements.questionInput.value.trim()
    : "";
}


function validateQuestion({
  showValidationError = false,
} = {}) {
  const question = getQuestionValue();
  const length = question.length;

  const isValid = (
    length >= CONFIG.limits.questionMinLength
    && length <= CONFIG.limits.questionMaxLength
  );

  if (elements.questionCounter) {
    elements.questionCounter.textContent = (
      `${length} / ${CONFIG.limits.questionMaxLength}`
    );
  }

  if (elements.questionError) {
    const shouldShowError = (
      showValidationError
      && !isValid
    );

    setHidden(
      elements.questionError,
      !shouldShowError,
    );

    if (
      length > 0
      && length < CONFIG.limits.questionMinLength
    ) {
      elements.questionError.textContent = (
        `La pregunta debe contener al menos `
        + `${CONFIG.limits.questionMinLength} caracteres.`
      );
    } else if (
      length > CONFIG.limits.questionMaxLength
    ) {
      elements.questionError.textContent = (
        `La pregunta no puede superar `
        + `${CONFIG.limits.questionMaxLength} caracteres.`
      );
    } else {
      elements.questionError.textContent = (
        "Escribe una pregunta válida."
      );
    }
  }

  if (elements.questionInput) {
    elements.questionInput.setAttribute(
      "aria-invalid",
      String(showValidationError && !isValid),
    );
  }

  if (elements.submitQuestion) {
    elements.submitQuestion.disabled = (
      !isValid
      || state.loading
    );
  }

  return isValid;
}


function handleQuestionInput() {
  hideError();
  hideMessage();

  validateQuestion({
    showValidationError: false,
  });
}


function handleExampleQuestion(event) {
  const button = event.currentTarget;
  const exampleQuestion = button.dataset.exampleQuestion || "";

  if (!elements.questionInput) {
    return;
  }

  elements.questionInput.value = exampleQuestion;
  elements.questionInput.focus();

  validateQuestion({
    showValidationError: false,
  });
}


/* ==========================================================
   10. ESTADO DE CARGA DE LA INVESTIGACIÓN
   ========================================================== */

function resetLoadingSteps() {
  if (!elements.loadingSteps) {
    return;
  }

  elements.loadingSteps
    .querySelectorAll("[data-loading-step]")
    .forEach((item) => {
      item.classList.remove(
        "is-active",
        "is-complete",
      );
    });
}


function setLoadingStep(stepName) {
  if (!elements.loadingSteps) {
    return;
  }

  const targetIndex = CONFIG.loadingMessages.findIndex(
    (item) => item.step === stepName,
  );

  elements.loadingSteps
    .querySelectorAll("[data-loading-step]")
    .forEach((item) => {
      const itemStep = item.dataset.loadingStep;

      const itemIndex = CONFIG.loadingMessages.findIndex(
        (loadingItem) => loadingItem.step === itemStep,
      );

      item.classList.toggle(
        "is-complete",
        itemIndex >= 0 && itemIndex < targetIndex,
      );

      item.classList.toggle(
        "is-active",
        itemStep === stepName,
      );
    });

  const loadingDefinition = CONFIG.loadingMessages.find(
    (item) => item.step === stepName,
  );

  if (
    loadingDefinition
    && elements.investigationLoadingMessage
  ) {
    elements.investigationLoadingMessage.textContent = (
      loadingDefinition.message
    );
  }
}


function completeLoadingSteps() {
  if (!elements.loadingSteps) {
    return;
  }

  elements.loadingSteps
    .querySelectorAll("[data-loading-step]")
    .forEach((item) => {
      item.classList.remove("is-active");
      item.classList.add("is-complete");
    });

  if (elements.investigationLoadingMessage) {
    elements.investigationLoadingMessage.textContent = (
      "Expediente construido correctamente."
    );
  }
}


function showInvestigationLoading() {
  resetLoadingSteps();

  Object.values(elements.sections).forEach((section) => {
    setHidden(section, true);
  });

  setHidden(elements.investigationLoading, false);

  setLoadingStep("planning");
  scrollToTop();
}


function hideInvestigationLoading() {
  setHidden(elements.investigationLoading, true);
}


/**
 * Anima las etapas mientras el servidor procesa la solicitud.
 * La animación es indicativa: el backend devuelve todas las
 * etapas en una sola respuesta.
 */
function startLoadingSequence() {
  let stopped = false;
  let currentIndex = 0;

  const advance = async () => {
    while (
      !stopped
      && currentIndex < CONFIG.loadingMessages.length
    ) {
      const item = CONFIG.loadingMessages[currentIndex];

      setLoadingStep(item.step);

      currentIndex += 1;

      await wait(
        currentIndex === 1
          ? 700
          : 1200,
      );
    }
  };

  advance();

  return {
    stop() {
      stopped = true;
    },
  };
}


/* ==========================================================
   11. NORMALIZACIÓN DE LA RESPUESTA
   ========================================================== */

function applyInvestigationResponse(response) {
  state.investigation = response;

  state.sessionId = response?.session_id || null;
  state.question = response?.question || state.question;

  state.plan = response?.plan || null;

  state.evidence = Array.isArray(response?.evidence)
    ? response.evidence
    : [];

  state.audit = response?.audit || null;

  state.counterAnalysis = (
    response?.counter_analysis
    || null
  );

  state.challenge = response?.challenge || null;
  state.evaluation = response?.evaluation || null;
  state.finalAnswer = response?.final_answer || null;

  state.graphSnapshot = {
    nodes: Array.isArray(
      response?.graph_snapshot?.nodes,
    )
      ? response.graph_snapshot.nodes
      : [],

    edges: Array.isArray(
      response?.graph_snapshot?.edges,
    )
      ? response.graph_snapshot.edges
      : [],
  };

  state.graphCapabilities = Array.isArray(
    response?.graph_capabilities,
  )
    ? response.graph_capabilities
    : [];

  state.graphLimitations = Array.isArray(
    response?.graph_limitations,
  )
    ? response.graph_limitations
    : [];
}


/* ==========================================================
   12. INICIO DE LA INVESTIGACIÓN
   ========================================================== */

async function handleQuestionSubmit(event) {
  event.preventDefault();

  hideError();
  hideMessage();

  const validQuestion = validateQuestion({
    showValidationError: true,
  });

  if (!validQuestion || state.loading) {
    return;
  }

  const question = getQuestionValue();

  state.loading = true;
  state.question = question;

  setButtonLoading(
    elements.submitQuestion,
    true,
    {
      loadingText: "Investigando…",
    },
  );

  showInvestigationLoading();

  const loadingSequence = startLoadingSequence();

  try {
    const response = await apiRequest(
      CONFIG.api.investigate,
      {
        method: "POST",
        body: {
          question,
          session_id: null,
          reflection: null,
        },
      },
    );

    loadingSequence.stop();
    completeLoadingSteps();

    applyInvestigationResponse(response);

    /*
     * El endpoint actual ejecuta planificación, recuperación,
     * auditoría y reto en una misma llamada. La interfaz muestra
     * primero el plan y conserva el expediente en el estado para
     * presentarlo cuando el estudiante pulse "Abrir expediente".
     */

    renderPlan(state.plan);

    await wait(350);

    hideInvestigationLoading();
    setCurrentSection("plan");
  } catch (error) {
    loadingSequence.stop();
    hideInvestigationLoading();

    setCurrentSection("question", {
      scroll: false,
    });

    showError(getErrorMessage(error));
  } finally {
    state.loading = false;

    setButtonLoading(
      elements.submitQuestion,
      false,
      {
        normalText: "Planificar investigación",
      },
    );

    validateQuestion({
      showValidationError: false,
    });
  }
}


/* ==========================================================
   13. RENDERIZADO DEL PLAN
   ========================================================== */

function renderPlan(plan) {
  if (!plan) {
    showError(
      "El servidor no devolvió un plan de investigación.",
    );
    return;
  }

  if (elements.plannedQuestion) {
    elements.plannedQuestion.textContent = (
      `Pregunta original: ${state.question}`
    );
  }

  if (elements.planIntent) {
    elements.planIntent.textContent = (
      INTENT_LABELS[plan.intent]
      || INTENT_LABELS.general_research
    );
  }

  if (elements.normalizedQuestion) {
    elements.normalizedQuestion.textContent = (
      plan.normalized_question
      || state.question
    );
  }

  if (elements.retrievalQuery) {
    elements.retrievalQuery.textContent = (
      plan.retrieval_query
      || state.question
    );
  }

  renderPlanSubquestions(plan.subquestions);

  if (elements.planPeople) {
    elements.planPeople.textContent = formatInlineList(
      plan.people,
      "Ninguna persona identificada",
    );
  }

  if (elements.planTopics) {
    elements.planTopics.textContent = formatInlineList(
      plan.topics,
      "Ningún tema identificado",
    );
  }

  if (elements.planLaws) {
    elements.planLaws.textContent = formatInlineList(
      plan.laws,
      "Ninguna ley identificada",
    );
  }

  renderTextList(
    elements.requiredCapabilities,
    plan.required_capabilities,
    {
      emptyMessage: (
        "No se especificaron capacidades adicionales."
      ),
    },
  );

  renderUnavailableCapabilities(
    plan.unavailable_capabilities,
  );

  renderSafetyNotes(plan.safety_notes);
}


function renderPlanSubquestions(subquestions) {
  clearElement(elements.planSubquestions);

  const items = Array.isArray(subquestions)
    ? subquestions.filter(
      (item) => asText(item).trim(),
    )
    : [];

  const hasSubquestions = items.length > 0;

  setHidden(
    elements.planSubquestions,
    !hasSubquestions,
  );

  setHidden(
    elements.planSubquestionsEmpty,
    hasSubquestions,
  );

  items.forEach((subquestion) => {
    const item = createElement("li", {
      text: subquestion,
    });

    elements.planSubquestions.appendChild(item);
  });
}


function renderUnavailableCapabilities(capabilities) {
  clearElement(elements.unavailableCapabilities);

  const items = Array.isArray(capabilities)
    ? capabilities.filter(
      (item) => asText(item).trim(),
    )
    : [];

  const hasUnavailableCapabilities = items.length > 0;

  setHidden(
    elements.unavailableCapabilities,
    !hasUnavailableCapabilities,
  );

  setHidden(
    elements.unavailableCapabilitiesEmpty,
    hasUnavailableCapabilities,
  );

  items.forEach((capability) => {
    const item = createElement("li", {
      text: capability,
    });

    elements.unavailableCapabilities.appendChild(item);
  });
}


function renderSafetyNotes(notes) {
  clearElement(elements.safetyNotes);

  const items = Array.isArray(notes)
    ? notes.filter((item) => asText(item).trim())
    : [];

  setHidden(
    elements.safetyNotesPanel,
    items.length === 0,
  );

  items.forEach((note) => {
    const item = createElement("li", {
      text: note,
    });

    elements.safetyNotes.appendChild(item);
  });
}


/* ==========================================================
   14. NAVEGACIÓN DESDE EL PLAN
   ========================================================== */

function handleEditQuestion() {
  setCurrentSection("question");

  if (elements.questionInput) {
    elements.questionInput.focus();
  }
}


function handleOpenEvidence() {
  hideError();
  hideMessage();

  if (!state.investigation) {
    showError(
      "No hay un expediente disponible. "
      + "Inicia nuevamente la investigación.",
    );

    setCurrentSection("question");
    return;
  }

  /*
   * Las funciones siguientes se definen en la parte 2:
   *
   * - renderEvidenceWorkspace()
   * - activateTab()
   */

  renderEvidenceWorkspace();
  activateTab("graph");
  setCurrentSection("evidence");
}


/* ==========================================================
   15. REGISTRO DE EVENTOS DE ESTA PRIMERA PARTE
   ========================================================== */

function registerCoreEventListeners() {
  elements.themeToggle?.addEventListener(
    "click",
    toggleTheme,
  );

  elements.dismissError?.addEventListener(
    "click",
    hideError,
  );

  elements.progressSteps?.addEventListener(
    "click",
    handleProgressNavigation,
  );

  elements.questionInput?.addEventListener(
    "input",
    handleQuestionInput,
  );

  elements.questionForm?.addEventListener(
    "submit",
    handleQuestionSubmit,
  );

  elements.exampleQuestionButtons.forEach((button) => {
    button.addEventListener(
      "click",
      handleExampleQuestion,
    );
  });

  elements.editQuestion?.addEventListener(
    "click",
    handleEditQuestion,
  );

  elements.openEvidence?.addEventListener(
    "click",
    handleOpenEvidence,
  );
}


/* ==========================================================
   16. INICIALIZACIÓN
   ========================================================== */

function initializeApplication() {
  applyTheme(
    getPreferredTheme(),
    false,
  );

  registerCoreEventListeners();

  /*
   * Las siguientes funciones se definen en las partes 2 y 3.
   * Al estar todo el código en el mismo archivo, estarán
   * disponibles cuando DOMContentLoaded ejecute esta función.
   */

  registerEvidenceEventListeners();
  registerReflectionEventListeners();

  validateQuestion({
    showValidationError: false,
  });

  setCurrentSection("question", {
    scroll: false,
  });

  checkSystemHealth();
}


if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeApplication,
    {
      once: true,
    },
  );
} else {
  initializeApplication();
}


/* ==========================================================
   FIN DE LA PARTE 1 DE 3

   La parte 2 añadirá:
   - Renderizado del expediente.
   - Pestañas.
   - Fuentes.
   - Auditoría.
   - Capacidades y limitaciones.
   - Visualización interactiva del grafo.
   - Diálogo de detalle de evidencia.
   ========================================================== */
   /* ==========================================================
   ÁgoraMX
   Archivo: /static/js/app.js
   Parte 2 de 3

   Esta parte contiene:
   - Renderizado general del expediente.
   - Navegación mediante pestañas.
   - Estadísticas del expediente.
   - Lista y filtrado de evidencias.
   - Auditoría de evidencia.
   - Capacidades y limitaciones del grafo.
   - Diálogo de detalle de evidencia.
   - Visualización SVG del grafo.
   - Zoom, desplazamiento y selección de nodos.
   ========================================================== */

/* ==========================================================
   17. CONSTANTES DEL GRAFO
   ========================================================== */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";


const GRAPH_CONFIG = Object.freeze({
  width: 1000,
  height: 560,

  minimumScale: 0.45,
  maximumScale: 2.8,
  zoomStep: 1.18,

  nodeRadius: 21,
  selectedNodeRadius: 28,

  marginX: 90,
  marginY: 70,

  columns: {
    person: 120,
    initiative: 350,
    topic: 590,
    law: 790,
    document: 920,
  },

  typeOrder: [
    "person",
    "initiative",
    "topic",
    "law",
    "document",
  ],
});


/* ==========================================================
   18. UTILIDADES PARA SVG
   ========================================================== */

/**
 * Crea un elemento SVG con atributos seguros.
 */
function createSvgElement(
  tagName,
  attributes = {},
) {
  const element = document.createElementNS(
    SVG_NAMESPACE,
    tagName,
  );

  Object.entries(attributes).forEach(([name, value]) => {
    if (value === null || value === undefined) {
      return;
    }

    element.setAttribute(name, String(value));
  });

  return element;
}


/**
 * Acorta una etiqueta para evitar que desborde el grafo.
 */
function truncateGraphLabel(
  value,
  maximumLength = 28,
) {
  const label = asText(value).trim();

  if (label.length <= maximumLength) {
    return label;
  }

  return `${label.slice(0, maximumLength - 1)}…`;
}


/**
 * Convierte las coordenadas de pantalla a coordenadas SVG.
 */
function clientPointToSvg(event) {
  if (!elements.evidenceGraph) {
    return {
      x: 0,
      y: 0,
    };
  }

  const rect = elements.evidenceGraph.getBoundingClientRect();

  const widthRatio = GRAPH_CONFIG.width / rect.width;
  const heightRatio = GRAPH_CONFIG.height / rect.height;

  return {
    x: (event.clientX - rect.left) * widthRatio,
    y: (event.clientY - rect.top) * heightRatio,
  };
}


/**
 * Convierte un punto SVG a las coordenadas internas del grafo,
 * teniendo en cuenta la transformación del viewport.
 */
function svgPointToGraph(point) {
  const scale = state.graphView.scale || 1;

  return {
    x: (point.x - state.graphView.x) / scale,
    y: (point.y - state.graphView.y) / scale,
  };
}


/* ==========================================================
   19. RENDERIZADO GENERAL DEL EXPEDIENTE
   ========================================================== */

function renderEvidenceWorkspace() {
  renderEvidenceStatistics();
  renderAnswerability();
  renderEvidenceList();
  renderAudit();
  renderGraphCapabilities();
  prepareGraphData();
  renderGraph();
}


/* ==========================================================
   20. ESTADÍSTICAS DEL EXPEDIENTE
   ========================================================== */

function renderEvidenceStatistics() {
  const evidence = Array.isArray(state.evidence)
    ? state.evidence
    : [];

  const graphNodes = Array.isArray(
    state.graphSnapshot?.nodes,
  )
    ? state.graphSnapshot.nodes
    : [];

  const initiativeKeys = new Set();
  const personKeys = new Set();
  const topicKeys = new Set();

  evidence.forEach((item) => {
    if (item?.kind === "initiative") {
      const initiativeKey = (
        item.sil_id
        || item.title
        || item.evidence_id
      );

      if (initiativeKey) {
        initiativeKeys.add(initiativeKey);
      }
    }
  });

  graphNodes.forEach((node) => {
    if (!node) {
      return;
    }

    if (node.node_type === "initiative") {
      initiativeKeys.add(node.id || node.label);
    }

    if (node.node_type === "person") {
      personKeys.add(node.id || node.label);
    }

    if (node.node_type === "topic") {
      topicKeys.add(node.id || node.label);
    }
  });

  if (elements.initiativeCount) {
    elements.initiativeCount.textContent = String(
      initiativeKeys.size,
    );
  }

  if (elements.personCount) {
    elements.personCount.textContent = String(
      personKeys.size,
    );
  }

  if (elements.topicCount) {
    elements.topicCount.textContent = String(
      topicKeys.size,
    );
  }

  if (elements.evidenceCount) {
    elements.evidenceCount.textContent = String(
      evidence.length,
    );
  }
}


function renderAnswerability() {
  if (!elements.answerabilityBadge) {
    return;
  }

  const answerability = (
    state.audit?.answerability
    || "insufficient"
  );

  elements.answerabilityBadge.textContent = (
    ANSWERABILITY_LABELS[answerability]
    || "Por determinar"
  );

  elements.answerabilityBadge.classList.remove(
    "is-sufficient",
    "is-partial",
    "is-insufficient",
  );

  elements.answerabilityBadge.classList.add(
    `is-${answerability}`,
  );
}


/* ==========================================================
   21. NAVEGACIÓN MEDIANTE PESTAÑAS
   ========================================================== */

function activateTab(tabName, {
  focus = false,
} = {}) {
  const matchingButton = Array.from(
    elements.tabButtons,
  ).find((button) => button.dataset.tab === tabName);

  const matchingPanel = Array.from(
    elements.tabPanels,
  ).find(
    (panel) => panel.dataset.tabPanel === tabName,
  );

  if (!matchingButton || !matchingPanel) {
    return;
  }

  elements.tabButtons.forEach((button) => {
    const active = button === matchingButton;

    button.classList.toggle("is-active", active);
    button.setAttribute(
      "aria-selected",
      String(active),
    );

    button.tabIndex = active ? 0 : -1;
  });

  elements.tabPanels.forEach((panel) => {
    const active = panel === matchingPanel;

    panel.classList.toggle("is-hidden", !active);
    panel.hidden = !active;
  });

  if (focus) {
    matchingButton.focus();
  }

  /*
   * El SVG puede haber sido dibujado mientras estaba oculto.
   * Al abrir su pestaña se vuelve a aplicar la transformación.
   */
  if (tabName === "graph") {
    applyGraphViewportTransform();
  }
}


function handleTabClick(event) {
  const button = event.target.closest("[data-tab]");

  if (!button) {
    return;
  }

  activateTab(button.dataset.tab);
}


function handleTabKeydown(event) {
  const availableButtons = Array.from(
    elements.tabButtons,
  );

  const currentIndex = availableButtons.indexOf(
    document.activeElement,
  );

  if (currentIndex < 0) {
    return;
  }

  let targetIndex = currentIndex;

  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      targetIndex = (
        currentIndex + 1
      ) % availableButtons.length;
      break;

    case "ArrowLeft":
    case "ArrowUp":
      targetIndex = (
        currentIndex - 1 + availableButtons.length
      ) % availableButtons.length;
      break;

    case "Home":
      targetIndex = 0;
      break;

    case "End":
      targetIndex = availableButtons.length - 1;
      break;

    default:
      return;
  }

  event.preventDefault();

  const targetButton = availableButtons[targetIndex];

  activateTab(
    targetButton.dataset.tab,
    {
      focus: true,
    },
  );
}


/* ==========================================================
   22. LISTA DE EVIDENCIAS
   ========================================================== */

function getFilteredEvidence() {
  const evidence = Array.isArray(state.evidence)
    ? state.evidence
    : [];

  if (
    !state.evidenceFilter
    || state.evidenceFilter === "all"
  ) {
    return evidence;
  }

  return evidence.filter(
    (item) => item.kind === state.evidenceFilter,
  );
}


function renderEvidenceList() {
  if (!elements.evidenceList) {
    return;
  }

  clearElement(elements.evidenceList);

  const evidence = getFilteredEvidence();
  const hasEvidence = evidence.length > 0;

  setHidden(elements.evidenceList, !hasEvidence);
  setHidden(elements.evidenceEmptyState, hasEvidence);

  evidence.forEach((item) => {
    const listItem = createEvidenceListItem(item);
    elements.evidenceList.appendChild(listItem);
  });
}


function createEvidenceListItem(evidenceItem) {
  const template = elements.evidenceItemTemplate;

  if (!template) {
    return createElement("li", {
      text: (
        `${evidenceItem.evidence_id}: `
        + `${evidenceItem.title}`
      ),
    });
  }

  const fragment = template.content.cloneNode(true);
  const root = fragment.querySelector(".evidence-item");

  const evidenceId = fragment.querySelector(".evidence-id");
  const evidenceKind = fragment.querySelector(".evidence-kind");
  const evidenceScore = fragment.querySelector(
    ".evidence-score",
  );
  const evidenceTitle = fragment.querySelector(
    ".evidence-title",
  );

  const politicianField = fragment.querySelector(
    ".evidence-politician-field",
  );
  const evidencePolitician = fragment.querySelector(
    ".evidence-politician",
  );

  const dateField = fragment.querySelector(
    ".evidence-date-field",
  );
  const evidenceDate = fragment.querySelector(
    ".evidence-date",
  );

  const pageField = fragment.querySelector(
    ".evidence-page-field",
  );
  const evidencePage = fragment.querySelector(
    ".evidence-page",
  );

  const silField = fragment.querySelector(
    ".evidence-sil-field",
  );
  const evidenceSil = fragment.querySelector(
    ".evidence-sil",
  );

  const evidenceExcerpt = fragment.querySelector(
    ".evidence-excerpt",
  );

  const primarySource = fragment.querySelector(
    ".evidence-primary-source",
  );
  const directSupport = fragment.querySelector(
    ".evidence-direct-support",
  );

  const sourceLink = fragment.querySelector(
    ".evidence-source-link",
  );

  const normalizedId = (
    evidenceItem.evidence_id
    || "E?"
  );

  evidenceId.textContent = normalizedId;

  evidenceKind.textContent = (
    EVIDENCE_KIND_LABELS[evidenceItem.kind]
    || evidenceItem.kind
    || "Evidencia"
  );

  const numericScore = Number(evidenceItem.score);

  if (Number.isFinite(numericScore)) {
    evidenceScore.textContent = (
      `Similitud: ${formatDecimal(numericScore, 3)}`
    );
  } else {
    setHidden(evidenceScore, true);
  }

  evidenceTitle.textContent = (
    evidenceItem.title
    || "Evidencia sin título"
  );

  setMetadataField(
    politicianField,
    evidencePolitician,
    normalizePoliticianValue(evidenceItem.politician),
  );

  setMetadataField(
    dateField,
    evidenceDate,
    formatDate(evidenceItem.date),
  );

  setMetadataField(
    pageField,
    evidencePage,
    evidenceItem.page !== null
      && evidenceItem.page !== undefined
      ? String(evidenceItem.page)
      : "",
  );

  setMetadataField(
    silField,
    evidenceSil,
    evidenceItem.sil_id,
  );

  evidenceExcerpt.textContent = (
    evidenceItem.excerpt
    || "El registro no contiene un extracto textual."
  );

  setHidden(
    primarySource,
    !evidenceItem.primary_source,
  );

  setHidden(
    directSupport,
    !evidenceItem.direct_support,
  );

  const sourceUrl = sanitizeExternalUrl(
    evidenceItem.source_url,
  );

  if (sourceUrl) {
    sourceLink.href = sourceUrl;
    sourceLink.hidden = false;
  } else {
    sourceLink.removeAttribute("href");
    sourceLink.hidden = true;
  }

  root.dataset.evidenceId = normalizedId;

  root.addEventListener("dblclick", () => {
    openEvidenceDialog(normalizedId);
  });

  evidenceId.setAttribute(
    "title",
    "Abrir detalle de evidencia",
  );

  evidenceId.setAttribute("role", "button");
  evidenceId.tabIndex = 0;

  evidenceId.addEventListener("click", () => {
    openEvidenceDialog(normalizedId);
  });

  evidenceId.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter"
      || event.key === " "
    ) {
      event.preventDefault();
      openEvidenceDialog(normalizedId);
    }
  });

  return fragment;
}


function setMetadataField(
  fieldElement,
  valueElement,
  value,
) {
  const normalizedValue = asText(value).trim();

  if (!fieldElement || !valueElement) {
    return;
  }

  if (!normalizedValue) {
    fieldElement.hidden = true;
    return;
  }

  fieldElement.hidden = false;
  valueElement.textContent = normalizedValue;
}


/**
 * Tolera cadenas, arreglos de nombres y arreglos de objetos.
 */
function normalizePoliticianValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (
        item
        && typeof item === "object"
      ) {
        const name = asText(item.name).trim();
        const party = asText(item.party).trim();

        if (name && party) {
          return `${name} (${party})`;
        }

        return name || party;
      }

      return "";
    })
    .filter(Boolean)
    .join(", ");
}


/**
 * Solo permite enlaces HTTP o HTTPS.
 */
function sanitizeExternalUrl(value) {
  const rawValue = asText(value).trim();

  if (!rawValue) {
    return "";
  }

  try {
    const parsedUrl = new URL(
      rawValue,
      window.location.origin,
    );

    if (
      parsedUrl.protocol !== "http:"
      && parsedUrl.protocol !== "https:"
    ) {
      return "";
    }

    return parsedUrl.href;
  } catch {
    return "";
  }
}


function handleEvidenceFilterChange(event) {
  state.evidenceFilter = event.target.value || "all";
  renderEvidenceList();
}


/* ==========================================================
   23. AUDITORÍA
   ========================================================== */

function renderAudit() {
  const audit = state.audit || {
    source_quality_score: 0,
    coverage_score: 0,
    supported_questions: [],
    unsupported_questions: [],
    missing_evidence: [],
    risk_flags: [],
    notes: "",
  };

  renderAuditScore(
    elements.sourceQualityScore,
    elements.sourceQualityMeter,
    audit.source_quality_score,
  );

  renderAuditScore(
    elements.coverageScore,
    elements.coverageMeter,
    audit.coverage_score,
  );

  renderAuditListWithEmptyState({
    listElement: elements.supportedQuestions,
    emptyElement: elements.supportedQuestionsEmpty,
    items: audit.supported_questions,
  });

  renderAuditListWithEmptyState({
    listElement: elements.unsupportedQuestions,
    emptyElement: elements.unsupportedQuestionsEmpty,
    items: audit.unsupported_questions,
  });

  renderTextList(
    elements.missingEvidence,
    audit.missing_evidence,
    {
      emptyMessage: (
        "No se identificó evidencia faltante específica."
      ),
    },
  );

  renderTextList(
    elements.riskFlags,
    audit.risk_flags,
    {
      emptyMessage: (
        "No se identificaron riesgos metodológicos adicionales."
      ),
    },
  );

  if (elements.auditNotes) {
    elements.auditNotes.textContent = (
      audit.notes
      || "La auditoría no incluyó notas adicionales."
    );
  }
}


function renderAuditScore(
  scoreElement,
  meterElement,
  score,
) {
  const normalizedScore = clamp(
    Number(score) || 0,
    0,
    100,
  );

  if (scoreElement) {
    scoreElement.textContent = String(
      Math.round(normalizedScore),
    );
  }

  if (meterElement) {
    meterElement.setAttribute(
      "aria-valuenow",
      String(Math.round(normalizedScore)),
    );

    const bar = meterElement.querySelector(
      ".progress-meter__bar",
    );

    if (bar) {
      requestAnimationFrame(() => {
        bar.style.width = `${normalizedScore}%`;
      });
    }
  }
}


function renderAuditListWithEmptyState({
  listElement,
  emptyElement,
  items,
}) {
  const normalizedItems = Array.isArray(items)
    ? items.filter((item) => asText(item).trim())
    : [];

  const hasListItems = normalizedItems.length > 0;

  setHidden(listElement, !hasListItems);
  setHidden(emptyElement, hasListItems);

  if (hasListItems) {
    renderTextList(
      listElement,
      normalizedItems,
    );
  } else {
    clearElement(listElement);
  }
}


/* ==========================================================
   24. CAPACIDADES Y LIMITACIONES
   ========================================================== */

function renderGraphCapabilities() {
  renderTextList(
    elements.graphCapabilities,
    state.graphCapabilities,
    {
      emptyMessage: (
        "El servidor no informó capacidades del grafo."
      ),
    },
  );

  renderTextList(
    elements.graphLimitations,
    state.graphLimitations,
    {
      emptyMessage: (
        "El servidor no informó limitaciones adicionales."
      ),
    },
  );
}


/* ==========================================================
   25. DIÁLOGO DE EVIDENCIA
   ========================================================== */

function findEvidenceById(evidenceId) {
  const normalizedId = normalizeEvidenceId(
    evidenceId,
  );

  if (!normalizedId) {
    return null;
  }

  const evidence = Array.isArray(state.evidence)
    ? state.evidence
    : [];

  return evidence.find((item) => (
    normalizeEvidenceId(item?.evidence_id)
    === normalizedId
  )) || null;
}


function openEvidenceDialog(evidenceId) {
  const evidenceItem = findEvidenceById(evidenceId);

  if (!evidenceItem || !elements.evidenceDialog) {
    return;
  }

  clearElement(elements.evidenceDialogBody);

  if (elements.evidenceDialogId) {
    elements.evidenceDialogId.textContent = (
      evidenceItem.evidence_id
      || "E?"
    );
  }

  if (elements.evidenceDialogTitle) {
    elements.evidenceDialogTitle.textContent = (
      evidenceItem.title
      || "Detalle de evidencia"
    );
  }

  const content = createElement("article", {
    className: "evidence-dialog-detail",
  });

  const typeBadge = createElement("span", {
    className: "status-badge",
    text: (
      EVIDENCE_KIND_LABELS[evidenceItem.kind]
      || evidenceItem.kind
      || "Evidencia"
    ),
  });

  content.appendChild(typeBadge);

  const metadata = createElement("dl", {
    className: "graph-property-list",
  });

  appendDefinitionItem(
    metadata,
    "Identificador",
    evidenceItem.evidence_id,
  );

  appendDefinitionItem(
    metadata,
    "Fuente",
    evidenceItem.source_label,
  );

  appendDefinitionItem(
    metadata,
    "SIL",
    evidenceItem.sil_id,
  );

  appendDefinitionItem(
    metadata,
    "Promovente",
    normalizePoliticianValue(
      evidenceItem.politician,
    ),
  );

  appendDefinitionItem(
    metadata,
    "Fecha",
    formatDate(evidenceItem.date),
  );

  appendDefinitionItem(
    metadata,
    "Página",
    evidenceItem.page !== null
      && evidenceItem.page !== undefined
      ? evidenceItem.page
      : "",
  );

  appendDefinitionItem(
    metadata,
    "Puntuación de similitud",
    formatDecimal(evidenceItem.score, 4),
  );

  content.appendChild(metadata);

  const excerptTitle = createElement("h3", {
    text: "Extracto recuperado",
  });

  const excerpt = createElement("blockquote", {
    className: "evidence-excerpt",
    text: (
      evidenceItem.excerpt
      || "No se proporcionó un extracto."
    ),
  });

  content.append(
    excerptTitle,
    excerpt,
  );

  const flagsTitle = createElement("h3", {
    text: "Clasificación",
  });

  const flags = createElement("ul", {
    className: "check-list",
  });

  flags.appendChild(
    createElement("li", {
      text: evidenceItem.primary_source
        ? "El registro está marcado como fuente primaria."
        : "El registro no está confirmado como fuente primaria.",
    }),
  );

  flags.appendChild(
    createElement("li", {
      text: evidenceItem.direct_support
        ? "La evidencia fue clasificada como soporte directo."
        : "La evidencia no fue clasificada como soporte directo.",
    }),
  );

  content.append(
    flagsTitle,
    flags,
  );

  const metadataObject = (
    evidenceItem.metadata
    && typeof evidenceItem.metadata === "object"
  )
    ? evidenceItem.metadata
    : {};

  if (Object.keys(metadataObject).length > 0) {
    const rawMetadataDetails = createElement("details");

    const summary = createElement("summary", {
      text: "Metadatos adicionales",
    });

    const metadataPre = createElement("pre", {
      className: "code-block",
      text: JSON.stringify(
        metadataObject,
        null,
        2,
      ),
    });

    rawMetadataDetails.append(
      summary,
      metadataPre,
    );

    content.appendChild(rawMetadataDetails);
  }

  const sourceUrl = sanitizeExternalUrl(
    evidenceItem.source_url,
  );

  if (sourceUrl) {
    const actions = createElement("div", {
      className: "form-actions",
    });

    const sourceLink = createElement("a", {
      className: "button button--primary",
      text: "Consultar documento original",
      attributes: {
        href: sourceUrl,
        target: "_blank",
        rel: "noopener noreferrer",
      },
    });

    actions.appendChild(sourceLink);
    content.appendChild(actions);
  }

  elements.evidenceDialogBody.appendChild(content);

  if (
    typeof elements.evidenceDialog.showModal
    === "function"
  ) {
    elements.evidenceDialog.showModal();
  } else {
    elements.evidenceDialog.setAttribute("open", "");
  }
}


function appendDefinitionItem(
  definitionList,
  label,
  value,
) {
  const normalizedValue = asText(value).trim();

  if (!normalizedValue) {
    return;
  }

  const wrapper = createElement("div");
  const term = createElement("dt", {
    text: label,
  });
  const definition = createElement("dd", {
    text: normalizedValue,
  });

  wrapper.append(
    term,
    definition,
  );

  definitionList.appendChild(wrapper);
}


function closeEvidenceDialog() {
  if (!elements.evidenceDialog) {
    return;
  }

  if (
    typeof elements.evidenceDialog.close
    === "function"
  ) {
    elements.evidenceDialog.close();
  } else {
    elements.evidenceDialog.removeAttribute("open");
  }
}


function handleEvidenceDialogClick(event) {
  if (
    event.target === elements.evidenceDialog
  ) {
    closeEvidenceDialog();
  }
}


/* ==========================================================
   26. PREPARACIÓN DE DATOS DEL GRAFO
   ========================================================== */

function prepareGraphData() {
  state.graphPositions.clear();
  state.selectedGraphNodeId = null;

  state.graphView = {
    x: 0,
    y: 0,
    scale: 1,
  };

  const nodes = Array.isArray(
    state.graphSnapshot?.nodes,
  )
    ? state.graphSnapshot.nodes
    : [];

  const groupedNodes = new Map();

  GRAPH_CONFIG.typeOrder.forEach((type) => {
    groupedNodes.set(type, []);
  });

  nodes.forEach((node) => {
    const nodeType = GRAPH_CONFIG.typeOrder.includes(
      node.node_type,
    )
      ? node.node_type
      : "initiative";

    if (!groupedNodes.has(nodeType)) {
      groupedNodes.set(nodeType, []);
    }

    groupedNodes.get(nodeType).push(node);
  });

  groupedNodes.forEach((typeNodes, nodeType) => {
    const columnX = (
      GRAPH_CONFIG.columns[nodeType]
      ?? GRAPH_CONFIG.width / 2
    );

    const positions = distributeVertically(
      typeNodes.length,
      GRAPH_CONFIG.marginY,
      GRAPH_CONFIG.height - GRAPH_CONFIG.marginY,
    );

    typeNodes.forEach((node, index) => {
      const staggerOffset = (
        index % 2 === 0
          ? -10
          : 10
      );

      state.graphPositions.set(node.id, {
        x: columnX + staggerOffset,
        y: positions[index],
      });
    });
  });
}


function distributeVertically(
  count,
  minimumY,
  maximumY,
) {
  if (count <= 0) {
    return [];
  }

  if (count === 1) {
    return [
      minimumY + ((maximumY - minimumY) / 2),
    ];
  }

  const availableHeight = maximumY - minimumY;
  const step = availableHeight / (count - 1);

  return Array.from(
    {
      length: count,
    },
    (_, index) => minimumY + (step * index),
  );
}


/* ==========================================================
   27. RENDERIZADO DEL GRAFO
   ========================================================== */

function renderGraph() {
  clearElement(elements.graphEdges);
  clearElement(elements.graphNodes);

  const nodes = Array.isArray(
    state.graphSnapshot?.nodes,
  )
    ? state.graphSnapshot.nodes
    : [];

  const edges = Array.isArray(
    state.graphSnapshot?.edges,
  )
    ? state.graphSnapshot.edges
    : [];

  const hasGraph = nodes.length > 0;

  setHidden(elements.graphEmptyState, hasGraph);

  if (!hasGraph) {
    updateGraphProperties(null);
    updateGraphZoomLabel();
    return;
  }

  const nodeIds = new Set(
    nodes.map((node) => node.id),
  );

  edges.forEach((edge) => {
    if (
      !nodeIds.has(edge.source)
      || !nodeIds.has(edge.target)
    ) {
      return;
    }

    const edgeElement = createGraphEdge(edge);

    if (edgeElement) {
      elements.graphEdges.appendChild(edgeElement);
    }
  });

  nodes.forEach((node) => {
    const nodeElement = createGraphNode(node);

    if (nodeElement) {
      elements.graphNodes.appendChild(nodeElement);
    }
  });

  applyGraphViewportTransform();
  updateGraphSelectionStyles();
  updateGraphZoomLabel();

  const selectedNode = findGraphNodeById(
    state.selectedGraphNodeId,
  );

  updateGraphProperties(selectedNode);
}


function createGraphEdge(edge) {
  const sourcePosition = state.graphPositions.get(
    edge.source,
  );

  const targetPosition = state.graphPositions.get(
    edge.target,
  );

  if (!sourcePosition || !targetPosition) {
    return null;
  }

  const group = createSvgElement("g", {
    class: "graph-edge-group",
    "data-source": edge.source,
    "data-target": edge.target,
  });

  const line = createSvgElement("line", {
    class: "graph-edge",
    x1: sourcePosition.x,
    y1: sourcePosition.y,
    x2: targetPosition.x,
    y2: targetPosition.y,
  });

  const labelX = (
    sourcePosition.x + targetPosition.x
  ) / 2;

  const labelY = (
    sourcePosition.y + targetPosition.y
  ) / 2;

  const label = createSvgElement("text", {
    class: "graph-edge-label",
    x: labelX,
    y: labelY - 5,
  });

  label.textContent = truncateGraphLabel(
    edge.relationship,
    24,
  );

  group.append(
    line,
    label,
  );

  return group;
}


function createGraphNode(node) {
  const position = state.graphPositions.get(node.id);

  if (!position) {
    return null;
  }

  const nodeType = (
    NODE_TYPE_LABELS[node.node_type]
      ? node.node_type
      : "initiative"
  );

  const group = createSvgElement("g", {
    class: (
      `graph-node graph-node--${nodeType}`
    ),
    transform: (
      `translate(${position.x}, ${position.y})`
    ),
    tabindex: "0",
    role: "button",
    "data-node-id": node.id,
    "aria-label": (
      `${NODE_TYPE_LABELS[nodeType]}: ${node.label}`
    ),
  });

  const halo = createSvgElement("circle", {
    class: "graph-node__halo",
    r: GRAPH_CONFIG.selectedNodeRadius,
  });

  const circle = createSvgElement("circle", {
    class: "graph-node__circle",
    r: GRAPH_CONFIG.nodeRadius,
  });

  const symbol = createSvgElement("text", {
    class: "graph-node__symbol",
    x: 0,
    y: 1,
  });

  symbol.textContent = (
    NODE_TYPE_SYMBOLS[nodeType]
    || "N"
  );

  const label = createSvgElement("text", {
    class: "graph-node__label",
    x: 0,
    y: 38,
  });

  label.textContent = truncateGraphLabel(
    node.label,
    25,
  );

  const title = createSvgElement("title");
  title.textContent = (
    `${NODE_TYPE_LABELS[nodeType]}: ${node.label}`
  );

  group.append(
    title,
    halo,
    circle,
    symbol,
    label,
  );

  group.addEventListener(
    "pointerdown",
    (event) => {
      handleGraphNodePointerDown(event, node.id);
    },
  );

  group.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter"
        || event.key === " "
      ) {
        event.preventDefault();
        selectGraphNode(node.id);
      }
    },
  );

  return group;
}


/* ==========================================================
   28. SELECCIÓN Y PROPIEDADES DEL GRAFO
   ========================================================== */

function findGraphNodeById(nodeId) {
  if (!nodeId) {
    return null;
  }

  return state.graphSnapshot.nodes.find(
    (node) => node.id === nodeId,
  ) || null;
}


function getConnectedNodeIds(nodeId) {
  const connectedIds = new Set();

  state.graphSnapshot.edges.forEach((edge) => {
    if (edge.source === nodeId) {
      connectedIds.add(edge.target);
    }

    if (edge.target === nodeId) {
      connectedIds.add(edge.source);
    }
  });

  return connectedIds;
}


function selectGraphNode(nodeId) {
  if (!findGraphNodeById(nodeId)) {
    state.selectedGraphNodeId = null;
  } else if (state.selectedGraphNodeId === nodeId) {
    state.selectedGraphNodeId = null;
  } else {
    state.selectedGraphNodeId = nodeId;
  }

  updateGraphSelectionStyles();

  updateGraphProperties(
    findGraphNodeById(
      state.selectedGraphNodeId,
    ),
  );
}


function updateGraphSelectionStyles() {
  const selectedId = state.selectedGraphNodeId;
  const connectedIds = selectedId
    ? getConnectedNodeIds(selectedId)
    : new Set();

  elements.graphNodes
    ?.querySelectorAll(".graph-node")
    .forEach((nodeElement) => {
      const nodeId = nodeElement.dataset.nodeId;

      const selected = nodeId === selectedId;

      const related = (
        !selectedId
        || selected
        || connectedIds.has(nodeId)
      );

      nodeElement.classList.toggle(
        "is-selected",
        selected,
      );

      nodeElement.classList.toggle(
        "is-dimmed",
        !related,
      );
    });

  elements.graphEdges
    ?.querySelectorAll(".graph-edge-group")
    .forEach((edgeGroup) => {
      const connected = (
        selectedId
        && (
          edgeGroup.dataset.source === selectedId
          || edgeGroup.dataset.target === selectedId
        )
      );

      const line = edgeGroup.querySelector(
        ".graph-edge",
      );

      const label = edgeGroup.querySelector(
        ".graph-edge-label",
      );

      line?.classList.toggle(
        "is-highlighted",
        Boolean(connected),
      );

      line?.classList.toggle(
        "is-dimmed",
        Boolean(selectedId && !connected),
      );

      if (label) {
        label.style.opacity = (
          selectedId && !connected
            ? "0.12"
            : "1"
        );
      }
    });
}


function updateGraphProperties(node) {
  if (!elements.graphProperties) {
    return;
  }

  clearElement(elements.graphProperties);

  if (!node) {
    elements.graphProperties.appendChild(
      createElement("p", {
        className: "empty-state",
        text: (
          "Selecciona un nodo del grafo para "
          + "consultar sus propiedades."
        ),
      }),
    );

    return;
  }

  const template = elements.graphPropertyTemplate;

  if (!template) {
    elements.graphProperties.textContent = (
      node.label
      || node.id
    );
    return;
  }

  const fragment = template.content.cloneNode(true);

  const typeElement = fragment.querySelector(
    ".graph-property-type",
  );
  const labelElement = fragment.querySelector(
    ".graph-property-label",
  );
  const propertyList = fragment.querySelector(
    ".graph-property-list",
  );
  const evidenceList = fragment.querySelector(
    ".graph-property-evidence .evidence-id-list",
  );
  const connectionsSection = fragment.querySelector(
    ".graph-property-connections",
  );
  const connectionList = fragment.querySelector(
    ".graph-property-connections ul",
  );

  typeElement.textContent = (
    NODE_TYPE_LABELS[node.node_type]
    || node.node_type
    || "Nodo"
  );

  labelElement.textContent = (
    node.label
    || node.id
  );

  appendDefinitionItem(
    propertyList,
    "Identificador",
    node.id,
  );

  const metadata = (
    node.metadata
    && typeof node.metadata === "object"
  )
    ? node.metadata
    : {};

  Object.entries(metadata).forEach(([key, value]) => {
    if (
      value === null
      || value === undefined
      || value === ""
    ) {
      return;
    }

    let formattedValue;

    if (Array.isArray(value)) {
      formattedValue = value
        .map((item) => {
          if (
            item
            && typeof item === "object"
          ) {
            return JSON.stringify(item);
          }

          return String(item);
        })
        .join(", ");
    } else if (typeof value === "object") {
      formattedValue = JSON.stringify(value);
    } else if (
      key.toLowerCase().includes("date")
    ) {
      formattedValue = formatDate(value);
    } else if (
      key.toLowerCase().includes("score")
    ) {
      formattedValue = formatDecimal(value, 3);
    } else {
      formattedValue = String(value);
    }

    appendDefinitionItem(
      propertyList,
      formatMetadataKey(key),
      formattedValue,
    );
  });

  renderGraphPropertyEvidence(
    evidenceList,
    node.evidence_ids,
  );

  const relatedEdges = state.graphSnapshot.edges.filter(
    (edge) => (
      edge.source === node.id
      || edge.target === node.id
    ),
  );

  if (relatedEdges.length === 0) {
    connectionsSection.hidden = true;
  } else {
    connectionsSection.hidden = false;

    relatedEdges.forEach((edge) => {
      const connectedNodeId = (
        edge.source === node.id
          ? edge.target
          : edge.source
      );

      const connectedNode = findGraphNodeById(
        connectedNodeId,
      );

      const item = createElement("li");
      const button = createElement("button", {
        className: "button button--ghost button--small",
        text: connectedNode
          ? connectedNode.label
          : connectedNodeId,
        attributes: {
          type: "button",
        },
      });

      const relationship = createElement("span", {
        className: "graph-relationship-label",
        text: ` ${edge.relationship}`,
      });

      button.addEventListener("click", () => {
        selectGraphNode(connectedNodeId);
        focusGraphNode(connectedNodeId);
      });

      item.append(
        button,
        relationship,
      );

      connectionList.appendChild(item);
    });
  }

  elements.graphProperties.appendChild(fragment);
}


function formatMetadataKey(key) {
  return asText(key)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => (
      character.toUpperCase()
    ));
}


function renderGraphPropertyEvidence(
  container,
  evidenceIds,
) {
  if (!container) {
    return;
  }

  clearElement(container);

  const ids = Array.isArray(evidenceIds)
    ? evidenceIds
    : [];

  if (ids.length === 0) {
    container.appendChild(
      createElement("span", {
        className: "empty-state",
        text: "Sin referencias asociadas.",
      }),
    );

    return;
  }

  ids.forEach((evidenceId) => {
    const button = createElement("button", {
      className: "evidence-reference",
      text: evidenceId,
      attributes: {
        type: "button",
        title: `Abrir ${evidenceId}`,
      },
    });

    button.addEventListener("click", () => {
      openEvidenceDialog(evidenceId);
    });

    container.appendChild(button);
  });
}


function focusGraphNode(nodeId) {
  const nodeElement = elements.graphNodes?.querySelector(
    `[data-node-id="${CSS.escape(nodeId)}"]`,
  );

  nodeElement?.focus();
}


/* ==========================================================
   29. TRANSFORMACIÓN, ZOOM Y RESTABLECIMIENTO
   ========================================================== */

function applyGraphViewportTransform() {
  if (!elements.graphViewport) {
    return;
  }

  const {
    x,
    y,
    scale,
  } = state.graphView;

  elements.graphViewport.setAttribute(
    "transform",
    `translate(${x}, ${y}) scale(${scale})`,
  );

  updateGraphZoomLabel();
}


function updateGraphZoomLabel() {
  if (!elements.graphZoomLevel) {
    return;
  }

  elements.graphZoomLevel.textContent = (
    `${Math.round(state.graphView.scale * 100)} %`
  );
}


function zoomGraph(
  factor,
  {
    centerX = GRAPH_CONFIG.width / 2,
    centerY = GRAPH_CONFIG.height / 2,
  } = {},
) {
  const oldScale = state.graphView.scale;

  const newScale = clamp(
    oldScale * factor,
    GRAPH_CONFIG.minimumScale,
    GRAPH_CONFIG.maximumScale,
  );

  if (newScale === oldScale) {
    return;
  }

  const graphX = (
    centerX - state.graphView.x
  ) / oldScale;

  const graphY = (
    centerY - state.graphView.y
  ) / oldScale;

  state.graphView.x = (
    centerX - (graphX * newScale)
  );

  state.graphView.y = (
    centerY - (graphY * newScale)
  );

  state.graphView.scale = newScale;

  applyGraphViewportTransform();
}


function resetGraphView() {
  state.graphView = {
    x: 0,
    y: 0,
    scale: 1,
  };

  state.selectedGraphNodeId = null;

  prepareGraphData();
  renderGraph();
}


function resetGraphZoomOnly() {
  state.graphView = {
    x: 0,
    y: 0,
    scale: 1,
  };

  applyGraphViewportTransform();
}


/* ==========================================================
   30. INTERACCIÓN CON EL GRAFO
   ========================================================== */

function handleGraphNodePointerDown(
  event,
  nodeId,
) {
  event.preventDefault();
  event.stopPropagation();

  const svgPoint = clientPointToSvg(event);
  const graphPoint = svgPointToGraph(svgPoint);
  const nodePosition = state.graphPositions.get(nodeId);

  if (!nodePosition) {
    return;
  }

  state.graphDrag = {
    mode: "node",
    pointerId: event.pointerId,
    nodeId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startGraphX: graphPoint.x,
    startGraphY: graphPoint.y,
    initialNodeX: nodePosition.x,
    initialNodeY: nodePosition.y,
    moved: false,
  };

  elements.evidenceGraph?.setPointerCapture(
    event.pointerId,
  );
}


function handleGraphBackgroundPointerDown(event) {
  if (
    event.target.closest(".graph-node")
  ) {
    return;
  }

  event.preventDefault();

  state.graphDrag = {
    mode: "pan",
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    initialViewX: state.graphView.x,
    initialViewY: state.graphView.y,
    moved: false,
  };

  elements.evidenceGraph?.classList.add(
    "is-panning",
  );

  elements.evidenceGraph?.setPointerCapture(
    event.pointerId,
  );
}


function handleGraphPointerMove(event) {
  const drag = state.graphDrag;

  if (
    !drag
    || drag.pointerId !== event.pointerId
  ) {
    return;
  }

  const movementX = event.clientX - drag.startClientX;
  const movementY = event.clientY - drag.startClientY;

  if (
    Math.abs(movementX) + Math.abs(movementY) > 4
  ) {
    drag.moved = true;
  }

  if (drag.mode === "pan") {
    const rect = elements.evidenceGraph.getBoundingClientRect();

    const svgMovementX = (
      movementX * GRAPH_CONFIG.width / rect.width
    );

    const svgMovementY = (
      movementY * GRAPH_CONFIG.height / rect.height
    );

    state.graphView.x = (
      drag.initialViewX + svgMovementX
    );

    state.graphView.y = (
      drag.initialViewY + svgMovementY
    );

    applyGraphViewportTransform();
    return;
  }

  if (drag.mode === "node") {
    const currentSvgPoint = clientPointToSvg(event);
    const currentGraphPoint = svgPointToGraph(
      currentSvgPoint,
    );

    const graphMovementX = (
      currentGraphPoint.x - drag.startGraphX
    );

    const graphMovementY = (
      currentGraphPoint.y - drag.startGraphY
    );

    state.graphPositions.set(drag.nodeId, {
      x: drag.initialNodeX + graphMovementX,
      y: drag.initialNodeY + graphMovementY,
    });

    renderGraph();
  }
}


function handleGraphPointerUp(event) {
  const drag = state.graphDrag;

  if (
    !drag
    || drag.pointerId !== event.pointerId
  ) {
    return;
  }

  if (
    drag.mode === "node"
    && !drag.moved
  ) {
    selectGraphNode(drag.nodeId);
  }

  if (
    drag.mode === "pan"
    && !drag.moved
  ) {
    state.selectedGraphNodeId = null;
    updateGraphSelectionStyles();
    updateGraphProperties(null);
  }

  elements.evidenceGraph?.classList.remove(
    "is-panning",
  );

  if (
    elements.evidenceGraph?.hasPointerCapture(
      event.pointerId,
    )
  ) {
    elements.evidenceGraph.releasePointerCapture(
      event.pointerId,
    );
  }

  state.graphDrag = null;
}


function handleGraphPointerCancel(event) {
  elements.evidenceGraph?.classList.remove(
    "is-panning",
  );

  if (
    elements.evidenceGraph?.hasPointerCapture(
      event.pointerId,
    )
  ) {
    elements.evidenceGraph.releasePointerCapture(
      event.pointerId,
    );
  }

  state.graphDrag = null;
}


function handleGraphWheel(event) {
  event.preventDefault();

  const point = clientPointToSvg(event);
  const factor = event.deltaY < 0
    ? 1.1
    : 1 / 1.1;

  zoomGraph(
    factor,
    {
      centerX: point.x,
      centerY: point.y,
    },
  );
}


/* ==========================================================
   31. NAVEGACIÓN DESDE EL EXPEDIENTE
   ========================================================== */

function handleReturnToPlan() {
  setCurrentSection("plan");
}


function handleContinueToReflection() {
  if (!state.challenge) {
    showError(
      "El servidor no devolvió un reto socrático. "
      + "Inicia nuevamente la investigación.",
    );
    return;
  }

  /*
   * Esta función se define en la parte 3.
   */
  renderReflectionWorkspace();
  setCurrentSection("reflection");
}


/* ==========================================================
   32. REGISTRO DE EVENTOS DEL EXPEDIENTE
   ========================================================== */

function registerEvidenceEventListeners() {
  elements.tabList?.addEventListener(
    "click",
    handleTabClick,
  );

  elements.tabList?.addEventListener(
    "keydown",
    handleTabKeydown,
  );

  elements.evidenceKindFilter?.addEventListener(
    "change",
    handleEvidenceFilterChange,
  );

  elements.closeEvidenceDialog?.addEventListener(
    "click",
    closeEvidenceDialog,
  );

  elements.evidenceDialog?.addEventListener(
    "click",
    handleEvidenceDialogClick,
  );

  elements.evidenceDialog?.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      closeEvidenceDialog();
    },
  );

  elements.graphZoomOut?.addEventListener(
    "click",
    () => {
      zoomGraph(1 / GRAPH_CONFIG.zoomStep);
    },
  );

  elements.graphZoomIn?.addEventListener(
    "click",
    () => {
      zoomGraph(GRAPH_CONFIG.zoomStep);
    },
  );

  elements.graphZoomLevel?.addEventListener(
    "click",
    resetGraphZoomOnly,
  );

  elements.graphReset?.addEventListener(
    "click",
    resetGraphView,
  );

  elements.evidenceGraph?.addEventListener(
    "pointerdown",
    handleGraphBackgroundPointerDown,
  );

  elements.evidenceGraph?.addEventListener(
    "pointermove",
    handleGraphPointerMove,
  );

  elements.evidenceGraph?.addEventListener(
    "pointerup",
    handleGraphPointerUp,
  );

  elements.evidenceGraph?.addEventListener(
    "pointercancel",
    handleGraphPointerCancel,
  );

  elements.evidenceGraph?.addEventListener(
    "wheel",
    handleGraphWheel,
    {
      passive: false,
    },
  );

  elements.returnToPlan?.addEventListener(
    "click",
    handleReturnToPlan,
  );

  elements.continueToReflection?.addEventListener(
    "click",
    handleContinueToReflection,
  );
}


/* ==========================================================
   FIN DE LA PARTE 2 DE 3

   La parte 3 añadirá:
   - Renderizado del reto socrático.
   - Validación de la reflexión.
   - Envío de la reflexión al backend.
   - Evaluación cognitiva.
   - Renderizado seguro de la síntesis.
   - Copiado de resultados.
   - Reinicio de la investigación.
   ========================================================== */
   /* ==========================================================
   ÁgoraMX
   Archivo: /static/js/app.js
   Parte 3 de 3

   Esta parte contiene:
   - Renderizado del reto socrático.
   - Validación de la reflexión.
   - Envío de la reflexión al backend.
   - Evaluación del razonamiento.
   - Renderizado seguro de la síntesis final.
   - Referencias interactivas [E#].
   - Copiado de la síntesis.
   - Reinicio de la investigación.
   ========================================================== */

/* ==========================================================
   33. RENDERIZADO DEL RETO SOCRÁTICO
   ========================================================== */

function renderReflectionWorkspace() {
  renderChallenge();
  renderCounterAnalysis();

  if (!elements.reflectionInput) {
    console.error(
      "No se encontró #reflection-input.",
    );
    return;
  }

  /*
   * La primera vez se carga la plantilla.
   * Después se conserva lo escrito por el usuario.
   */
  if (!state.reflection.trim()) {
    state.reflection = REFLECTION_TEMPLATE;
  }

  elements.reflectionInput.value = state.reflection;

  validateReflection({
    showValidation: false,
  });
}

function renderChallenge() {
  const challenge = state.challenge || {
    instructions: "",
    questions: [],
    required_evidence_ids: [],
    warning: "",
  };

  if (elements.challengeInstructions) {
    elements.challengeInstructions.textContent = (
      challenge.instructions
      || (
        "Formula una hipótesis provisional basada "
        + "en el expediente de evidencia."
      )
    );
  }

  renderTextList(
    elements.challengeQuestions,
    challenge.questions,
    {
      ordered: true,
      emptyMessage: (
        "Examina la evidencia y explica qué puede "
        + "concluirse de manera provisional."
      ),
    },
  );

  renderRequiredEvidenceIds(
    challenge.required_evidence_ids,
  );

  if (elements.challengeWarning) {
    const warning = asText(
      challenge.warning,
    ).trim();

    elements.challengeWarning.textContent = warning;

    setHidden(
      elements.challengeWarning,
      !warning,
    );
  }
}


function renderRequiredEvidenceIds(evidenceIds) {
  if (!elements.requiredEvidenceIds) {
    return;
  }

  clearElement(elements.requiredEvidenceIds);

  const ids = Array.isArray(evidenceIds)
    ? evidenceIds
        .map(normalizeEvidenceId)
        .filter(Boolean)
    : [];

  if (ids.length === 0) {
    elements.requiredEvidenceIds.appendChild(
      createElement("span", {
        className: "empty-state",
        text: (
          "Consulta las evidencias disponibles "
          + "en el expediente."
        ),
      }),
    );

    return;
  }

  [...new Set(ids)].forEach((evidenceId) => {
    const button = createElement("button", {
      className: "evidence-reference",
      text: `[${evidenceId}]`,
      attributes: {
        type: "button",
        title: `Consultar ${evidenceId}`,
        "aria-label": (
          `Consultar evidencia ${evidenceId}`
        ),
      },
    });

    button.addEventListener("click", () => {
      openEvidenceDialog(evidenceId);
    });

    elements.requiredEvidenceIds.appendChild(button);
  });
}


function normalizeEvidenceId(value) {
  const normalizedValue = asText(value)
    .trim()
    .replaceAll("[", "")
    .replaceAll("]", "")
    .replace(/\s+/g, "")
    .toUpperCase();

  return EVIDENCE_ID_PATTERN.test(normalizedValue)
    ? normalizedValue
    : "";
}


/* ==========================================================
   34. RENDERIZADO DEL ABOGADO DEL DIABLO
   ========================================================== */

function renderCounterAnalysis() {
  const counterAnalysis = state.counterAnalysis || {
    alternative_interpretations: [],
    possible_counterevidence: [],
    invalid_conclusions: [],
    questions_to_resolve: [],
  };

  renderTextList(
    elements.alternativeInterpretations,
    counterAnalysis.alternative_interpretations,
    {
      emptyMessage: (
        "No se propusieron interpretaciones alternativas."
      ),
    },
  );

  renderTextList(
    elements.possibleCounterevidence,
    counterAnalysis.possible_counterevidence,
    {
      emptyMessage: (
        "No se especificó contraevidencia adicional."
      ),
    },
  );

  renderTextList(
    elements.invalidConclusions,
    counterAnalysis.invalid_conclusions,
    {
      emptyMessage: (
        "No se identificaron conclusiones prematuras."
      ),
    },
  );

  renderTextList(
    elements.questionsToResolve,
    counterAnalysis.questions_to_resolve,
    {
      emptyMessage: (
        "No se agregaron preguntas pendientes."
      ),
    },
  );
}


function handleCounterAnalysisToggle() {
  if (
    !elements.counterAnalysisContent
    || !elements.toggleCounterAnalysis
  ) {
    return;
  }

  const currentlyExpanded = (
    elements.toggleCounterAnalysis.getAttribute(
      "aria-expanded",
    ) === "true"
  );

  const nextExpanded = !currentlyExpanded;

  elements.toggleCounterAnalysis.setAttribute(
    "aria-expanded",
    String(nextExpanded),
  );

  elements.toggleCounterAnalysis.textContent = (
    nextExpanded
      ? "Ocultar"
      : "Mostrar"
  );

  setHidden(
    elements.counterAnalysisContent,
    !nextExpanded,
  );
}


/* ==========================================================
   35. VALIDACIÓN DE LA REFLEXIÓN
   ========================================================== */

function getReflectionValue() {
  return elements.reflectionInput
    ? elements.reflectionInput.value.trim()
    : "";
}


/**
 * Extrae referencias con el formato [E1], [E2], etc.
 */
function extractEvidenceCitations(text) {
  const normalizedText = asText(text);

  const citationPattern = new RegExp(
    EVIDENCE_CITATION_PATTERN_SOURCE,
    "gi",
  );

  const citations = new Set();

  let match;

  while (
    (match = citationPattern.exec(normalizedText)) !== null
  ) {
    const evidenceId = normalizeEvidenceId(
      match[1],
    );

    if (evidenceId) {
      citations.add(evidenceId);
    }

    /*
     * Protección adicional contra bucles infinitos en caso de
     * una coincidencia vacía.
     */
    if (match.index === citationPattern.lastIndex) {
      citationPattern.lastIndex += 1;
    }
  }

  return [...citations];
}

function getAvailableEvidenceIds() {
  const evidence = Array.isArray(state.evidence)
    ? state.evidence
    : [];

  return new Set(
    evidence
      .map((item) => (
        normalizeEvidenceId(
          item?.evidence_id,
        )
      ))
      .filter(Boolean),
  );
}

/**
 * Devuelve únicamente identificadores de evidencia existentes.
 */
function getValidEvidenceCitations(text) {
  const citations = extractEvidenceCitations(text);
  const availableEvidenceIds = getAvailableEvidenceIds();

  return citations.filter((citation) => (
    availableEvidenceIds.has(citation)
  ));
}

/**
 * Devuelve identificadores citados que no existen.
 */
function getInvalidEvidenceCitations(text) {
  const citations = extractEvidenceCitations(text);
  const availableEvidenceIds = getAvailableEvidenceIds();

  return citations.filter((citation) => (
    !availableEvidenceIds.has(citation)
  ));
}


function evaluateReflectionRequirements(text) {
  const normalizedText = asText(text).trim();

  const lowerText = normalizedText.toLocaleLowerCase(
    "es-MX",
  );

  const extractedCitations = extractEvidenceCitations(
    normalizedText,
  );

  const validCitations = getValidEvidenceCitations(
    normalizedText,
  );

  const invalidCitations = getInvalidEvidenceCitations(
    normalizedText,
  );

  /*
   * Deben escribirse al menos dos identificadores distintos.
   */
  const hasCitationFormat = (
    extractedCitations.length >= 2
  );

  /*
   * Al menos dos identificadores deben existir en el
   * expediente recuperado.
   */
  const hasValidCitations = (
    validCitations.length >= 2
  );

  /*
   * El requisito se cumple únicamente cuando:
   * 1. Hay dos referencias diferentes.
   * 2. Ambas existen.
   * 3. No se incluyeron referencias inexistentes.
   */
  const hasCitations = (
    hasCitationFormat
    && hasValidCitations
    && invalidCitations.length === 0
  );

  const hasHypothesis = (
    normalizedText.length >= 80
    && (
      lowerText.includes("hipótesis")
      || lowerText.includes("considero")
      || lowerText.includes("podría")
      || lowerText.includes("sugiere")
      || lowerText.includes("provisional")
      || lowerText.includes("es posible")
    )
  );

  const hasFactInferenceDistinction = (
    (
      lowerText.includes("hecho")
      || lowerText.includes("documentado")
      || lowerText.includes("documenta")
      || lowerText.includes("evidencia muestra")
    )
    && (
      lowerText.includes("inferencia")
      || lowerText.includes("puede inferirse")
      || lowerText.includes("interpretación")
      || lowerText.includes("sugiere")
    )
  );

  const hasAlternative = (
    lowerText.includes("alternativa")
    || lowerText.includes("otra explicación")
    || lowerText.includes("sin embargo")
    || lowerText.includes("aunque")
    || lowerText.includes("por otro lado")
    || lowerText.includes("también podría")
  );

  const hasMissingEvidence = (
    lowerText.includes("evidencia faltante")
    || lowerText.includes("información faltante")
    || lowerText.includes("hace falta")
    || lowerText.includes("sería necesario")
    || lowerText.includes("no puede concluirse")
    || lowerText.includes("no se puede concluir")
    || lowerText.includes("se necesitaría")
  );

  /*
   * Solo los marcadores explícitos bloquean el envío.
   */
  const templateIncomplete = (
    normalizedText.includes("[E___]")
    || normalizedText.includes("[COMPLETAR]")
  );

  const minimumLengthMet = (
    normalizedText.length >= 80
  );

  const withinMaximumLength = (
    normalizedText.length
    <= CONFIG.limits.reflectionMaxLength
  );

  return {
    hasHypothesis,
    hasCitations,
    hasCitationFormat,
    hasValidCitations,

    hasFactInferenceDistinction,
    hasAlternative,
    hasMissingEvidence,

    extractedCitations,
    validCitations,
    invalidCitations,

    templateIncomplete,
    minimumLengthMet,
    withinMaximumLength,

    complete: (
      !templateIncomplete
      && minimumLengthMet
      && withinMaximumLength
      && hasHypothesis
      && hasCitations
      && hasFactInferenceDistinction
      && hasAlternative
      && hasMissingEvidence
    ),
  };
}

function validateReflection({
  showValidation = true,
} = {}) {
  const reflection = getReflectionValue();
  const length = reflection.length;

  const requirements = evaluateReflectionRequirements(
    reflection,
  );

  if (elements.reflectionCounter) {
    elements.reflectionCounter.textContent = (
      `${length} / ${CONFIG.limits.reflectionMaxLength}`
    );
  }

  updateReflectionChecklist(requirements);

  if (elements.reflectionInput) {
    elements.reflectionInput.setAttribute(
      "aria-invalid",
      String(
        showValidation
        && !requirements.complete
      ),
    );
  }

  if (elements.reflectionValidation) {
    const validation = getReflectionValidationMessage(
      reflection,
      requirements,
    );

    elements.reflectionValidation.textContent = (
      validation.message
    );

    elements.reflectionValidation.classList.toggle(
      "is-valid",
      validation.valid,
    );

    elements.reflectionValidation.classList.toggle(
      "is-invalid",
      showValidation && !validation.valid,
    );
  }

  if (elements.submitReflection) {
    elements.submitReflection.disabled = (
      !requirements.complete
      || state.submittingReflection
    );
  }

  return requirements.complete;
}


function getReflectionValidationMessage(
  reflection,
  requirements,
) {
  if (!reflection.trim()) {
    return {
      valid: false,
      message: "Escribe tu reflexión.",
    };
  }

  if (!requirements.withinMaximumLength) {
    return {
      valid: false,
      message: (
        `La reflexión supera el límite de `
        + `${CONFIG.limits.reflectionMaxLength} caracteres.`
      ),
    };
  }

  if (!requirements.minimumLengthMet) {
    return {
      valid: false,
      message: (
        "Desarrolla tu razonamiento con al menos "
        + "80 caracteres."
      ),
    };
  }

  if (!requirements.hasCitationFormat) {
    return {
      valid: false,
      message: (
        "Incluye al menos dos referencias diferentes "
        + "con el formato [E1] y [E2]."
      ),
    };
  }

  if (requirements.invalidCitations.length > 0) {
    const invalidReferences = requirements
      .invalidCitations
      .map((citation) => `[${citation}]`)
      .join(", ");

    return {
      valid: false,
      message: (
        "Estas referencias no existen en el expediente: "
        + `${invalidReferences}.`
      ),
    };
  }

  if (!requirements.hasValidCitations) {
    return {
      valid: false,
      message: (
        "Las referencias fueron reconocidas, pero no "
        + "coinciden con al menos dos evidencias disponibles."
      ),
    };
  }

  if (requirements.templateIncomplete) {
    return {
      valid: false,
      message: (
        "Las referencias fueron reconocidas. Ahora completa "
        + "los textos pendientes de la plantilla."
      ),
    };
  }

  if (!requirements.hasHypothesis) {
    return {
      valid: false,
      message: (
        "Formula explícitamente una hipótesis provisional."
      ),
    };
  }

  if (!requirements.hasFactInferenceDistinction) {
    return {
      valid: false,
      message: (
        "Distingue los hechos documentados "
        + "de tus inferencias."
      ),
    };
  }

  if (!requirements.hasAlternative) {
    return {
      valid: false,
      message: (
        "Incluye una explicación o interpretación alternativa."
      ),
    };
  }

  if (!requirements.hasMissingEvidence) {
    return {
      valid: false,
      message: (
        "Indica qué evidencia o información falta."
      ),
    };
  }

  return {
    valid: true,
    message: (
      "La reflexión cumple los requisitos mínimos "
      + "y está lista para ser evaluada."
    ),
  };
}

function updateReflectionChecklist(requirements) {
  setChecklistItemState(
    elements.reflectionChecks.hypothesis,
    requirements.hasHypothesis,
  );

  setChecklistItemState(
    elements.reflectionChecks.citations,
    requirements.hasCitations,
  );

  setChecklistItemState(
    elements.reflectionChecks.facts,
    requirements.hasFactInferenceDistinction,
  );

  setChecklistItemState(
    elements.reflectionChecks.alternative,
    requirements.hasAlternative,
  );

  setChecklistItemState(
    elements.reflectionChecks.missing,
    requirements.hasMissingEvidence,
  );
}


function setChecklistItemState(element, complete) {
  if (!element) {
    return;
  }

  element.classList.toggle(
    "is-complete",
    complete,
  );
}


function handleReflectionInput() {
  hideError();
  hideMessage();

  state.reflection = (
    elements.reflectionInput?.value
    || ""
  );

  validateReflection({
    showValidation: true,
  });
}


/* ==========================================================
   36. ENVÍO DE LA REFLEXIÓN
   ========================================================== */

async function handleReflectionSubmit(event) {
  event.preventDefault();

  hideError();
  hideMessage();

  if (state.submittingReflection) {
    return;
  }

  const validReflection = validateReflection({
    showValidation: true,
  });

  if (!validReflection) {
    elements.reflectionInput?.focus();
    return;
  }

  if (!state.sessionId) {
    showError(
      "La sesión de investigación no está disponible. "
      + "Inicia una nueva investigación.",
    );
    return;
  }

  const reflection = getReflectionValue();

  state.reflection = reflection;
  state.submittingReflection = true;

  setButtonLoading(
    elements.submitReflection,
    true,
    {
      loadingText: "Evaluando…",
    },
  );

  try {
    const response = await apiRequest(
      CONFIG.api.investigate,
      {
        method: "POST",
        body: {
          question: state.question,
          session_id: state.sessionId,
          reflection,
        },
      },
    );

    applyInvestigationResponse(response);

    if (
      response?.stage !== "completed"
      && !response?.evaluation
    ) {
      throw new Error(
        "El servidor no devolvió la evaluación esperada.",
      );
    }

    renderSynthesisWorkspace();
    setCurrentSection("synthesis");
  } catch (error) {
    showError(getErrorMessage(error));
  } finally {
    state.submittingReflection = false;

    setButtonLoading(
      elements.submitReflection,
      false,
      {
        normalText: "Evaluar mi razonamiento",
      },
    );

    validateReflection({
      showValidation: false,
    });
  }
}


/* ==========================================================
   37. RENDERIZADO GENERAL DE RESULTADOS
   ========================================================== */

function renderSynthesisWorkspace() {
  renderReasoningEvaluation();
  renderFinalAnswer();
}


/* ==========================================================
   38. EVALUACIÓN DEL RAZONAMIENTO
   ========================================================== */

function renderReasoningEvaluation() {
  const evaluation = state.evaluation || {
    total_score: 0,
    claim_evidence_score: 0,
    source_verification_score: 0,
    counterargument_score: 0,
    uncertainty_score: 0,
    synthesis_score: 0,
    strengths: [],
    weaknesses: [],
    unsupported_claims: [],
    feedback: "",
    improved_reasoning_steps: [],
  };

  const totalScore = clamp(
    Number(evaluation.total_score) || 0,
    0,
    100,
  );

  if (elements.totalScore) {
    elements.totalScore.textContent = String(
      Math.round(totalScore),
    );
  }

  if (elements.evaluationFeedback) {
    elements.evaluationFeedback.textContent = (
      evaluation.feedback
      || (
        "La evaluación no incluyó "
        + "retroalimentación adicional."
      )
    );
  }

  renderRubricScore({
    scoreElement: elements.claimEvidenceScore,
    meterElement: elements.claimEvidenceMeter,
    score: evaluation.claim_evidence_score,
    maximum: 25,
  });

  renderRubricScore({
    scoreElement: elements.sourceVerificationScore,
    meterElement: elements.sourceVerificationMeter,
    score: evaluation.source_verification_score,
    maximum: 25,
  });

  renderRubricScore({
    scoreElement: elements.counterargumentScore,
    meterElement: elements.counterargumentMeter,
    score: evaluation.counterargument_score,
    maximum: 20,
  });

  renderRubricScore({
    scoreElement: elements.uncertaintyScore,
    meterElement: elements.uncertaintyMeter,
    score: evaluation.uncertainty_score,
    maximum: 15,
  });

  renderRubricScore({
    scoreElement: elements.synthesisScore,
    meterElement: elements.synthesisMeter,
    score: evaluation.synthesis_score,
    maximum: 15,
  });

  renderTextList(
    elements.evaluationStrengths,
    evaluation.strengths,
    {
      emptyMessage: (
        "La evaluación no señaló fortalezas específicas."
      ),
    },
  );

  renderTextList(
    elements.evaluationWeaknesses,
    evaluation.weaknesses,
    {
      emptyMessage: (
        "La evaluación no señaló debilidades específicas."
      ),
    },
  );

  renderUnsupportedClaims(
    evaluation.unsupported_claims,
  );

  renderTextList(
    elements.improvedReasoningSteps,
    evaluation.improved_reasoning_steps,
    {
      ordered: true,
      emptyMessage: (
        "No se propusieron pasos adicionales."
      ),
    },
  );
}


function renderRubricScore({
  scoreElement,
  meterElement,
  score,
  maximum,
}) {
  const normalizedScore = clamp(
    Number(score) || 0,
    0,
    maximum,
  );

  if (scoreElement) {
    scoreElement.textContent = (
      `${Math.round(normalizedScore)} / ${maximum}`
    );
  }

  if (meterElement) {
    meterElement.setAttribute(
      "aria-valuemin",
      "0",
    );

    meterElement.setAttribute(
      "aria-valuemax",
      String(maximum),
    );

    meterElement.setAttribute(
      "aria-valuenow",
      String(Math.round(normalizedScore)),
    );

    const bar = meterElement.querySelector(
      ".progress-meter__bar",
    );

    if (bar) {
      const percentage = scoreToPercent(
        normalizedScore,
        maximum,
      );

      requestAnimationFrame(() => {
        bar.style.width = `${percentage}%`;
      });
    }
  }
}


function renderUnsupportedClaims(claims) {
  const normalizedClaims = Array.isArray(claims)
    ? claims.filter((claim) => asText(claim).trim())
    : [];

  const hasClaims = normalizedClaims.length > 0;

  setHidden(
    elements.unsupportedClaims,
    !hasClaims,
  );

  setHidden(
    elements.unsupportedClaimsEmpty,
    hasClaims,
  );

  if (hasClaims) {
    renderTextList(
      elements.unsupportedClaims,
      normalizedClaims,
    );
  } else {
    clearElement(elements.unsupportedClaims);
  }
}


/* ==========================================================
   39. RENDERIZADO SEGURO DE LA SÍNTESIS
   ========================================================== */

/**
 * Renderiza un subconjunto controlado de Markdown sin insertar
 * HTML procedente del modelo.
 *
 * Elementos admitidos:
 * - Encabezados ## y ###.
 * - Listas con -, * o +.
 * - Listas numeradas.
 * - Citas con >.
 * - Párrafos.
 * - Referencias [E#] interactivas.
 */
function renderFinalAnswer() {
  if (!elements.finalAnswer) {
    return;
  }

  clearElement(elements.finalAnswer);

  const answer = asText(state.finalAnswer).trim();

  if (!answer) {
    elements.finalAnswer.appendChild(
      createElement("p", {
        className: "empty-state",
        text: (
          "El servidor no devolvió una síntesis final."
        ),
      }),
    );

    return;
  }

  const lines = answer
    .replace(/\r\n/g, "\n")
    .split("\n");

  let currentList = null;
  let currentListType = null;
  let paragraphLines = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    const paragraph = createElement("p");

    appendInlineContent(
      paragraph,
      paragraphLines.join(" "),
    );

    elements.finalAnswer.appendChild(paragraph);
    paragraphLines = [];
  };

  const flushList = () => {
    currentList = null;
    currentListType = null;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    const headingMatch = line.match(
      /^(#{2,3})\s+(.+)$/,
    );

    if (headingMatch) {
      flushParagraph();
      flushList();

      const headingLevel = headingMatch[1].length;
      const heading = createElement(
        headingLevel === 2 ? "h2" : "h3",
      );

      appendInlineContent(
        heading,
        headingMatch[2],
      );

      elements.finalAnswer.appendChild(heading);
      return;
    }

    const unorderedListMatch = line.match(
      /^[-*+]\s+(.+)$/,
    );

    if (unorderedListMatch) {
      flushParagraph();

      if (
        !currentList
        || currentListType !== "ul"
      ) {
        currentList = createElement("ul");
        currentListType = "ul";
        elements.finalAnswer.appendChild(currentList);
      }

      const item = createElement("li");

      appendInlineContent(
        item,
        unorderedListMatch[1],
      );

      currentList.appendChild(item);
      return;
    }

    const orderedListMatch = line.match(
      /^\d+[.)]\s+(.+)$/,
    );

    if (orderedListMatch) {
      flushParagraph();

      if (
        !currentList
        || currentListType !== "ol"
      ) {
        currentList = createElement("ol");
        currentListType = "ol";
        elements.finalAnswer.appendChild(currentList);
      }

      const item = createElement("li");

      appendInlineContent(
        item,
        orderedListMatch[1],
      );

      currentList.appendChild(item);
      return;
    }

    const blockquoteMatch = line.match(
      /^>\s?(.+)$/,
    );

    if (blockquoteMatch) {
      flushParagraph();
      flushList();

      const blockquote = createElement("blockquote");

      appendInlineContent(
        blockquote,
        blockquoteMatch[1],
      );

      elements.finalAnswer.appendChild(blockquote);
      return;
    }

    flushList();
    paragraphLines.push(line);
  });

  flushParagraph();
}


/**
 * Inserta texto y convierte [E#] en botones interactivos.
 * También reconoce Markdown simple en negritas y código.
 */
function appendInlineContent(container, text) {
  const source = asText(text);

  /*
   * Reconoce:
   * - Referencias [E1].
   * - Texto **en negritas**.
   * - Texto `de código`.
   */
  const tokenPattern = new RegExp(
    "("
    + "\\x5B\\s*E[0-9]+\\s*\\x5D"
    + "|\\*\\*[^*]+\\*\\*"
    + "|`[^`]+`"
    + ")",
    "gi",
  );

  let lastIndex = 0;
  let match;

  while (
    (match = tokenPattern.exec(source)) !== null
  ) {
    if (match.index > lastIndex) {
      appendTextWithUrls(
        container,
        source.slice(
          lastIndex,
          match.index,
        ),
      );
    }

    const token = match[0];
    const evidenceIds = extractEvidenceCitations(token);

    if (evidenceIds.length === 1) {
      appendEvidenceCitationToken(
        container,
        evidenceIds[0],
      );
    } else if (
      token.startsWith("**")
      && token.endsWith("**")
    ) {
      const strong = createElement("strong", {
        text: token.slice(2, -2),
      });

      container.appendChild(strong);
    } else if (
      token.startsWith("`")
      && token.endsWith("`")
    ) {
      const code = createElement("code", {
        text: token.slice(1, -1),
      });

      container.appendChild(code);
    } else {
      container.appendChild(
        document.createTextNode(token),
      );
    }

    lastIndex = tokenPattern.lastIndex;
  }

  if (lastIndex < source.length) {
    appendTextWithUrls(
      container,
      source.slice(lastIndex),
    );
  }
}


/**
 * Convierte URLs HTTP/HTTPS en enlaces seguros.
 */
function appendTextWithUrls(container, text) {
  const source = asText(text);
  const urlPattern = /https?:\/\/[^\s<>()]+/gi;

  let lastIndex = 0;
  let match;

  while (
    (match = urlPattern.exec(source)) !== null
  ) {
    if (match.index > lastIndex) {
      container.appendChild(
        document.createTextNode(
          source.slice(lastIndex, match.index),
        ),
      );
    }

    let url = match[0];
    let trailingPunctuation = "";

    while (
      /[.,;:!?]$/.test(url)
    ) {
      trailingPunctuation = (
        url.slice(-1) + trailingPunctuation
      );

      url = url.slice(0, -1);
    }

    const safeUrl = sanitizeExternalUrl(url);

    if (safeUrl) {
      const link = createElement("a", {
        text: url,
        attributes: {
          href: safeUrl,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      });

      container.appendChild(link);
    } else {
      container.appendChild(
        document.createTextNode(url),
      );
    }

    if (trailingPunctuation) {
      container.appendChild(
        document.createTextNode(
          trailingPunctuation,
        ),
      );
    }

    lastIndex = urlPattern.lastIndex;
  }

  if (lastIndex < source.length) {
    container.appendChild(
      document.createTextNode(
        source.slice(lastIndex),
      ),
    );
  }
}


function appendEvidenceCitationToken(
  container,
  token,
) {
  const evidenceId = normalizeEvidenceId(token);

  if (!evidenceId) {
    container.appendChild(
      document.createTextNode(
        asText(token),
      ),
    );

    return;
  }

  const evidenceItem = findEvidenceById(
    evidenceId,
  );

  if (!evidenceItem) {
    const invalidReference = createElement("span", {
      className: "status-badge is-insufficient",
      text: `[${evidenceId}]`,
      attributes: {
        title: (
          "La referencia no existe en el expediente."
        ),
      },
    });

    container.appendChild(invalidReference);
    return;
  }

  const button = createElement("button", {
    className: "evidence-reference",
    text: `[${evidenceId}]`,
    attributes: {
      type: "button",
      title: `Consultar ${evidenceId}`,
      "aria-label": (
        `Consultar evidencia ${evidenceId}`
      ),
    },
  });

  button.addEventListener("click", () => {
    openEvidenceDialog(evidenceId);
  });

  container.appendChild(button);
}


/* ==========================================================
   40. COPIADO DE LA SÍNTESIS
   ========================================================== */

async function handleCopyFinalAnswer() {
  const answer = asText(state.finalAnswer).trim();

  if (!answer) {
    showError(
      "No hay una síntesis disponible para copiar.",
    );
    return;
  }

  try {
    await copyTextToClipboard(answer);

    const originalText = (
      elements.copyFinalAnswer?.textContent
      || "Copiar síntesis"
    );

    if (elements.copyFinalAnswer) {
      elements.copyFinalAnswer.textContent = "Copiada";
      elements.copyFinalAnswer.disabled = true;

      window.setTimeout(() => {
        elements.copyFinalAnswer.textContent = originalText;
        elements.copyFinalAnswer.disabled = false;
      }, 1800);
    }

    showMessage(
      "La síntesis fue copiada al portapapeles.",
    );

    window.setTimeout(() => {
      hideMessage();
    }, 2500);
  } catch (error) {
    showError(
      "No fue posible copiar la síntesis al portapapeles.",
    );
  }
}


async function copyTextToClipboard(text) {
  if (
    navigator.clipboard
    && window.isSecureContext
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temporaryTextArea = createElement("textarea");

  temporaryTextArea.value = text;
  temporaryTextArea.setAttribute(
    "readonly",
    "",
  );

  temporaryTextArea.style.position = "fixed";
  temporaryTextArea.style.top = "-9999px";
  temporaryTextArea.style.left = "-9999px";

  document.body.appendChild(temporaryTextArea);

  temporaryTextArea.select();
  temporaryTextArea.setSelectionRange(
    0,
    temporaryTextArea.value.length,
  );

  const copied = document.execCommand("copy");

  temporaryTextArea.remove();

  if (!copied) {
    throw new Error(
      "El navegador rechazó la operación de copiado.",
    );
  }
}


/* ==========================================================
   41. NAVEGACIÓN DESDE LA SÍNTESIS
   ========================================================== */

function handleReviewReflection() {
  renderReflectionWorkspace();
  setCurrentSection("reflection");
}


function handleReturnToEvidence() {
  renderEvidenceWorkspace();
  activateTab("sources");
  setCurrentSection("evidence");
}


/* ==========================================================
   42. REINICIO DE LA INVESTIGACIÓN
   ========================================================== */

function resetInvestigationState() {
  state.currentSection = "question";

  state.sessionId = null;
  state.question = "";
  state.reflection = "";

  state.investigation = null;

  state.plan = null;
  state.evidence = [];
  state.audit = null;
  state.counterAnalysis = null;
  state.challenge = null;
  state.evaluation = null;
  state.finalAnswer = null;

  state.graphSnapshot = {
    nodes: [],
    edges: [],
  };

  state.graphCapabilities = [];
  state.graphLimitations = [];

  state.loading = false;
  state.submittingReflection = false;

  state.selectedGraphNodeId = null;

  state.graphView = {
    x: 0,
    y: 0,
    scale: 1,
  };

  state.graphPositions.clear();
  state.graphDrag = null;

  state.evidenceFilter = "all";
}


function clearInterfaceForNewInvestigation() {
  if (elements.questionInput) {
    elements.questionInput.value = "";
    elements.questionInput.removeAttribute(
      "aria-invalid",
    );
  }

  if (elements.reflectionInput) {
    elements.reflectionInput.value = "";
    elements.reflectionInput.removeAttribute(
      "aria-invalid",
    );
  }

  if (elements.evidenceKindFilter) {
    elements.evidenceKindFilter.value = "all";
  }

  if (elements.plannedQuestion) {
    elements.plannedQuestion.textContent = "";
  }

  if (elements.normalizedQuestion) {
    elements.normalizedQuestion.textContent = "";
  }

  if (elements.retrievalQuery) {
    elements.retrievalQuery.textContent = "";
  }

  clearElement(elements.planSubquestions);
  clearElement(elements.requiredCapabilities);
  clearElement(elements.unavailableCapabilities);
  clearElement(elements.safetyNotes);

  clearElement(elements.evidenceList);
  clearElement(elements.graphEdges);
  clearElement(elements.graphNodes);
  clearElement(elements.graphProperties);

  clearElement(elements.challengeQuestions);
  clearElement(elements.requiredEvidenceIds);
  clearElement(elements.alternativeInterpretations);
  clearElement(elements.possibleCounterevidence);
  clearElement(elements.invalidConclusions);
  clearElement(elements.questionsToResolve);

  clearElement(elements.evaluationStrengths);
  clearElement(elements.evaluationWeaknesses);
  clearElement(elements.unsupportedClaims);
  clearElement(elements.improvedReasoningSteps);
  clearElement(elements.finalAnswer);

  if (elements.totalScore) {
    elements.totalScore.textContent = "0";
  }

  resetEvaluationMeters();

  validateQuestion({
    showValidationError: false,
  });

  validateReflection({
    showValidation: false,
  });

  activateTab("graph");

  hideError();
  hideMessage();
}


function resetEvaluationMeters() {
  const meterDefinitions = [
    {
      scoreElement: elements.claimEvidenceScore,
      meterElement: elements.claimEvidenceMeter,
      maximum: 25,
    },
    {
      scoreElement: elements.sourceVerificationScore,
      meterElement: elements.sourceVerificationMeter,
      maximum: 25,
    },
    {
      scoreElement: elements.counterargumentScore,
      meterElement: elements.counterargumentMeter,
      maximum: 20,
    },
    {
      scoreElement: elements.uncertaintyScore,
      meterElement: elements.uncertaintyMeter,
      maximum: 15,
    },
    {
      scoreElement: elements.synthesisScore,
      meterElement: elements.synthesisMeter,
      maximum: 15,
    },
  ];

  meterDefinitions.forEach((definition) => {
    if (definition.scoreElement) {
      definition.scoreElement.textContent = (
        `0 / ${definition.maximum}`
      );
    }

    if (definition.meterElement) {
      definition.meterElement.setAttribute(
        "aria-valuenow",
        "0",
      );

      const bar = definition.meterElement.querySelector(
        ".progress-meter__bar",
      );

      if (bar) {
        bar.style.width = "0%";
      }
    }
  });
}


function handleStartNewInvestigation() {
  resetInvestigationState();
  clearInterfaceForNewInvestigation();
  setCurrentSection("question");

  elements.questionInput?.focus();
}


/* ==========================================================
   43. REGISTRO DE EVENTOS DE REFLEXIÓN Y SÍNTESIS
   ========================================================== */

function registerReflectionEventListeners() {
  elements.toggleCounterAnalysis?.addEventListener(
    "click",
    handleCounterAnalysisToggle,
  );

  elements.reflectionInput?.addEventListener(
    "input",
    handleReflectionInput,
  );

  elements.reflectionForm?.addEventListener(
    "submit",
    handleReflectionSubmit,
  );

  elements.returnToEvidence?.addEventListener(
    "click",
    handleReturnToEvidence,
  );

  elements.copyFinalAnswer?.addEventListener(
    "click",
    handleCopyFinalAnswer,
  );

  elements.reviewReflection?.addEventListener(
    "click",
    handleReviewReflection,
  );

  elements.startNewInvestigation?.addEventListener(
    "click",
    handleStartNewInvestigation,
  );
}


/* ==========================================================
   44. MANEJO DE ERRORES NO CAPTURADOS
   ========================================================== */

/**
 * Evita que errores inesperados de JavaScript dejen la interfaz
 * sin retroalimentación. Los detalles técnicos permanecen en
 * la consola y el usuario recibe un mensaje general.
 */
window.addEventListener("error", (event) => {
  console.error(
    "Error no controlado en ÁgoraMX:",
    event.error || event.message,
  );

  if (
    event.error
    && event.error.name === "ResizeObserverLoopError"
  ) {
    return;
  }

  showError(
    "Ocurrió un error inesperado en la interfaz. "
    + "Puedes intentar nuevamente o recargar la página.",
  );
});


window.addEventListener(
  "unhandledrejection",
  (event) => {
    console.error(
      "Promesa rechazada sin manejar en ÁgoraMX:",
      event.reason,
    );

    /*
     * Las solicitudes principales ya cuentan con bloques
     * try/catch. Este controlador cubre únicamente errores
     * imprevistos.
     */
    showError(
      getErrorMessage(event.reason),
    );
  },
);


/* ==========================================================
   45. ACTUALIZACIÓN DEL TEMA DEL SISTEMA
   ========================================================== */

/**
 * Si el usuario no eligió un tema manualmente, la interfaz
 * responde a cambios en la preferencia del sistema operativo.
 */
const systemThemeQuery = window.matchMedia(
  "(prefers-color-scheme: dark)",
);


function handleSystemThemeChange(event) {
  const storedTheme = localStorage.getItem(
    CONFIG.storageKeys.theme,
  );

  if (
    storedTheme === "light"
    || storedTheme === "dark"
  ) {
    return;
  }

  applyTheme(
    event.matches ? "dark" : "light",
    false,
  );
}


if (
  typeof systemThemeQuery.addEventListener
  === "function"
) {
  systemThemeQuery.addEventListener(
    "change",
    handleSystemThemeChange,
  );
} else if (
  typeof systemThemeQuery.addListener
  === "function"
) {
  /*
   * Compatibilidad con navegadores antiguos.
   */
  systemThemeQuery.addListener(
    handleSystemThemeChange,
  );
}


/* ==========================================================
   46. MEJORAS DE ACCESIBILIDAD
   ========================================================== */

/**
 * Cierra el diálogo de evidencia con Escape cuando el navegador
 * no implementa completamente <dialog>.
 */
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape"
    && elements.evidenceDialog?.hasAttribute("open")
  ) {
    closeEvidenceDialog();
  }
});


/**
 * Informa a tecnologías de asistencia cuando una etapa cambia.
 */
function announceCurrentSection() {
  const currentStep = document.querySelector(
    `.progress-step[data-step="${state.currentSection}"]`,
  );

  const label = currentStep?.querySelector(
    ".progress-step__label",
  )?.textContent;

  if (!label) {
    return;
  }

  const announcement = createElement("div", {
    text: `Etapa actual: ${label}.`,
    attributes: {
      role: "status",
      "aria-live": "polite",
    },
  });

  announcement.style.position = "fixed";
  announcement.style.width = "1px";
  announcement.style.height = "1px";
  announcement.style.overflow = "hidden";
  announcement.style.clip = "rect(0, 0, 0, 0)";
  announcement.style.whiteSpace = "nowrap";

  document.body.appendChild(announcement);

  window.setTimeout(() => {
    announcement.remove();
  }, 1200);
}


/*
 * Conservamos una referencia a la función original y añadimos
 * el anuncio accesible sin cambiar las llamadas existentes.
 */
const originalSetCurrentSection = setCurrentSection;

setCurrentSection = function enhancedSetCurrentSection(
  sectionName,
  options = {},
) {
  originalSetCurrentSection(
    sectionName,
    options,
  );

  announceCurrentSection();
};


/* ==========================================================
   FIN DE LA PARTE 3 DE 3

   El archivo /static/js/app.js está completo cuando contiene,
   en este orden:

   1. Parte 1
   2. Parte 2
   3. Parte 3
   ========================================================== */
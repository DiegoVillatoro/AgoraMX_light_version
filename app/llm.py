from __future__ import annotations

import json
import re
from typing import TypeVar

import httpx
from pydantic import BaseModel

from app.config import Settings


T = TypeVar("T", bound=BaseModel)


class LLMClient:
    def __init__(self, settings: Settings):
        self.base_url = settings.llm_base_url.rstrip("/")
        self.api_key = settings.llm_api_key
        self.model = settings.llm_model
        self.temperature = settings.llm_temperature

    async def complete(
        self,
        system: str,
        user: str,
    ) -> str:
        headers = {
            "Content-Type": "application/json",
        }

        if self.api_key:
            headers["Authorization"] = (
                f"Bearer {self.api_key}"
            )

        payload = {
            "model": self.model,
            "temperature": self.temperature,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }

        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        return data["choices"][0]["message"]["content"]

    async def structured(
        self,
        system: str,
        user: str,
        schema: type[T],
    ) -> T:
        schema_json = json.dumps(
            schema.model_json_schema(),
            ensure_ascii=False,
        )

        prompt = f"""
{user}

Devuelve exclusivamente JSON válido.
No uses bloques Markdown.
El resultado debe cumplir este JSON Schema:

{schema_json}
""".strip()

        raw = await self.complete(system, prompt)
        payload = self._extract_json(raw)

        return schema.model_validate(payload)

    @staticmethod
    def _extract_json(raw: str) -> dict:
        value = raw.strip()

        value = re.sub(
            r"^```(?:json)?\s*",
            "",
            value,
            flags=re.IGNORECASE,
        )
        value = re.sub(r"\s*```$", "", value)

        try:
            return json.loads(value)
        except json.JSONDecodeError:
            match = re.search(
                r"\{.*\}",
                value,
                flags=re.DOTALL,
            )

            if not match:
                raise ValueError(
                    "El LLM no devolvió un objeto JSON."
                )

            return json.loads(match.group(0))
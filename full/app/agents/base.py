from abc import ABC, abstractmethod
import httpx
from app import config_store


class BaseAgent(ABC):
    """
    모든 에이전트의 추상 기반 클래스.
    설정은 매 호출마다 config_store에서 읽어 GUI 변경이 즉시 반영된다.
    """

    agent_name: str = "base"

    @property
    def _cfg(self) -> dict:
        return config_store.get_agent_config(self.agent_name)

    @property
    def base_url(self) -> str:
        return self._cfg["base_url"]

    @property
    def api_key(self) -> str:
        return self._cfg["api_key"]

    @property
    def model(self) -> str:
        return self._cfg["model"]

    @abstractmethod
    def build_system_prompt(self, pipeline_context: dict) -> str:
        pass

    @abstractmethod
    def build_user_prompt(self, pipeline_context: dict) -> str:
        pass

    async def run(self, pipeline_context: dict) -> str:
        messages = [
            {"role": "system", "content": self.build_system_prompt(pipeline_context)},
            {"role": "user",   "content": self.build_user_prompt(pipeline_context)},
        ]
        return await self._call_llm(messages)

    async def _call_llm(self, messages: list[dict]) -> str:
        timeout = float(config_store.load().get("request_timeout", 60.0))
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {"model": self.model, "messages": messages, "temperature": 0.7}

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]

    def _format_history(self, pipeline_context: dict) -> str:
        history = pipeline_context.get("chat_history", [])
        window = pipeline_context.get("context_window", 10)
        recent = history[-window:] if len(history) > window else history
        lines = [
            f"[{'유저' if m['role'] == 'user' else 'AI'}]: {m['content']}"
            for m in recent
        ]
        return "\n".join(lines) if lines else "(대화 히스토리 없음)"

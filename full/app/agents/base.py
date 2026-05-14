from abc import ABC, abstractmethod
from app import config_store
from app.llm_client import call_llm


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

    @property
    def temperature(self) -> float:
        return self._cfg["temperature"]

    @property
    def max_tokens(self) -> int | None:
        return self._cfg["max_tokens"]

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
        return await call_llm(self._cfg, messages, timeout)

    def _format_history(self, pipeline_context: dict) -> str:
        history = pipeline_context.get("chat_history", [])
        window = pipeline_context.get("context_window", 10)
        recent = history[-window:] if len(history) > window else history
        lines = [
            f"[{'유저' if m['role'] == 'user' else 'AI'}]: {m['content']}"
            for m in recent
        ]
        return "\n".join(lines) if lines else "(대화 히스토리 없음)"

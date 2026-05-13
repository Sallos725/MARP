from abc import ABC, abstractmethod
import httpx
from app.config import get_settings


class BaseAgent(ABC):
    """
    모든 에이전트의 추상 기반 클래스.
    OpenAI 호환 엔드포인트를 사용합니다.
    """

    agent_name: str = "base"  # 서브클래스에서 오버라이드

    def __init__(self):
        self.settings = get_settings()
        self._config = self.settings.get_agent_config(self.agent_name)

    @property
    def base_url(self) -> str:
        return self._config["base_url"]

    @property
    def api_key(self) -> str:
        return self._config["api_key"]

    @property
    def model(self) -> str:
        return self._config["model"]

    @abstractmethod
    def build_system_prompt(self, pipeline_context: dict) -> str:
        """에이전트별 시스템 프롬프트 생성."""
        pass

    @abstractmethod
    def build_user_prompt(self, pipeline_context: dict) -> str:
        """에이전트별 유저 프롬프트 생성."""
        pass

    async def run(self, pipeline_context: dict) -> str:
        """
        에이전트 실행. LLM을 호출하고 텍스트 응답 반환.
        pipeline_context는 파이프라인 전체 공유 딕셔너리.
        """
        system_prompt = self.build_system_prompt(pipeline_context)
        user_prompt = self.build_user_prompt(pipeline_context)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        return await self._call_llm(messages)

    async def _call_llm(self, messages: list[dict]) -> str:
        """OpenAI 호환 API 호출."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.7,
        }

        async with httpx.AsyncClient(timeout=self.settings.request_timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]

    def _format_history(self, pipeline_context: dict) -> str:
        """슬라이딩 윈도우 히스토리를 문자열로 포맷."""
        history = pipeline_context.get("chat_history", [])
        window = pipeline_context.get("context_window", 10)
        recent = history[-window:] if len(history) > window else history

        lines = []
        for msg in recent:
            role_label = "유저" if msg["role"] == "user" else "AI"
            lines.append(f"[{role_label}]: {msg['content']}")
        return "\n".join(lines) if lines else "(대화 히스토리 없음)"

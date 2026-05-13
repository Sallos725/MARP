from app.agents.base import BaseAgent


class PlotAgent(BaseAgent):
    """서사 흐름 관리 에이전트."""

    agent_name = "plot"

    def build_system_prompt(self, pipeline_context: dict) -> str:
        return (
            "당신은 플롯 관리 에이전트입니다.\n"
            "세계관 메모와 대화 히스토리를 바탕으로 현재 서사 흐름을 분석하고 "
            "이번 씬의 플롯 방향을 간결한 메모 형식으로 제시하세요.\n\n"
            "출력 형식 (불릿 포인트):\n"
            "- 현재 아크/스토리 진행 상황\n"
            "- 이번 씬 목적\n"
            "- 권장 전개 방향\n"
            "- 유지해야 할 복선/미공개 정보\n\n"
            "간결하게 핵심만 기술하세요. 최종 응답은 작성하지 마세요."
        )

    def build_user_prompt(self, pipeline_context: dict) -> str:
        context_world = pipeline_context.get("context_world", "(세계관 메모 없음)")
        history = self._format_history(pipeline_context)
        user_input = pipeline_context.get("user_input", "")

        return (
            f"[세계관 에이전트 메모]\n{context_world}\n\n"
            f"[최근 대화]\n{history}\n\n"
            f"[현재 유저 입력]\n{user_input}\n\n"
            "위 정보를 바탕으로 플롯 방향 메모를 작성하세요."
        )

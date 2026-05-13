from app.agents.base import BaseAgent


class WorldbuildingAgent(BaseAgent):
    """세계관 일관성 체크 에이전트."""

    agent_name = "worldbuilding"

    def build_system_prompt(self, pipeline_context: dict) -> str:
        return (
            "당신은 세계관 일관성 에이전트입니다.\n"
            "주어진 세계관 설정과 대화 히스토리를 바탕으로 현재 씬의 세계관 관련 주의사항과 "
            "보강 정보를 간결한 메모 형식으로 작성하세요.\n\n"
            "출력 형식 (불릿 포인트):\n"
            "- 현재 씬/배경 정보\n"
            "- 활성화된 세계관 규칙 (마법 금지, 특수 조건 등)\n"
            "- 주의해야 할 설정 (이전 대화에서 확립된 사항)\n"
            "- 세계관 보강 정보\n\n"
            "간결하게 핵심만 기술하세요. 최종 응답은 작성하지 마세요."
        )

    def build_user_prompt(self, pipeline_context: dict) -> str:
        world_summary = pipeline_context.get("world_summary", "(세계관 설정 없음)")
        history = self._format_history(pipeline_context)
        user_input = pipeline_context.get("user_input", "")

        return (
            f"[세계관 설정]\n{world_summary}\n\n"
            f"[최근 대화]\n{history}\n\n"
            f"[현재 유저 입력]\n{user_input}\n\n"
            "위 정보를 바탕으로 세계관 일관성 메모를 작성하세요."
        )

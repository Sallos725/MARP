from app.agents.base import BaseAgent


class CharacterAgent(BaseAgent):
    """캐릭터 성격/말투 일관성 에이전트."""

    agent_name = "character"

    def build_system_prompt(self, pipeline_context: dict) -> str:
        return (
            "당신은 등장인물 에이전트입니다.\n"
            "세계관 메모, 플롯 메모, 인물 설정을 바탕으로 이번 씬에 등장하는 "
            "캐릭터들의 성격과 말투를 정리하세요.\n\n"
            "출력 형식 (불릿 포인트):\n"
            "- 주요 NPC 성격/말투 특성\n"
            "- 현재 캐릭터 심리 상태\n"
            "- OOC(Out of Character) 주의사항\n"
            "- 등장 예정 캐릭터 안내\n\n"
            "간결하게 핵심만 기술하세요. 최종 응답은 작성하지 마세요."
        )

    def build_user_prompt(self, pipeline_context: dict) -> str:
        char_summary = pipeline_context.get("char_summary", "(인물 설정 없음)")
        context_world = pipeline_context.get("context_world", "(세계관 메모 없음)")
        context_plot = pipeline_context.get("context_plot", "(플롯 메모 없음)")
        history = self._format_history(pipeline_context)
        user_input = pipeline_context.get("user_input", "")

        return (
            f"[인물 설정]\n{char_summary}\n\n"
            f"[세계관 에이전트 메모]\n{context_world}\n\n"
            f"[플롯 에이전트 메모]\n{context_plot}\n\n"
            f"[최근 대화]\n{history}\n\n"
            f"[현재 유저 입력]\n{user_input}\n\n"
            "위 정보를 바탕으로 캐릭터 보정 메모를 작성하세요."
        )

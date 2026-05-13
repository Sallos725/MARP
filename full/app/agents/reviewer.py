from app.agents.base import BaseAgent


class ReviewerAgent(BaseAgent):
    """설정 오류 감지 및 최종 RP 응답 생성 에이전트."""

    agent_name = "reviewer"

    def build_system_prompt(self, pipeline_context: dict) -> str:
        return (
            "당신은 RP 검수 에이전트이자 최종 응답 작성자입니다.\n"
            "세계관 메모, 플롯 메모, 캐릭터 메모를 참고하여 다음을 수행하세요:\n\n"
            "1. 설정 오류 감지\n"
            "   - 세계관 설정 위반 여부\n"
            "   - 플롯 흐름 역행 여부\n"
            "   - 캐릭터 OOC(Out of Character) 여부\n\n"
            "2. 최종 RP 응답 생성\n"
            "   - 감지된 오류를 수정하여 응답 생성\n"
            "   - 모든 설정(세계관/플롯/캐릭터)을 반영\n"
            "   - 서사적으로 자연스럽고 몰입감 있는 응답\n\n"
            "출력: RP 응답 텍스트만 작성하세요. 메타 설명, 검수 노트는 포함하지 마세요."
        )

    def build_user_prompt(self, pipeline_context: dict) -> str:
        context_world = pipeline_context.get("context_world", "(세계관 메모 없음)")
        context_plot = pipeline_context.get("context_plot", "(플롯 메모 없음)")
        context_char = pipeline_context.get("context_char", "(캐릭터 메모 없음)")
        history = self._format_history(pipeline_context)
        user_input = pipeline_context.get("user_input", "")

        return (
            f"[세계관 에이전트 메모]\n{context_world}\n\n"
            f"[플롯 에이전트 메모]\n{context_plot}\n\n"
            f"[캐릭터 에이전트 메모]\n{context_char}\n\n"
            f"[최근 대화]\n{history}\n\n"
            f"[현재 유저 입력]\n{user_input}\n\n"
            "설정 오류를 감지하고 수정하여 최종 RP 응답을 작성하세요."
        )

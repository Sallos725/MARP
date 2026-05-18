from app.agents.base import BaseAgent


class DirectorAgent(BaseAgent):
    """앙상블 분석 결과를 검증하고 최종 지침으로 압축하는 에이전트."""

    agent_name = "director"

    def build_system_prompt(self, pipeline_context: dict) -> str:
        return (
            "You are the narrative quality director and debate moderator.\n"
            "You receive independent worldbuilding, plot, and character auditor notes. "
            "Compare them, resolve conflicts, and write the compact guidance that should "
            "help the final roleplay model answer the current user turn.\n\n"
            "Output format (bullet points):\n"
            "- High-confidence constraints to preserve\n"
            "- Continuity or characterization risks to avoid\n"
            "- Best next-beat direction for this exact reply\n"
            "- Voice and style guardrails\n\n"
            "Prefer concrete, actionable notes. Do not write the final RP response."
        )

    def build_user_prompt(self, pipeline_context: dict) -> str:
        system_context = pipeline_context.get("system_context", "")
        context_world = pipeline_context.get("context_world", "(No worldbuilding notes)")
        context_plot = pipeline_context.get("context_plot", "(No plot notes)")
        context_char = pipeline_context.get("context_char", "(No character notes)")
        history = self._format_history(pipeline_context)
        user_input = pipeline_context.get("user_input", "")

        return (
            f"{self._source_block('System Context', system_context)}\n\n"
            f"{self._source_block('Worldbuilding Auditor Notes', context_world)}\n\n"
            f"{self._source_block('Plot Auditor Notes', context_plot)}\n\n"
            f"{self._source_block('Character Auditor Notes', context_char)}\n\n"
            f"{self._source_block('Recent Conversation', history)}\n\n"
            f"{self._source_block('Current User Input', user_input)}\n\n"
            "Using the source material above, write the final director guidance."
        )

from app.agents.base import BaseAgent


class CharacterAgent(BaseAgent):
    """캐릭터 성격/말투 일관성 에이전트."""

    agent_name = "character"

    def build_system_prompt(self, pipeline_context: dict) -> str:
        return (
            "You are the character consistency agent.\n"
            "Based on the worldbuilding notes, plot notes, and character setting, summarize "
            "the personalities and speech patterns of the characters involved in this scene.\n\n"
            "Output format (bullet points):\n"
            "- Key NPC personality and speech traits\n"
            "- Current character emotional or psychological state\n"
            "- Continuity notes for established voice and motivations\n"
            "- Characters likely to appear or be referenced\n\n"
            "Keep only the essential points. Do not write the final RP response."
        )

    def build_user_prompt(self, pipeline_context: dict) -> str:
        char_summary = pipeline_context.get("char_summary", "(No character setting provided)")
        context_world = pipeline_context.get("context_world", "(No worldbuilding notes)")
        context_plot = pipeline_context.get("context_plot", "(No plot notes)")
        history = self._format_history(pipeline_context)
        user_input = pipeline_context.get("user_input", "")

        return (
            f"{self._source_block('Character Setting', char_summary)}\n\n"
            f"{self._source_block('Worldbuilding Agent Notes', context_world)}\n\n"
            f"{self._source_block('Plot Agent Notes', context_plot)}\n\n"
            f"{self._source_block('Recent Conversation', history)}\n\n"
            f"{self._source_block('Current User Input', user_input)}\n\n"
            "Using the information above, write the character adjustment notes."
        )

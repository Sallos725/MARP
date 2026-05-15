from app.agents.base import BaseAgent


class PlotAgent(BaseAgent):
    """서사 흐름 관리 에이전트."""

    agent_name = "plot"

    def build_system_prompt(self, pipeline_context: dict) -> str:
        return (
            "You are the plot management agent.\n"
            "Based on the worldbuilding notes and chat history, analyze the current "
            "narrative flow and present concise notes on the plot direction for this scene.\n\n"
            "Output format (bullet points):\n"
            "- Current arc/story progress\n"
            "- Purpose of this scene\n"
            "- Recommended direction for the next development\n"
            "- Foreshadowing or unrevealed information that must be preserved\n\n"
            "Keep only the essential points. Do not write the final RP response."
        )

    def build_user_prompt(self, pipeline_context: dict) -> str:
        context_world = pipeline_context.get("context_world", "(No worldbuilding notes)")
        history = self._format_history(pipeline_context)
        user_input = pipeline_context.get("user_input", "")

        return (
            f"[Worldbuilding Agent Notes]\n{context_world}\n\n"
            f"[Recent Conversation]\n{history}\n\n"
            f"[Current User Input]\n{user_input}\n\n"
            "Using the information above, write the plot direction notes."
        )

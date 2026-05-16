from app.agents.base import BaseAgent


class WorldbuildingAgent(BaseAgent):
    """세계관 일관성 체크 에이전트."""

    agent_name = "worldbuilding"

    def build_system_prompt(self, pipeline_context: dict) -> str:
        return (
            "You are the worldbuilding consistency agent.\n"
            "Based on the given world setting and chat history, write concise notes on "
            "worldbuilding concerns and useful reinforcement for the current scene.\n\n"
            "Output format (bullet points):\n"
            "- Current scene/background information\n"
            "- Active world rules (for example: no magic, special conditions, taboos)\n"
            "- Established details that must be preserved from earlier conversation\n"
            "- Additional worldbuilding reinforcement\n\n"
            "Keep only the essential points. Do not write the final RP response."
        )

    def build_user_prompt(self, pipeline_context: dict) -> str:
        world_summary = pipeline_context.get("world_summary", "(No world setting provided)")
        history = self._format_history(pipeline_context)
        user_input = pipeline_context.get("user_input", "")

        return (
            f"{self._source_block('World Setting', world_summary)}\n\n"
            f"{self._source_block('Recent Conversation', history)}\n\n"
            f"{self._source_block('Current User Input', user_input)}\n\n"
            "Using the information above, write the worldbuilding consistency notes."
        )

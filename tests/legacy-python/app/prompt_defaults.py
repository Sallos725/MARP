from app import config_store
from app.agents import CharacterAgent, PlotAgent, WorldbuildingAgent


PROMPT_PLACEHOLDER_CONTEXT = {
    "user_input": "{{user_input}}",
    "chat_history": [{"role": "user", "content": "{{chat_history}}"}],
    "system_context": "{{system_context}}",
    "world_summary": "{{world_summary}}",
    "char_summary": "{{char_summary}}",
    "context_world": "{{context_world}}",
    "context_plot": "{{context_plot}}",
    "context_char": "{{context_char}}",
}


def default_prompt_pack() -> dict:
    """Return built-in prompts for UI preview/export without exposing secrets."""
    agents = [
        WorldbuildingAgent(),
        PlotAgent(),
        CharacterAgent(),
    ]
    labels = dict(config_store.AGENTS)
    return {
        "version": 1,
        "agents": {
            agent.agent_name: {
                "name": agent.agent_name,
                "label": labels.get(agent.agent_name, agent.agent_name),
                "system_prompt": agent.build_system_prompt(PROMPT_PLACEHOLDER_CONTEXT),
                "user_prompt_template": agent.build_user_prompt(PROMPT_PLACEHOLDER_CONTEXT),
            }
            for agent in agents
        },
    }

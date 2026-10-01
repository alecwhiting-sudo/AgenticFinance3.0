"""Minimal agent loop built on the Anthropic API.

This is the template every finance agent starts from: a system prompt, a set of
tools, and a loop that runs until the model produces a final answer. Real agents
replace the example tool with their own (ledger queries, bank feeds, document
parsing) and add human-approval checkpoints before anything irreversible.
"""

import os

from anthropic import Anthropic

SYSTEM_PROMPT = """\
You are a finance agent for a small business. Be precise with numbers, state
assumptions explicitly, and never invent figures. If a task would move money or
commit the business externally, stop and describe what approval is needed
instead of acting.
"""

TOOLS = [
    {
        "name": "calculator",
        "description": "Evaluate a basic arithmetic expression (+, -, *, /, parentheses).",
        "input_schema": {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "e.g. '1200 * 1.2 - 340'"}
            },
            "required": ["expression"],
        },
    }
]


def _run_tool(name: str, tool_input: dict) -> str:
    if name == "calculator":
        expression = tool_input["expression"]
        allowed = set("0123456789.+-*/() ")
        if not set(expression) <= allowed:
            return "error: expression contains unsupported characters"
        try:
            return str(eval(expression, {"__builtins__": {}}, {}))
        except Exception as exc:
            return f"error: {exc}"
    return f"error: unknown tool {name!r}"


def run_agent(task: str, max_turns: int = 10) -> str:
    """Run the agent loop on a task and return the final text answer."""
    client = Anthropic()
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")
    messages = [{"role": "user", "content": task}]

    for _ in range(max_turns):
        response = client.messages.create(
            model=model,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            return "".join(
                block.text for block in response.content if block.type == "text"
            )

        tool_results = [
            {
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": _run_tool(block.name, block.input),
            }
            for block in response.content
            if block.type == "tool_use"
        ]
        messages.append({"role": "user", "content": tool_results})

    return "error: agent did not finish within the turn limit"

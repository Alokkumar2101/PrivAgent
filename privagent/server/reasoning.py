"""
PrivAgent :: Reasoning Layer

This local prototype uses deterministic, rule-based reasoning that mimics
the OUTPUT SHAPE of an LLM planning service, so no paid API key is needed
for the SIH demo. The function signature and return shape are designed so
this can be swapped for a real call to OpenAI / Claude / Gemini / a local
Ollama model without changing any calling code elsewhere in the server.

REAL UPGRADE PATH (documented, optional):
    import anthropic
    client = anthropic.Anthropic(api_key=...)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{"role": "user", "content": build_prompt(context, goal)}]
    )
    return parse_steps(response.content[0].text)
"""

from typing import Dict, List


def generate_reasoning(context: Dict, goal: str) -> List[str]:
    """
    Produces a concise, human-readable reasoning trace. Never exposes a
    private chain-of-thought — only a short decision summary, per the
    project's transparency requirements.
    """
    page = context.get("page", "the current page")
    pii_count = context.get("pii_detected", 0)
    fields = context.get("fields", {})

    steps = [
        f"Identify user task: \"{goal}\" on \"{page}\".",
        "Use only sanitized context — no raw PII is available to reasoning.",
    ]

    if pii_count > 0:
        steps.append(
            f"Note: {pii_count} PII field(s) were detected and redacted client-side "
            f"({', '.join(fields.keys()) if fields else 'unspecified fields'})."
        )
    else:
        steps.append("No PII fields were present in the sanitized context.")

    steps.append("Evaluate risk of the requested action before planning.")
    steps.append("Generate a safe, schema-validated action plan for the client to execute.")

    return steps

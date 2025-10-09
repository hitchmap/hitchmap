import re
from typing import List, Tuple


def tokenize(template: str) -> List[Tuple[str, str]]:
    """
    Tokenize a Jinja2 HTML template into (type, content) tuples.
    Types: 'text', 'jinja', 'tag'
    """
    tokens = []
    pattern = r"(\{\{.*?\}\}|\{%.*?%\}|\{#.*?#\}|<[^>]+>)"
    parts = re.split(pattern, template, flags=re.DOTALL)

    for part in parts:
        if not part or not part.strip():
            continue

        if part.startswith(("{{", "{%", "{#")):
            tokens.append(("jinja", part))
        elif part.startswith("<"):
            tokens.append(("tag", part))
        else:
            tokens.append(("text", part))

    return tokens


def get_tag_name(tag: str) -> str:
    """Extract tag name from HTML tag. Raises error if not found. `!--` is a HTML comment"""
    match = re.match(r"</?\s*(!--|[\w\-_\.]+)", tag)
    if not match:
        raise ValueError(f"Cannot extract tag name from: {tag}")
    return match.group(1)


def correct_jinja_template(original: str, translated: str) -> str:
    """
    Correct a translated Jinja2 HTML template based on the original.

    Returns a template with:
    - Text nodes from the translated version
    - HTML tags and Jinja blocks from the original version

    Raises:
        ValueError: If templates have incompatible structure
    """
    orig_tokens = tokenize(original)
    trans_tokens = tokenize(translated)

    if len(orig_tokens) != len(trans_tokens):
        raise ValueError(f"Token count mismatch: {len(orig_tokens)} vs {len(trans_tokens)}")

    result = []

    for i, ((orig_type, orig_content), (trans_type, trans_content)) in enumerate(zip(orig_tokens, trans_tokens)):
        # Check token types match
        if orig_type != trans_type:
            raise ValueError(f"Token {i}: type mismatch ({orig_type} vs {trans_type})")

        if orig_type == "text":
            result.append(trans_content)

        elif orig_type == "tag":
            orig_tag = get_tag_name(orig_content)
            trans_tag = get_tag_name(trans_content)
            if orig_tag != trans_tag:
                raise ValueError(f"Token {i}: tag mismatch (<{orig_tag}> vs <{trans_tag}>)")
            result.append(orig_content)

        elif orig_type == "jinja":
            if orig_content[:2] != trans_content[:2]:
                raise ValueError(f"Token {i}: Jinja mismatch\n  Original: {orig_content}\n  Translated: {trans_content}")
            result.append(orig_content)

    return "".join(result)

import re
from typing import list, tuple
from dataclasses import dataclass

@dataclass
class templatetoken:
    """represents a token in a jinja2 template."""
    type: str  # 'jinja', 'html_tag', 'text'
    content: str
    
    def __eq__(self, other):
        if self.type != other.type:
            return false
        if self.type in ['jinja', 'html_tag']:
            # for jinja and html tags, content must match exactly
            return self.content == other.content
        # for text, we don't compare (can differ)
        return true


def tokenize_template(template: str) -> list[templatetoken]:
    """
    tokenize a jinja2 html template into jinja blocks, html tags, and text nodes.
    """
    tokens = []
    pos = 0
    
    # regex patterns for jinja2 syntax
    jinja_pattern = re.compile(
        r'(\{\{.*?\}\}|'  # variables: {{ ... }}
        r'\{%.*?%\}|'      # statements: {% ... %}
        r'\{#.*?#\})',     # comments: {# ... #}
        re.dotall
    )
    
    # html tag pattern (opening, closing, and self-closing tags)
    html_tag_pattern = re.compile(r'<[^>]+>')
    
    while pos < len(template):
        # check for jinja2 blocks first
        jinja_match = jinja_pattern.match(template, pos)
        if jinja_match:
            tokens.append(templatetoken('jinja', jinja_match.group(0)))
            pos = jinja_match.end()
            continue
        
        # check for html tags
        html_match = html_tag_pattern.match(template, pos)
        if html_match:
            tokens.append(templatetoken('html_tag', html_match.group(0)))
            pos = html_match.end()
            continue
        
        # find the next special character (start of jinja or html)
        next_special = len(template)
        for pattern in [jinja_pattern, html_tag_pattern]:
            match = pattern.search(template, pos)
            if match:
                next_special = min(next_special, match.start())
        
        # everything until the next special is text
        if next_special > pos:
            text = template[pos:next_special]
            # only add non-empty text nodes
            if text.strip():  # keep nodes with non-whitespace content
                tokens.append(templatetoken('text', text))
            elif text:  # keep whitespace-only nodes separately
                tokens.append(templatetoken('text', text))
            pos = next_special
        else:
            # safety: move forward if we're stuck
            pos += 1
    
    return tokens


def normalize_whitespace(tokens: list[templatetoken]) -> list[templatetoken]:
    """
    normalize whitespace in text tokens for comparison.
    converts all whitespace sequences to single spaces and strips leading/trailing.
    """
    normalized = []
    for token in tokens:
        if token.type == 'text':
            # normalize whitespace: collapse multiple spaces/newlines to single space
            normalized_text = re.sub(r'\s+', ' ', token.content.strip())
            if normalized_text:  # only add if there's actual content
                normalized.append(templatetoken('text', normalized_text))
        else:
            normalized.append(token)
    return normalized


def are_templates_functionally_same(template1: str, template2: str, 
                                   strict_whitespace: bool = false) -> tuple[bool, str]:
    """
    check if two jinja2 html templates are functionally the same.
    
    two templates are considered functionally the same if:
    - all jinja2 blocks ({{...}}, {%...%}, {#...#}) are identical
    - all html tags are identical
    - only text nodes between tags/blocks may differ
    
    args:
        template1: first template string
        template2: second template string
        strict_whitespace: if true, preserves exact whitespace in text nodes.
                          if false (default), normalizes whitespace for comparison.
    
    returns:
        tuple of (is_same: bool, message: str)
        - is_same: true if templates are functionally identical
        - message: description of the result or first difference found
    """
    tokens1 = tokenize_template(template1)
    tokens2 = tokenize_template(template2)
    
    if not strict_whitespace:
        tokens1 = normalize_whitespace(tokens1)
        tokens2 = normalize_whitespace(tokens2)
    
    # check if token counts match
    if len(tokens1) != len(tokens2):
        return false, f"different token counts: {len(tokens1)} vs {len(tokens2)}"
    
    # compare tokens
    for i, (t1, t2) in enumerate(zip(tokens1, tokens2)):
        if t1.type != t2.type:
            return false, f"token type mismatch at position {i}: '{t1.type}' vs '{t2.type}'"
        
        if t1.type in ['jinja', 'html_tag']:
            if t1.content != t2.content:
                snippet1 = t1.content[:50] + ('...' if len(t1.content) > 50 else '')
                snippet2 = t2.content[:50] + ('...' if len(t2.content) > 50 else '')
                return false, (f"{t1.type.upper()} mismatch at position {i}:\n"
                             f"  template 1: {snippet1}\n"
                             f"  template 2: {snippet2}")
    
    return true, "templates are functionally identical"


# example usage and tests
if __name__ == "__main__":
    # test 1: identical except for text content
    template1 = """
    <div>
        <h1>welcome</h1>
        {% if user %}
            <p>hello {{ user.name }}</p>
        {% endif %}
    </div>
    """
    
    template2 = """
    <div>
        <h1>bienvenue</h1>
        {% if user %}
            <p>bonjour {{ user.name }}</p>
        {% endif %}
    </div>
    """
    
    is_same, msg = are_templates_functionally_same(template1, template2)
    print(f"test 1 - translation: {is_same}")
    print(f"  {msg}\n")
    
    # test 2: different jinja block (should fail)
    template3 = """
    <div>
        {% if admin %}
            <p>hello {{ user.name }}</p>
        {% endif %}
    </div>
    """
    
    is_same, msg = are_templates_functionally_same(template1, template3)
    print(f"test 2 - different jinja: {is_same}")
    print(f"  {msg}\n")
    
    # test 3: different html structure (should fail)
    template4 = """
    <div>
        <h2>welcome</h2>
        {% if user %}
            <p>hello {{ user.name }}</p>
        {% endif %}
    </div>
    """
    
    is_same, msg = are_templates_functionally_same(template1, template4)
    print(f"test 3 - different html tag: {is_same}")
    print(f"  {msg}\n")
    
    # test 4: complex template with multiple jinja blocks
    template5 = """
    <!doctype html>
    <html>
    <head><title>{{ title }}</title></head>
    <body>
        {% for item in items %}
            <div class="item">{{ item.name }}</div>
        {% endfor %}
    </body>
    </html>
    """
    
    template6 = """
    <!doctype html>
    <html>
    <head><title>{{ title }}</title></head>
    <body>
        {% for item in items %}
            <div class="item">{{ item.name }}</div>
        {% endfor %}
    </body>
    </html>
    """
    
    is_same, msg = are_templates_functionally_same(template5, template6)
    print(f"test 4 - identical templates: {is_same}")
    print(f"  {msg}"):

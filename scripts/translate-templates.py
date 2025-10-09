import asyncio
import logging
import os
import re
from datetime import datetime
from pathlib import Path

import httpx
import time
from openai import AsyncOpenAI
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    before_sleep_log,
)

from helpers import get_db, root_dir
from translate_helpers import are_templates_functionally_same

# Set up logging
logging.basicConfig(level=logging.INFO)
httpx_logger = logging.getLogger("httpx")

# Set up OpenAI client
client = AsyncOpenAI(
    base_url="https://api.deepinfra.com/v1/openai",
    api_key=os.environ.get("OPENAI_API_KEY"),
)

# Configuration
TARGET_LANGUAGES = {
    "pl": "Polish",
    "en": "English",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
}

MODEL = "deepseek-ai/DeepSeek-V3.2-Exp"
MAX_CONCURRENT = 3
TEMPLATES_DIR = os.path.join(root_dir, "templates")


@retry(
    retry=retry_if_exception_type((Exception, asyncio.CancelledError)),
    stop=stop_after_attempt(60),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    before_sleep=before_sleep_log(httpx_logger, logging.WARNING),
)
async def translate_template(filename: str, template_content: str, target_lang: str, temp=0.3) -> str:
    """Translate a Jinja2 template with retry logic."""
    prompt = f"""Translate the following Jinja2 HTML template (filename: {filename}) to {target_lang}.

CRITICAL RULES:
- Translate ONLY the user-visible text content
- Keep ALL Jinja2 syntax unchanged ({{{{ }}}}, {{% %}}, filters, variables, etc.)
- Keep ALL HTML structure, tags, attributes, and CSS classes unchanged
- Keep ALL URLs, links, and technical identifiers unchanged
- Preserve exact whitespace and formatting
- Output ONLY the translated template with no explanations

Template to translate:"""

    response = await client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "user", "content": prompt + "\n\n```jinja2\n" + template_content + "\n```"},
            {"role": "assistant", "content": "```jinja2\n"},
        ],
        temperature=temp,
        max_tokens=len(template_content) * 2,
    )

    translation = response.choices[0].message.content.strip()

    # Extract text from code block
    file_match = re.search(r"(.*)```", translation, re.DOTALL)
    if not file_match:
        logging.warning(f"NO TRANSLATION MATCH for {filename}")
        if temp < 1:
            return await translate_template(filename, template_content, target_lang, temp=temp + 0.3)
        else:
            return None

    return file_match.group(1).strip()


async def translate_and_validate(filename: str, template_content: str, target_lang: str, max_attempts=3) -> tuple[str, bool, str]:
    """Translate template and validate it matches functionally."""
    for attempt in range(max_attempts):
        logging.info(f"Translating {filename} to {target_lang} (attempt {attempt + 1}/{max_attempts})")

        translated = await translate_template(filename, template_content, target_lang)
        if translated is None:
            continue

        # Validate the translation
        is_valid, error_msg = are_templates_functionally_same(template_content, translated)

        if is_valid:
            return translated, True, ""
        else:
            logging.warning(f"Validation failed for {filename}: {error_msg}")
            if attempt < max_attempts - 1:
                logging.info(f"Retrying with higher temperature...")

    return None, False, error_msg


# Connect to database
db_conn = get_db()
cursor = db_conn.cursor()

# Create template_translations table
cursor.execute("""
CREATE TABLE IF NOT EXISTS template_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    language TEXT NOT NULL,
    translated_content TEXT NOT NULL,
    translation_date TEXT NOT NULL,
    is_original INTEGER NOT NULL DEFAULT 0,
    UNIQUE (filename, language)
);
""")
db_conn.commit()

# Collect all template files
template_files = []
for root, dirs, files in os.walk(TEMPLATES_DIR):
    for file in files:
        if file.endswith((".html", ".jinja2", ".j2")):
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, TEMPLATES_DIR)
            template_files.append(rel_path)

print(f"Found {len(template_files)} template files")

# Step 1: Save original templates
print("\n=== Saving original templates ===")
for filename in template_files:
    full_path = os.path.join(TEMPLATES_DIR, filename)
    with open(full_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Check if original already saved
    cursor.execute("SELECT 1 FROM template_translations WHERE filename = ? AND language = 'en' AND is_original = 1", (filename,))

    if cursor.fetchone() is None:
        translation_date = datetime.utcnow().isoformat()
        cursor.execute(
            """INSERT OR REPLACE INTO template_translations
                (filename, language, translated_content, translation_date, is_original)
                VALUES (?, ?, ?, ?, 1)""",
            (filename, "en", content, translation_date),
        )
        db_conn.commit()
        logging.info(f"Saved original for {filename}")

# Step 2: Translate to target languages
for target_lang_code, target_lang_name in TARGET_LANGUAGES.items():
    if target_lang_code == "en":  # Skip English as it's the source
        continue

    print(f"\n=== Translating to {target_lang_name} ({target_lang_code}) ===")

    # Check which files already have translations
    cursor.execute("SELECT filename FROM template_translations WHERE language = ? AND is_original = 0", (target_lang_code,))
    existing_files = {row[0] for row in cursor.fetchall()}

    files_to_translate = [f for f in template_files if f not in existing_files]

    print(f"Already translated: {len(existing_files)}")
    print(f"Remaining: {len(files_to_translate)}")

    if len(files_to_translate) == 0:
        continue

    # Process in batches
    for i in range(0, len(files_to_translate), MAX_CONCURRENT):
        batch = files_to_translate[i : i + MAX_CONCURRENT]
        print(f"Processing batch {i // MAX_CONCURRENT + 1}/{(len(files_to_translate) - 1) // MAX_CONCURRENT + 1}")

        # Create translation tasks
        tasks = []
        for filename in batch:
            full_path = os.path.join(TEMPLATES_DIR, filename)
            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read()

            task = translate_and_validate(filename, content, target_lang_name)
            tasks.append((filename, task))

        # Execute translations concurrently
        results = await asyncio.gather(*[task for _, task in tasks], return_exceptions=True)

        # Save results
        for (filename, _), result in zip(tasks, results):
            if isinstance(result, Exception):
                logging.error(f"Failed to translate {filename}: {result}")
                continue

            translated_content, is_valid, error_msg = result

            if is_valid and translated_content:
                # Save to database
                translation_date = datetime.utcnow().isoformat()
                cursor.execute(
                    """INSERT OR REPLACE INTO template_translations 
                        (filename, language, translated_content, translation_date, is_original)
                        VALUES (?, ?, ?, ?, 0)""",
                    (filename, target_lang_code, translated_content, translation_date),
                )
                db_conn.commit()

                # Write to file
                output_dir = os.path.join(root_dir, "dist", "translated-templates", target_lang_code)
                output_path = os.path.join(output_dir, filename)
                os.makedirs(os.path.dirname(output_path), exist_ok=True)

                with open(output_path, "w", encoding="utf-8") as f:
                    f.write(translated_content)

                logging.info(f"Translated {filename} to {target_lang_code}")
            else:
                logging.error(f"Failed validation for {filename}: {error_msg}")

        # Small delay between batches
        time.sleep(1)

# Step 3: Generate summary report
print("\n=== Translation Summary ===")

cursor.execute("""
    SELECT language, COUNT(*) as count, MAX(translation_date) as last_updated
    FROM template_translations
    WHERE is_original = 0
    GROUP BY language
    ORDER BY language
""")

for row in cursor.fetchall():
    lang, count, last_updated = row
    print(f"{lang}: {count} templates (last updated: {last_updated})")

db_conn.close()
print("\n=== Translation complete ===")


# Run the async code
if __name__ == "__main__":
    asyncio.run(main())

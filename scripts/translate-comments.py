import asyncio
import logging
import os
import re
from datetime import datetime

import httpx
import time
import pandas as pd
from openai import AsyncOpenAI
from langdetect import detect, DetectorFactory
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    before_sleep_log,
)

from helpers import get_db, root_dir

# Set up logging
logging.basicConfig(level=logging.INFO)
httpx_logger = logging.getLogger("httpx")

# Ensure langdetect returns consistent results
DetectorFactory.seed = 0

# Set up OpenAI client (works with OpenRouter)
client = AsyncOpenAI(
    base_url="https://api.deepinfra.com/v1/openai",
    api_key=os.environ.get("OPENAI_API_KEY"),
)

# Configuration
TARGET_LANGUAGES = {
    "pl": "Polish",
    # "en": "English",
}

MODEL = "deepseek-ai/DeepSeek-V3.2-Exp"
MAX_CONCURRENT = 200


@retry(
    retry=retry_if_exception_type((Exception, asyncio.CancelledError)),
    stop=stop_after_attempt(60),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    before_sleep=before_sleep_log(httpx_logger, logging.WARNING),
)
async def get_translation(point_id: int, comment: str, rating: int, target_lang: str, temp=0.3) -> str:
    """Get translation from API with retry logic."""
    prompt = f"""Hitchmap is a website where hitchhikers share experiences on hitchhiking from spots around the world. Translate the following Hitchmap review (rating: {rating}/5) of a hitchhiking location to {target_lang}, with no other output:"""

    response = await client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "user", "content": prompt + "\n\n```txt\n" + comment + "\n```"},
            {"role": "assistant", "content": f"```txt\n"},
        ],
        temperature=temp,
        max_tokens=len(comment),
    )

    translation = response.choices[0].message.content.strip()

    # Extract text from code block
    file_match = re.search(r"(.*)```", translation, re.DOTALL)
    if not file_match:
        print(f"NO TRANSLATION MATCH for point {point_id}")
        print(translation)
        if temp < 1:
            return await get_translation(point_id, comment, rating, target_lang, temp=temp + 0.3)
        else:
            return "< NA >"

    return file_match.group(1).strip()


# Connect to database
db_conn = get_db()
cursor = db_conn.cursor()

# Create translations table if it doesn't exist
cursor.execute("""
CREATE TABLE IF NOT EXISTS comment_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    point_id INTEGER NOT NULL,
    language TEXT NOT NULL,
    translated_comment TEXT,
    translation_date TEXT NOT NULL,
    is_original INTEGER NOT NULL DEFAULT 0,
    UNIQUE (point_id, language)
);
""")
db_conn.commit()

# Load points from database
points = pd.read_sql(
    """SELECT id, comment, rating 
        FROM points 
        WHERE comment IS NOT NULL 
        AND comment != '' 
        AND not banned 
        AND revised_by IS NULL
        LIMIT 2000
    """,
    db_conn,
)

print(f"Found {len(points)} points with comments to translate")

# Step 1: Save original comments with detected language
print("\n=== Detecting and saving original languages ===")
for idx, point in points.iterrows():
    point_id = point["id"]
    comment = point["comment"]

    # Detect language
    try:
        detected_lang = detect(comment)
    except:
        detected_lang = "unknown"

    # Check if original already saved
    cursor.execute(
        "SELECT 1 FROM comment_translations WHERE point_id = ? AND language = ? AND is_original = 1", (point_id, detected_lang)
    )

    if cursor.fetchone() is None:
        translation_date = datetime.utcnow().isoformat()
        cursor.execute(
            """INSERT OR REPLACE INTO comment_translations 
                (point_id, language, translated_comment, translation_date, is_original)
                VALUES (?, ?, ?, ?, 1)""",
            (point_id, detected_lang, comment, translation_date),
        )
        db_conn.commit()
        logging.info(f"Saved original for point {point_id} (language: {detected_lang})")

# Step 2: Translate to target languages
for target_lang_code, target_lang_name in TARGET_LANGUAGES.items():
    print(f"\n=== Translating to {target_lang_name} ({target_lang_code}) ===")

    # Check which points already have comment_translations
    cursor.execute("SELECT point_id FROM comment_translations WHERE language = ?", (target_lang_code,))
    existing_ids = {row[0] for row in cursor.fetchall()}

    points_to_translate = points[~points["id"].isin(existing_ids)]

    print(f"Already translated: {len(existing_ids)}")
    print(f"Remaining: {len(points_to_translate)}")

    if len(points_to_translate) == 0:
        continue

    # Process in batches
    for i in range(0, len(points_to_translate), MAX_CONCURRENT):
        batch = points_to_translate.iloc[i : i + MAX_CONCURRENT]
        print(f"Processing batch {i // MAX_CONCURRENT + 1}/{(len(points_to_translate) - 1) // MAX_CONCURRENT + 1}")

        # Create translation tasks
        tasks = []
        for idx, point in batch.iterrows():
            task = get_translation(point["id"], point["comment"], int(point["rating"]), target_lang_name)
            tasks.append((point["id"], point["comment"], task))

        # Execute translations concurrently
        loop = asyncio.get_event_loop()
        results = loop.run_until_complete(asyncio.gather(*[task for _, _, task in tasks], return_exceptions=True))

        # Save results
        for (point_id, original_comment, _), result in zip(tasks, results):
            if isinstance(result, Exception):
                logging.error(f"Failed to translate point {point_id}: {result}")
                # Small delay after errors to avoid repeating
                time.sleep(1)
                continue

            if result == "< NA >":
                result = original_comment

            if result:
                is_original = original_comment.strip() == result.strip()
                translation_date = datetime.utcnow().isoformat()
                cursor.execute(
                    """INSERT OR REPLACE INTO comment_translations
                        (point_id, language, translated_comment, translation_date, is_original)
                        VALUES (?, ?, ?, ?, ?)""",
                    (point_id, target_lang_code, result, translation_date, is_original),
                )
                db_conn.commit()
                logging.info(f"Translated point {point_id} to {target_lang_code}")

# Step 3: Generate HTML report
print("\n=== Generating HTML report ===")

translations = pd.read_sql(
    """SELECT 
        t.point_id,
        p.country,
        p.rating,
        p.comment as original_comment,
        t.language,
        t.translated_comment,
        t.translation_date,
        t.is_original
    FROM comment_translations t
    JOIN points p ON t.point_id = p.id
    ORDER BY t.translation_date DESC, t.point_id, t.language
    """,
    db_conn,
)

print(f"Found {len(translations)} translations")

if len(translations) > 0:
    # Create clickable URLs
    translations["url"] = translations.apply(lambda row: f"https://hitchmap.com/#{row.point_id}", axis=1)

    # Format translation date
    translations["translation_date"] = pd.to_datetime(translations["translation_date"]).dt.strftime("%Y-%m-%d %H:%M")

    # Add is_original indicator
    translations["is_original"] = translations["is_original"].map({1: "Yes", 0: "No"})

    # Reorder columns for better readability
    output_cols = [
        "url",
        "country",
        "rating",
        "language",
        "is_original",
        "original_comment",
        "translated_comment",
        "translation_date",
    ]

    # Write to HTML
    output_path = os.path.join(root_dir, "dist", "translations.html")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    translations.loc[translations.language == "pl", output_cols].to_html(
        output_path, render_links=True, index=False, escape=False, classes="table table-striped", border=0
    )

    print(f"HTML report written to: {output_path}")

    # Generate summary by language
    summary = (
        translations.groupby("language")
        .agg({"point_id": "count", "translation_date": "max"})
        .rename(columns={"point_id": "total_translations", "translation_date": "last_updated"})
    )

    print("\n=== Translation Summary ===")
    print(summary)
else:
    print("No translations to export")

db_conn.close()
print("\n=== Translation complete ===")

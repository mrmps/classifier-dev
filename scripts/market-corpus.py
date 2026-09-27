#!/usr/bin/env python3
"""Load the Market persona corpus into Postgres.

Reads Nemotron-Personas-USA parquet shards (CC-BY-4.0, NVIDIA), renders each
row into a ~420-character panel text plus structured attributes, embeds the
text with OpenAI text-embedding-3-small at 512 dimensions through OpenRouter,
and bulk-inserts into market_personas. Resumable: rows whose id is already
present are skipped, so a crashed run restarts where it stopped.

Env: MARKET_DATABASE_URL_DIRECT (or DATABASE_URL), OPENROUTER_EMBED_KEY.
Usage: python3 market-corpus.py <shard.parquet> [<shard.parquet> ...]
"""
import json, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

import duckdb
import psycopg

DB = os.environ.get("MARKET_DATABASE_URL_DIRECT") or os.environ["DATABASE_URL"]
KEY = os.environ["OPENROUTER_EMBED_KEY"]
EMBED_URL = "https://openrouter.ai/api/v1/embeddings"
MODEL = "openai/text-embedding-3-small"
DIMS = 512
BATCH = 384          # texts per embedding request
WORKERS = 6          # concurrent embedding requests
ROWS_PER_SHARD = 1_000_000  # id space per shard; ids are shard_index * this + row

REGION = {  # census regions, for the segments table
    "Connecticut":"Northeast","Maine":"Northeast","Massachusetts":"Northeast","New Hampshire":"Northeast",
    "Rhode Island":"Northeast","Vermont":"Northeast","New Jersey":"Northeast","New York":"Northeast","Pennsylvania":"Northeast",
    "Illinois":"Midwest","Indiana":"Midwest","Michigan":"Midwest","Ohio":"Midwest","Wisconsin":"Midwest",
    "Iowa":"Midwest","Kansas":"Midwest","Minnesota":"Midwest","Missouri":"Midwest","Nebraska":"Midwest",
    "North Dakota":"Midwest","South Dakota":"Midwest",
    "Delaware":"South","Florida":"South","Georgia":"South","Maryland":"South","North Carolina":"South",
    "South Carolina":"South","Virginia":"South","District of Columbia":"South","West Virginia":"South",
    "Alabama":"South","Kentucky":"South","Mississippi":"South","Tennessee":"South",
    "Arkansas":"South","Louisiana":"South","Oklahoma":"South","Texas":"South",
    "Arizona":"West","Colorado":"West","Idaho":"West","Montana":"West","Nevada":"West",
    "New Mexico":"West","Utah":"West","Wyoming":"West","Alaska":"West","California":"West",
    "Hawaii":"West","Oregon":"West","Washington":"West",
}

def age_band(age):
    for lo, hi in ((18,24),(25,34),(35,44),(45,54),(55,64),(65,120)):
        if lo <= age <= hi:
            return f"{lo}-{hi}" if hi < 120 else "65+"
    return "under-18"

def clip_sentence(text, limit):
    """Trim at the last sentence boundary within limit; hard-cut as a fallback."""
    if not text or len(text) <= limit:
        return text or ""
    cut = text[:limit]
    dot = cut.rfind(". ")
    return cut[: dot + 1] if dot > limit // 2 else cut

MARITAL = {"married_present": "married", "married_absent": "married, spouse away",
           "never_married": "single", "divorced": "divorced", "widowed": "widowed", "separated": "separated"}

def humanize(value):
    return (value or "").replace("_", " ").strip()

def render(row):
    (persona, prof, sex, age, marital, edu, field, occ, city, state, hobbies) = row
    bits = [f"{age}-year-old {humanize(sex).lower()}, {MARITAL.get(marital, humanize(marital))}."]
    edu_txt = humanize(edu) or "unknown education"
    if field:
        edu_txt += f" in {humanize(field)}"
    bits.append(f"Occupation: {humanize(occ) or 'unknown'} ({edu_txt}).")
    bits.append(f"Lives in {city}, {state}.")
    bits.append(clip_sentence(prof or persona or "", 240))
    if hobbies:
        take = [h.strip() for h in hobbies[:3] if h and h.strip()]
        if take:
            bits.append("Interests: " + "; ".join(take) + ".")
    text = " ".join(b for b in bits if b)
    attrs = {
        "age": age, "age_band": age_band(age), "sex": humanize(sex).lower(),
        "marital": MARITAL.get(marital, humanize(marital)),
        "education": humanize(edu), "occupation": humanize(occ), "state": state,
        "region": REGION.get(state, "Other"),
    }
    return text, attrs

def embed(texts, tries=6):
    body = json.dumps({"model": MODEL, "input": texts, "dimensions": DIMS}).encode()
    for attempt in range(tries):
        req = urllib.request.Request(EMBED_URL, data=body, headers={
            "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)
            vecs = [d["embedding"] for d in sorted(data["data"], key=lambda d: d["index"])]
            if len(vecs) != len(texts) or any(len(v) != DIMS for v in vecs):
                raise ValueError("embedding response shape mismatch")
            return vecs
        except (urllib.error.HTTPError, urllib.error.URLError, ValueError, TimeoutError, OSError) as e:
            status = getattr(e, "code", None)
            if attempt == tries - 1:
                raise
            time.sleep(min(2 ** attempt + 1, 30) if status in (429, None) else 2)

def main(shards):
    with psycopg.connect(DB) as check:
        done = {r[0] for r in check.execute("SELECT id FROM market_personas").fetchall()}
    print(f"resume: {len(done)} rows already loaded", flush=True)

    conn = psycopg.connect(DB, autocommit=True)
    inserted = 0
    started = time.time()
    pool = ThreadPoolExecutor(max_workers=WORKERS)
    for si, shard in enumerate(shards):
        base = si * ROWS_PER_SHARD
        rel = duckdb.connect().execute(f"""
            SELECT persona, professional_persona, sex, age, marital_status,
                   education_level, bachelors_field, occupation, city, state,
                   hobbies_and_interests_list
            FROM read_parquet('{shard}')
            WHERE age >= 18
            {"LIMIT " + os.environ["MARKET_MAX_ROWS"] if os.environ.get("MARKET_MAX_ROWS") else ""}""")
        batch_rows, batch_ids, futures = [], [], []

        def flush(rows, ids):
            texts_attrs = [render(r) for r in rows]
            texts = [t for t, _ in texts_attrs]
            vecs = embed(texts)
            payload = [
                (pid, text, json.dumps(attrs), "[" + ",".join(f"{x:.5f}" for x in vec) + "]")
                for pid, (text, attrs), vec in zip(ids, texts_attrs, vecs)
            ]
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO market_personas (id, panel_text, attrs, embedding) "
                    "VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING", payload)
            return len(payload)

        row_index = 0
        while True:
            chunk = rel.fetchmany(BATCH)
            if not chunk:
                break
            ids = list(range(base + row_index, base + row_index + len(chunk)))
            row_index += len(chunk)
            keep = [(r, i) for r, i in zip(chunk, ids) if i not in done]
            if not keep:
                continue
            rows = [r for r, _ in keep]
            kept_ids = [i for _, i in keep]
            futures.append(pool.submit(flush, rows, kept_ids))
            if len(futures) >= WORKERS * 2:
                for f in futures:
                    inserted += f.result()
                futures = []
                rate = inserted / max(time.time() - started, 1)
                print(f"shard {si}: {row_index} read, {inserted} inserted total, {rate:.0f} rows/s", flush=True)
        for f in futures:
            inserted += f.result()
        print(f"shard {si} complete: {row_index} rows read", flush=True)
    pool.shutdown()
    print(f"DONE: {inserted} inserted in {time.time()-started:.0f}s", flush=True)

if __name__ == "__main__":
    main(sys.argv[1:])

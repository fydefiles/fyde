"""Private Cloud Run inference. IAM authenticates callers; no customer storage is mounted."""

import os
import threading

import torch
from flask import Flask, jsonify, request
from transformers import AutoConfig, AutoModel, AutoTokenizer

from spec import DIMENSIONS, FINGERPRINT, MAX_BATCH, MAX_TEXT_CHARS

torch.set_num_threads(int(os.environ.get("INFERENCE_THREADS", "2")))
model_path = os.environ.get("MODEL_PATH", "/opt/model")
config = AutoConfig.from_pretrained(model_path, local_files_only=True, vision_config=None, audio_config=None)
model = AutoModel.from_pretrained(
    model_path,
    config=config,
    local_files_only=True,
    trust_remote_code=False,
    dtype=torch.float32,
).eval()
tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True, trust_remote_code=False)
lock = threading.Lock()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 128 * 1024


@app.get("/health/")
def health():
    return jsonify(
        {
            "ready": True,
            "fingerprint": FINGERPRINT,
            "dimensions": DIMENSIONS,
            "modalities": ["text"],
            "revision": os.environ.get("RELEASE_SHA", "local"),
        }
    )


@app.post("/embed")
def embed():
    data = request.get_json(silent=True)
    if (
        not isinstance(data, dict)
        or not isinstance(data.get("task"), str)
        or data["task"] not in {"query", "document"}
    ):
        return jsonify({"error": "invalid_request"}), 400
    inputs = data.get("inputs")
    if (
        not isinstance(inputs, list)
        or not 1 <= len(inputs) <= MAX_BATCH
        or any(not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS for text in inputs)
    ):
        return jsonify({"error": "invalid_inputs"}), 400
    texts = [f"task: search result | query: {text}" for text in inputs] if data["task"] == "query" else inputs
    try:
        with lock, torch.inference_mode():
            batches = []
            for offset in range(len(texts)):
                tokens = tokenizer(
                    texts[offset : offset + 1], padding=True, truncation=False, return_tensors="pt"
                )
                if tokens["input_ids"].shape[1] > 8192:
                    return jsonify({"error": "input_too_long"}), 400
                hidden = model(**tokens).last_hidden_state
                mask = tokens["attention_mask"].unsqueeze(-1)
                # The model projects each token to 768d. Its published pooling config is mean + L2 normalization.
                pooled = (hidden * mask).sum(1) / mask.sum(1).clamp_min(1)
                batches.append(torch.nn.functional.normalize(pooled, p=2, dim=1))
            vectors = torch.cat(batches)
        if vectors.shape != (len(inputs), DIMENSIONS) or not torch.isfinite(vectors).all():
            raise ValueError("Invalid model output")
        return jsonify({"fingerprint": FINGERPRINT, "embeddings": vectors.tolist()})
    except Exception:
        # Do not log exception arguments, request bodies, extracted text, or query strings.
        app.logger.error("embedding_inference_failed")
        return jsonify({"error": "inference_failed"}), 503

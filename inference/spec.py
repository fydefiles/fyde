"""The embedding contract shared by the customer backend and inference image."""

MODEL_ID = "google/embeddinggemma-2"
MODEL_REVISION = "f9972ac22e696a105c482202646979e33e4b5a1e"
DIMENSIONS = 768
FINGERPRINT = f"{MODEL_ID}@{MODEL_REVISION}:768:search-v1"
MAX_BATCH = 8
MAX_TEXT_CHARS = 2200

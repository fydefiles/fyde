#!/usr/bin/env bash
# Run after billing/credits, required APIs, and a private Artifact Registry repository are configured.
set -euo pipefail
project=${GOOGLE_CLOUD_PROJECT:?Set the approved project}
account=${GCLOUD_ACCOUNT:?Set the approved Google account}
region=${GOOGLE_CLOUD_REGION:-us-central1}
revision=$(git rev-parse HEAD)
image="$region-docker.pkg.dev/$project/fyde-images/embeddinggemma2:$revision"
gcloud builds submit inference --config=inference/cloudbuild.yaml \
  --substitutions="_IMAGE=$image,_SOURCE_REVISION=$revision" \
  --project="$project" --account="$account" --quiet
gcloud run deploy fyde-embeddinggemma2 --image="$image" \
  --service-account="fyde-embedding-runtime@$project.iam.gserviceaccount.com" \
  --region="$region" --project="$project" --account="$account" \
  --no-allow-unauthenticated --cpu=2 --memory=4Gi --concurrency=1 \
  --min=0 --max=1 --timeout=180 --cpu-boost \
  --startup-probe='httpGet.path=/health/,periodSeconds=5,timeoutSeconds=2,failureThreshold=48' --quiet

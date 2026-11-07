import os
import re

import httpx
from django.conf import settings
from django.utils import timezone

from .policy import Blocked, emit, ensure_running


def github(method, path, **kwargs):
    token = os.environ.get("RELEASE_GITHUB_TOKEN", "")
    if not token:
        raise Blocked(
            "release_credentials_missing",
            "Configure a separate repository-scoped release GitHub App token. Builders never receive it.",
        )
    repo = os.environ.get("RELEASE_GITHUB_REPOSITORY", "")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        raise Blocked("release_repository_missing", "Set the exact release repository owner/name.")
    response = httpx.request(
        method,
        f"https://api.github.com/repos/{repo}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=20,
        **kwargs,
    )
    response.raise_for_status()
    return response.json() if response.content else {}


def open_release(release):
    ensure_running("release")
    work = release.work_item
    if work.data_mode != "live":
        raise Blocked("fixture_release_forbidden", "Fixture work cannot create a live PR or deployment.")
    if not settings.COMPANY_RELEASE_ENABLED:
        raise Blocked(
            "release_not_activated",
            "An operator must activate content-only development releases after configuring protected controls.",
        )
    if (
        work.status not in ("verified", "release_blocked", "pr_open")
        or not work.evidence.get("verification", {}).get("exit_code") == 0
    ):
        raise Blocked("unverified_artifact", "A matching independent verification result is required.")
    if work.evidence.get("gate", {}).get("allowed_paths") != ["content/help.json"]:
        raise Blocked("protected_change", "The artifact is outside the fixed release boundary.")
    base = github("GET", "/branches/dev")
    protection = base.get("protected")
    if not protection:
        raise Blocked(
            "branch_unprotected",
            "Protect dev with required trusted checks before enabling unattended releases.",
        )
    if base["commit"]["sha"] != release.previous_sha:
        raise Blocked(
            "stale_baseline", "Development moved; rebuild and independently verify on its new baseline."
        )
    # Transfer only the verified content blob through GitHub's API. No Git credentials enter a builder worktree.
    ref_name = work.branch
    try:
        github("GET", f"/git/ref/heads/{ref_name}")
    except httpx.HTTPStatusError as error:
        if error.response.status_code != 404:
            raise
        github("POST", "/git/refs", json={"ref": f"refs/heads/{ref_name}", "sha": release.previous_sha})
    import base64
    from pathlib import Path

    candidate = (Path(work.evidence["worktree"]) / "content/help.json").read_bytes()
    current = github("GET", "/contents/content/help.json", params={"ref": ref_name})
    updated = github(
        "PUT",
        "/contents/content/help.json",
        json={
            "message": f"Clarify help for feedback {work.pk}",
            "content": base64.b64encode(candidate).decode(),
            "sha": current["sha"],
            "branch": ref_name,
        },
    )
    remote_sha = updated["commit"]["sha"]
    prs = github(
        "GET",
        "/pulls",
        params={
            "state": "open",
            "head": f"{os.environ['RELEASE_GITHUB_REPOSITORY'].split('/')[0]}:{ref_name}",
            "base": "dev",
        },
    )
    pr = (
        prs[0]
        if prs
        else github(
            "POST",
            "/pulls",
            json={
                "title": work.title,
                "head": ref_name,
                "base": "dev",
                "body": f"Clarifies one existing help section for feedback {work.pk}.\n\nIndependent verifier: {work.evidence['verification']['image']}\nBaseline: {release.previous_sha}\n\nOnly content/help.json is eligible. No production promotion is authorized.",
            },
        )
    )
    work.pull_request_url, work.status = pr["html_url"], "pr_open"
    work.evidence = {**work.evidence, "remote_sha": remote_sha, "pr_number": pr["number"]}
    work.save()
    release.status = "pr_open"
    release.save(update_fields=["status"])
    return pr


def poll_release(release):
    ensure_running("release")
    work = release.work_item
    number = work.evidence.get("pr_number")
    if not number:
        open_release(release)
        return False
    pr = github("GET", f"/pulls/{number}")
    if not pr.get("merged"):
        # Required-check policy is enforced again by GitHub. This controller never bypasses reviews.
        checks = github("GET", f"/commits/{pr['head']['sha']}/check-runs")
        required = {"integration", "release-boundary"}
        passing = {c["name"] for c in checks.get("check_runs", []) if c.get("conclusion") == "success"}
        if not required.issubset(passing):
            return False
        if pr["head"]["sha"] != work.evidence.get("remote_sha"):
            raise Blocked("release_head_changed", "The PR head changed after verification.")
        files = github("GET", f"/pulls/{number}/files")
        if len(files) != 1 or files[0]["filename"] != "content/help.json" or files[0]["status"] != "modified":
            raise Blocked("protected_change", "The remote PR contains a protected change.")
        # GitHub rejects this when required reviews/checks are missing. No admin bypass is used.
        result = github(
            "PUT", f"/pulls/{number}/merge", json={"sha": pr["head"]["sha"], "merge_method": "squash"}
        )
        if not result.get("merged"):
            return False
        return False
    merge_sha = pr["merge_commit_sha"]
    deployments = github("GET", "/deployments", params={"sha": merge_sha, "environment": "development"})
    if not deployments:
        raise Blocked(
            "deployment_evidence_missing", "The dev merge has no matching development deployment evidence."
        )
    deployment = deployments[0]
    statuses = github("GET", f"/deployments/{deployment['id']}/statuses")
    if not statuses or statuses[0].get("state") != "success":
        return False
    url = statuses[0].get("environment_url", "")
    expected = os.environ.get("DEVELOPMENT_APP_URL", "").rstrip("/")
    if not expected.startswith("https://") or url.rstrip("/") != expected:
        raise Blocked(
            "deployment_url_mismatch",
            "The deployment URL must match the operator's configured development origin.",
        )
    result = httpx.get(expected + "/health/", timeout=15, follow_redirects=False).json()
    help_result = httpx.get(expected + "/help/", timeout=15, follow_redirects=False)
    if result.get("revision") != merge_sha or not help_result.is_success:
        release.status = "regression_detected"
        release.save(update_fields=["status"])
        raise Blocked(
            "deployment_smoke_failed",
            "The deployment identity or help-page smoke check failed. Use the fixed rollback runbook.",
        )
    release.status, release.deployed_at, release.deployed_url, release.deployment_id = (
        "deployed",
        timezone.now(),
        expected,
        str(deployment["id"]),
    )
    release.save()
    work.status = "deployed"
    work.save(update_fields=["status"])
    emit(
        "release.deployed",
        f"release-deployed/{release.pk}",
        mode=work.data_mode,
        payload={
            "work_id": str(work.pk),
            "release_id": str(release.pk),
            "commit": merge_sha,
            "url": expected,
        },
    )
    return True

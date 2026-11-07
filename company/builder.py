import copy
import hashlib
import json
import os
import subprocess
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from .models import Release
from .naive import build_content
from .policy import Blocked, emit, ensure_running, validate_help_patch


def git(*args, cwd=None):
    # Trusted controller supplies every command argument. Feedback can never become shell input.
    result = subprocess.run(
        ["git", *args],
        cwd=cwd or settings.COMPANY_SOURCE_ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        env={"PATH": os.environ.get("PATH", os.defpath), "GIT_TERMINAL_PROMPT": "0"},
    )
    if result.returncode:
        raise Blocked(
            "git_operation_failed", "The isolated source operation failed. Inspect the operator runbook."
        )
    return result.stdout.strip()


def verify_in_sandbox(candidate_path, baseline_sha):
    image = os.environ.get("COMPANY_VERIFIER_IMAGE", "")
    if not image:
        raise Blocked(
            "verifier_not_configured",
            "Build a trusted verifier image for this source revision and set COMPANY_VERIFIER_IMAGE to its immutable digest.",
        )
    if "@sha256:" not in image and not image.startswith("sha256:"):
        raise Blocked(
            "mutable_verifier", "The independent verifier must use an immutable Docker image digest."
        )
    inspection = subprocess.run(
        [
            "docker",
            "image",
            "inspect",
            image,
            "--format",
            '{{index .Config.Labels "org.opencontainers.image.revision"}}',
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if inspection.returncode or inspection.stdout.strip() != baseline_sha:
        raise Blocked(
            "verifier_revision_mismatch", "The trusted verifier image must match the exact baseline commit."
        )
    command = [
        "docker",
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "128",
        "--memory",
        "768m",
        "--cpus",
        "1",
        "--user",
        "10001:10001",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=256m,mode=1777",
        "-e",
        "FYDE_VAR_DIR=/tmp/fyde-verification",
        "-e",
        "DJANGO_DEBUG=1",
        "-e",
        "EMAIL_ADAPTER=local",
        "-v",
        f"{candidate_path.resolve()}:/app/content/help.json:ro",
        image,
        "python",
        "manage.py",
        "test",
        "tests",
        "--noinput",
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=180,
            env={"PATH": os.environ.get("PATH", os.defpath)},
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked(
            "verification_failed", "Independent verification did not finish within its resource limits."
        ) from None
    evidence = {
        "engine": "docker",
        "image": image,
        "baseline_sha": baseline_sha,
        "command": "python manage.py test tests --noinput",
        "exit_code": result.returncode,
        "log_sha256": hashlib.sha256((result.stdout + result.stderr).encode()).hexdigest(),
        "summary": (result.stdout + result.stderr)[-2000:],
        "network": "none",
        "customer_data_mounted": False,
        "verified_at": timezone.now().isoformat(),
    }
    if result.returncode:
        raise Blocked(
            "verification_failed",
            "The independent trusted application checks failed. No release is eligible.",
        )
    return evidence


def build(work):
    ensure_running("development")
    if work.risk != "low_content":
        raise Blocked("protected_work", "This work is outside automatic release authority.")
    if work.status in ("verified", "release_blocked", "pr_open", "deployed"):
        return True
    source = Path(settings.COMPANY_SOURCE_ROOT)
    baseline = json.loads((source / "content/help.json").read_text())
    fixture = (
        work.data_mode == "fixture" and settings.DEBUG and os.environ.get("COMPANY_FIXTURE_BUILDER") == "1"
    )
    if fixture:
        candidate = copy.deepcopy(baseline)
        proposal = work.specification.get("fixture_proposal", {})
        for section in candidate["sections"]:
            if section["id"] == proposal.get("section_id"):
                section["title"], section["body"] = proposal.get("title", ""), proposal.get("body", "")
    else:
        candidate = build_content(work, baseline)
        if candidate is None:
            return False
    gate = validate_help_patch(baseline, candidate)
    base_sha = git("rev-parse", "HEAD", cwd=source)
    tracked = git("status", "--porcelain", "--untracked-files=no", cwd=source)
    if tracked:
        raise Blocked("source_dirty", "The controller requires a clean committed source baseline.")
    branch = f"codex/company/{work.pk}"
    folder = settings.COMPANY_WORK_ROOT / str(work.pk)
    folder.parent.mkdir(parents=True, exist_ok=True)
    if folder.exists():
        # A crashed build can reuse only its own exact worktree. Never remove an unrelated checkout.
        if git("branch", "--show-current", cwd=folder) != branch:
            raise Blocked("worktree_conflict", "The work directory is not owned by this work item.")
    else:
        git("worktree", "add", "-b", branch, str(folder), base_sha, cwd=source)
    (folder / "content/help.json").write_text(json.dumps(candidate, indent=2) + "\n")
    diff_paths = git("diff", "--name-only", cwd=folder).splitlines()
    if diff_paths != ["content/help.json"]:
        raise Blocked(
            "protected_change",
            "The isolated diff changes a protected path or contains no useful improvement.",
        )
    verification = verify_in_sandbox(folder / "content/help.json", base_sha)
    git("add", "--", "content/help.json", cwd=folder)
    git(
        "-c",
        "user.name=Fyde content builder",
        "-c",
        "user.email=fyde-bot@users.noreply.github.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        f"Clarify help for feedback {work.pk}",
        cwd=folder,
    )
    commit = git("rev-parse", "HEAD", cwd=folder)
    work.branch, work.commit_sha, work.status = branch, commit, "verified"
    work.evidence = {
        "gate": gate,
        "verification": verification,
        "baseline_sha": base_sha,
        "worktree": str(folder),
        "provider": "local_fixture" if fixture else "naive",
        "session_id": work.session_id or None,
    }
    work.save()
    release, _ = Release.objects.get_or_create(
        work_item=work,
        artifact_sha=commit,
        defaults={"previous_sha": base_sha, "verification": verification, "data_mode": work.data_mode},
    )
    emit(
        "build.completed",
        f"build-complete/{work.pk}/{commit}",
        mode=work.data_mode,
        payload={"work_item_id": str(work.pk), "commit": commit, "release_id": str(release.pk)},
    )
    # Only the separate release credential can publish or merge. The builder has no such capability.
    from .feedback import enqueue

    enqueue("release", f"release/{release.pk}", {"release_id": str(release.pk)}, work.data_mode)
    return True

#!/usr/bin/env python3
"""A real recipient-agent client for Fyde's scoped customer protocol. No owner session is used."""

import argparse
import hashlib
import json
import os
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class SameOriginRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = urlsplit(req.full_url), urlsplit(newurl)
        if (old.scheme, old.netloc) != (new.scheme, new.netloc):
            raise ValueError(
                "Refusing a redirect that could disclose the agent credential to another origin."
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--types", default="*", help="Comma-separated document types, or * for permitted types"
    )
    parser.add_argument("--query", default="")
    parser.add_argument(
        "--operation-id", default=None, help="Reuse this UUID to resume the same request safely"
    )
    parser.add_argument("--allow-http-local", action="store_true")
    args = parser.parse_args()
    origin = args.server.rstrip("/")
    url = urlsplit(origin)
    local = args.allow_http_local and url.hostname in (
        "127.0.0.1",
        "localhost",
        "::1",
        "host.docker.internal",
    )
    if url.scheme != "https" and not (url.scheme == "http" and local):
        parser.error("Use HTTPS. Plain HTTP is allowed only for explicit localhost fixture runs.")
    if url.username or url.password or url.query or url.fragment or url.path:
        parser.error("Supply only the server origin, without credentials or a path.")
    token = os.environ.get("FYDE_CASE_AGENT_TOKEN", "")
    if not token.startswith("fyde_agent_"):
        parser.error(
            "Set FYDE_CASE_AGENT_TOKEN in this process environment from the recipient agent secret store."
        )
    opener = build_opener(SameOriginRedirect())

    def call(path, data=None):
        if not path.startswith("/api/agents/v1/") or "://" in path:
            raise ValueError("The server returned an invalid agent download path.")
        request = Request(
            origin + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={
                "Authorization": f"Bearer {token}",
                **({"Content-Type": "application/json"} if data is not None else {}),
            },
        )
        return opener.open(request, timeout=30)

    with call("/api/agents/v1/permissions/") as response:
        permission = json.load(response)["permission"]
    base = uuid.UUID(args.operation_id) if args.operation_id else uuid.uuid4()
    args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
    print(f"Mode: {permission['data_mode']}; request operation: {base}")
    cursor = ""
    count = 0
    for _ in range(100):
        payload = {
            "operation_id": str(uuid.uuid5(base, cursor or "first")),
            "types": args.types.split(","),
            "query": args.query,
            "after": cursor,
        }
        with call("/api/agents/v1/requests/", payload) as response:
            result = json.load(response)
        for file in result["files"]:
            identifier = str(uuid.UUID(file["id"]))
            destination = args.output / (identifier + "-" + Path(file["name"].replace("\\", "/")).name)
            if (
                destination.exists()
                and hashlib.sha256(destination.read_bytes()).hexdigest() == file["sha256"]
            ):
                count += 1
                continue
            temporary = destination.with_suffix(destination.suffix + ".part")
            digest = hashlib.sha256()
            try:
                with call(file["download_url"]) as response, temporary.open("wb") as target:
                    temporary.chmod(0o600)
                    while chunk := response.read(65536):
                        digest.update(chunk)
                        target.write(chunk)
                if digest.hexdigest() != file["sha256"]:
                    raise ValueError("Received bytes do not match the authorized immutable version.")
                temporary.replace(destination)
                count += 1
            finally:
                temporary.unlink(missing_ok=True)
        failures = [item["state"] for item in result["outcomes"] if "transfer_id" not in item]
        if failures:
            print(
                f"Downloaded and hash-verified {count} files; remaining actions blocked: {', '.join(failures)}"
            )
            return 2
        cursor = result.get("next_cursor")
        if not cursor:
            print(
                f"Downloaded and SHA-256 verified {count} permitted files. No owner approval or owner credential was used."
            )
            return 0
    raise ValueError("Stopped at the client safety limit of 100 pages; resume with the same operation ID.")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Provider exceptions can contain URLs. Do not print credentials or response bodies.
        print(
            f"Request blocked: {type(error).__name__}. Check the permission, connection and request limits.",
            file=sys.stderr,
        )
        sys.exit(1)

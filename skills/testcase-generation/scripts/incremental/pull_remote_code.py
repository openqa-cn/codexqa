#!/usr/bin/env python3
"""Fetch a PR/MR or a custom git remote into `{run_dir}/testcase/.pr-cache/`.

This script only materializes a local worktree and two full SHAs. It does not
archive, classify Incremental, or write cases. Agent must still call
`freeze_inputs.py` with those SHAs.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from urllib.request import Request, urlopen


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from inc_common import (  # noqa: E402
    SkillError,
    ensure_within,
    print_error,
    print_result,
    resolve_run_context,
)


PR_REF_CANDIDATES = (
    "refs/pull/{n}/head",
    "refs/pull-requests/{n}/head",
    "refs/merge-requests/{n}/head",
    "refs/pr/{n}/head",
    "pull/{n}/head",
    "merge-requests/{n}/head",
)
PR_REF_GLOBS = (
    "refs/merge-requests/{n}/*",
    "refs/pull/{n}/*",
    "refs/pull-requests/{n}/*",
    "refs/pr/{n}/*",
)
DEFAULT_BRANCH_CANDIDATES = ("main", "master", "develop")
CACHE_REL = Path("testcase") / ".pr-cache"
GIT_NETWORK_TIMEOUT = 20
_UNSAFE_URL = re.compile(r"\s|\.\.")
GIT_SCP_RE = re.compile(
    r"^git@(?P<host>[A-Za-z0-9.-]+):(?P<path>[A-Za-z0-9._~+/=@,-]+?)(?:\.git)?/?$"
)
SSH_URL_RE = re.compile(
    r"^ssh://git@(?P<host>[A-Za-z0-9.-]+)(?::\d+)?/(?P<path>[A-Za-z0-9._~+/=@,-]+?)(?:\.git)?/?$"
)
_PR_PATH = re.compile(
    r"^(?P<proj>.+?)/(?:"
    r"(?:-/)?merge[-_]?requests|"
    r"pull[-_]?requests?|"
    r"pulls?|"
    r"prs?"
    r")/(?P<num>\d+)(?:/.*)?$",
    re.IGNORECASE,
)
_CODE_UI_PR_PATH = re.compile(
    r"^code/repo-detail/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pr/(?P<num>\d+)(?:/.*)?$",
    re.IGNORECASE,
)
_PERMISSION_MARKERS = (
    "authentication failed",
    "permission denied",
    "could not read username",
    "access denied",
    "not authorized",
    "authorization required",
    "http basic: access denied",
    "403 forbidden",
    "401 unauthorized",
    "could not read from remote repository",
    "repository not found",
    "the requested url returned error: 403",
    "the requested url returned error: 401",
    "fatal: could not read username",
    "invalid credentials",
    "terminal prompts disabled",
    "access to this project is denied",
    "you don't have permission",
    "do not have permission",
    "unable to update url base from redirection",
    "无法更新重定向后的 url 基址",
    "redirected to",
    "重定向",
)


def _split_git_ref(raw: str) -> tuple[str, str]:
    text = raw.strip().strip("<>`'\"")
    if " #" in text:
        url, ref = text.rsplit(" #", 1)
        return url.strip(), ref.strip()
    if text.count("#") == 1 and not text.startswith("#"):
        url, ref = text.split("#", 1)
        if "://" in url or url.startswith("git@"):
            return url.strip(), ref.strip()
    return text, ""


def _reject_embedded_credentials(value: str) -> None:
    if "://" not in value:
        return
    parsed = urlparse(value)
    if parsed.password:
        raise SkillError("PR_URL_CREDENTIALS", "Repository URL must not embed a username or password")
    if parsed.username and parsed.username != "git":
        raise SkillError("PR_URL_CREDENTIALS", "Repository URL must not embed a username or password")
    if parsed.username == "git" and parsed.scheme.lower() != "ssh":
        raise SkillError("PR_URL_CREDENTIALS", "Repository URL must not embed a username or password")


def _normalize_raw(raw: str) -> str:
    value = raw.strip()
    if not value:
        raise SkillError("PR_URL_EMPTY", "--pr-url cannot be empty")
    if _UNSAFE_URL.search(value) or "\x00" in value:
        raise SkillError("PR_URL_UNSAFE", "Repository URL contains whitespace, `..`, or illegal characters")
    _reject_embedded_credentials(value)
    return value


def _repo_name(path: str) -> tuple[str, str]:
    parts = [p for p in path.strip("/").split("/") if p]
    if not parts:
        raise SkillError("PR_URL_UNSUPPORTED", "Cannot parse a path from the repository URL")
    repo = parts[-1][:-4] if parts[-1].endswith(".git") else parts[-1]
    owner = "/".join(parts[:-1]) if len(parts) > 1 else "_"
    if not repo:
        raise SkillError("PR_URL_UNSUPPORTED", "Cannot parse a repository name from the URL")
    return owner, repo


def _https_git_url(host: str, project: str) -> str:
    project = project.strip("/")
    if project.endswith(".git"):
        return f"https://{host}/{project}"
    return f"https://{host}/{project}.git"


def _ssh_git_url(host: str, project: str) -> str:
    project = project.strip("/")
    if project.endswith(".git"):
        project = project[:-4]
    return f"ssh://git@{host}/{project}.git"


def _git_host_from_ui(host: str) -> str:
    if host.startswith("dev."):
        return "git." + host[4:]
    return host


def _unique_urls(*urls: str) -> List[str]:
    seen: List[str] = []
    for url in urls:
        if url and url not in seen:
            seen.append(url)
    return seen


def _source_payload(
    *,
    family: str,
    host: str,
    owner: str,
    repo: str,
    number: Optional[int],
    git_url: str,
    head_ref: str,
    api_kind: Optional[str],
    candidates: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return {
        "family": family,
        "host": host,
        "owner": owner,
        "repo": repo,
        "number": number,
        "gitUrl": git_url,
        "gitUrlCandidates": _unique_urls(*(candidates or []), git_url),
        "headRef": head_ref,
        "apiKind": api_kind,
    }


def _git_remote_payload(
    *,
    host: str,
    path: str,
    git_url: str,
    head_ref: str,
) -> Dict[str, Any]:
    owner, repo = _repo_name(path)
    return _source_payload(
        family="git",
        host=host,
        owner=owner,
        repo=repo,
        number=None,
        git_url=git_url,
        head_ref=head_ref or "HEAD",
        api_kind=None,
        candidates=[git_url],
    )


def _code_ui_payload(host: str, owner: str, repo: str, number: int) -> Dict[str, Any]:
    git_host = _git_host_from_ui(host)
    project = f"{owner}/{repo}"
    https_url = _https_git_url(git_host, project)
    ssh_url = _ssh_git_url(git_host, project)
    return _source_payload(
        family="code-ui",
        host=git_host,
        owner=owner,
        repo=repo,
        number=number,
        git_url=https_url,
        head_ref=f"refs/pull/{number}/head",
        api_kind=None,
        candidates=[https_url, ssh_url],
    )


def parse_source_url(raw: str) -> Dict[str, Any]:
    stripped, inline_ref = _split_git_ref(raw)
    value = _normalize_raw(stripped)

    scp = GIT_SCP_RE.match(value)
    if scp:
        git_url = value if value.endswith(".git") else f"{value.rstrip('/')}.git"
        return _git_remote_payload(
            host=scp.group("host"),
            path=scp.group("path"),
            git_url=git_url,
            head_ref=inline_ref,
        )

    ssh = SSH_URL_RE.match(value)
    if ssh:
        return _git_remote_payload(
            host=ssh.group("host"),
            path=ssh.group("path"),
            git_url=value,
            head_ref=inline_ref,
        )

    parsed = urlparse(value)
    scheme = (parsed.scheme or "").lower()
    if scheme == "ssh":
        raise SkillError("PR_URL_UNSUPPORTED", "Only ssh://git@host[:port]/path is supported")
    if scheme != "https":
        raise SkillError(
            "PR_URL_UNSUPPORTED",
            "Only https://, git@host:path, or ssh://git@host/path is supported",
        )
    if parsed.query or parsed.fragment:
        raise SkillError("PR_URL_UNSUPPORTED", "Repository URL must not include a query or fragment")
    if not parsed.hostname or not parsed.path or parsed.path == "/":
        raise SkillError("PR_URL_UNSUPPORTED", "Repository URL is missing a host or path")

    host = parsed.hostname.lower()
    path = parsed.path.rstrip("/")
    code_ui = _CODE_UI_PR_PATH.match(path.lstrip("/"))
    if code_ui:
        if inline_ref:
            raise SkillError("PR_URL_UNSUPPORTED", "A PR/MR URL cannot also include #ref")
        return _code_ui_payload(
            host,
            code_ui.group("owner"),
            code_ui.group("repo"),
            int(code_ui.group("num")),
        )
    match = _PR_PATH.match(path.lstrip("/"))
    if match:
        if inline_ref:
            raise SkillError("PR_URL_UNSUPPORTED", "A PR/MR URL cannot also include #ref")
        owner, repo = _repo_name(match.group("proj"))
        number = int(match.group("num"))
        gitlab_style = "/-/" in path or "merge_request" in path.lower()
        family = "gitlab" if gitlab_style else "github"
        git_url = _https_git_url(host, match.group("proj"))
        return _source_payload(
            family=family,
            host=host,
            owner=owner,
            repo=repo,
            number=number,
            git_url=git_url,
            head_ref=f"refs/pull/{number}/head",
            api_kind=family,
            candidates=[git_url],
        )

    return _git_remote_payload(
        host=host,
        path=path.lstrip("/"),
        git_url=_https_git_url(host, path.lstrip("/")),
        head_ref=inline_ref,
    )


def _safe_seg(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._") or "_"
    return cleaned[:80]


def _repository_id(parsed: Dict[str, Any]) -> str:
    return "__".join(
        [
            _safe_seg(parsed["host"]),
            _safe_seg(parsed["owner"].replace("/", "__")),
            _safe_seg(parsed["repo"]),
        ]
    )


def _cache_repo_dir(cache_root: Path, parsed: Dict[str, Any]) -> Path:
    return (
        cache_root
        / _safe_seg(parsed["host"])
        / _safe_seg(parsed["owner"].replace("/", "__"))
        / _safe_seg(parsed["repo"])
    )


def _is_permission_error(stderr: str) -> bool:
    text = (stderr or "").lower()
    return any(marker in text for marker in _PERMISSION_MARKERS)


def _git_fail(code: str, action: str, stderr: str) -> SkillError:
    detail = (stderr or "").strip()
    if _is_permission_error(detail):
        return SkillError(
            "PR_PERMISSION_DENIED",
            f"Permission denied; cannot {action} this repository. Check local Git credentials, or provide a local repo path (optional --head-sha / --head-ref).",
            {"stderr": detail[-400:]},
        )
    suffix = f": {detail[:400]}" if detail else ""
    return SkillError(code, f"{action} failed{suffix}", {"stderr": detail[-400:]})


def _run_git(
    args: List[str],
    cwd: Optional[Path] = None,
    timeout: int = GIT_NETWORK_TIMEOUT,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    cmd = ["git", *args]
    try:
        return subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            env=env,
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout
        stderr = exc.stderr
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", "replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", "replace")
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=124,
            stdout=stdout or "",
            stderr=((stderr or "") + "\ngit command timed out").strip(),
        )


def _rmtree_if_exists(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)


def _bind_source_remote(repo_dir: Path, git_url: str) -> None:
    add = _run_git(["remote", "add", "source", git_url], cwd=repo_dir)
    if add.returncode != 0:
        set_url = _run_git(["remote", "set-url", "source", git_url], cwd=repo_dir)
        if set_url.returncode != 0:
            raise _git_fail("PR_REMOTE_FAILED", "write source remote", set_url.stderr)


def _origin_is_local_repo(origin: str, local_repo: Path) -> bool:
    if not origin:
        return False
    if origin == str(local_repo):
        return True
    try:
        return Path(origin).expanduser().resolve() == local_repo.resolve()
    except OSError:
        return False


def _ensure_worktree(
    repo_dir: Path,
    git_urls: List[str],
    local_repo: Optional[Path],
) -> str:
    if not git_urls:
        raise SkillError("PR_URL_UNSUPPORTED", "No git remote available to clone")
    primary = git_urls[0]
    git_dir = repo_dir / ".git"
    if git_dir.exists():
        remote = _run_git(["remote", "get-url", "origin"], cwd=repo_dir)
        origin = remote.stdout.strip() if remote.returncode == 0 else ""
        if local_repo is not None and _origin_is_local_repo(origin, local_repo):
            return primary
        if origin in git_urls:
            return origin
        raise SkillError(
            "PR_CACHE_CONFLICT",
            f"Cache directory already exists and origin is not {primary}",
            {"cacheDir": str(repo_dir)},
        )

    repo_dir.parent.mkdir(parents=True, exist_ok=True)
    if local_repo is not None:
        clone = _run_git(
            ["clone", "--no-checkout", "--origin", "origin", str(local_repo), str(repo_dir)]
        )
        if clone.returncode != 0:
            raise _git_fail("PR_CLONE_FAILED", "clone from --local-repo", clone.stderr)
        return primary

    last_stderr = ""
    all_permission = True
    for url in git_urls:
        _rmtree_if_exists(repo_dir)
        clone = _run_git(["clone", "--no-checkout", url, str(repo_dir)])
        last_stderr = clone.stderr or ""
        if clone.returncode == 0:
            _bind_source_remote(repo_dir, url)
            return url
        all_permission = all_permission and _is_permission_error(last_stderr)
        _rmtree_if_exists(repo_dir)

    if all_permission:
        raise _git_fail("PR_CLONE_FAILED", "clone", last_stderr)
    raise _git_fail("PR_CLONE_FAILED", "clone", last_stderr)


def _parse_ls_remote(stdout: str, ref: str) -> Optional[str]:
    for line in stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] in {ref, "HEAD"}:
            return parts[0]
    return None


def _ls_remote(
    repo_dir: Path,
    remote: str,
    ref: str,
    fallback_remote: Optional[str] = None,
) -> Optional[str]:
    result = _run_git(["ls-remote", remote, ref], cwd=repo_dir)
    if result.returncode == 0:
        return _parse_ls_remote(result.stdout, ref)
    if fallback_remote:
        fallback = _run_git(["ls-remote", fallback_remote, ref], cwd=repo_dir)
        if fallback.returncode == 0:
            return _parse_ls_remote(fallback.stdout, ref)
    if _is_permission_error(result.stderr):
        raise _git_fail("PR_LSREMOTE_FAILED", f"read {ref}", result.stderr)
    return None


def _local_commit(repo_dir: Path, rev: str) -> Optional[str]:
    result = _run_git(["rev-parse", "--verify", f"{rev}^{{commit}}"], cwd=repo_dir)
    sha = (result.stdout or "").strip()
    if result.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40}", sha):
        return None
    return sha


def _head_ref_aliases(head_ref: str) -> List[str]:
    refs = [head_ref]
    name = head_ref
    if name.startswith("refs/remotes/origin/"):
        name = name[len("refs/remotes/origin/") :]
    elif name.startswith("refs/heads/"):
        name = name[len("refs/heads/") :]
    elif name.startswith("origin/"):
        name = name[len("origin/") :]
    if name:
        refs.extend(
            [
                name,
                f"origin/{name}",
                f"refs/heads/{name}",
                f"refs/remotes/origin/{name}",
            ]
        )
    return _unique_urls(*refs)


def _update_ref(repo_dir: Path, name: str, sha: str) -> bool:
    result = _run_git(["update-ref", name, sha], cwd=repo_dir)
    return result.returncode == 0


def _fetch_ref(
    repo_dir: Path,
    remote: str,
    ref: str,
    local_name: str,
    fallback_remote: Optional[str] = None,
) -> None:
    for alias in _head_ref_aliases(ref):
        sha = _local_commit(repo_dir, alias)
        if sha and _update_ref(repo_dir, local_name, sha):
            return
    result = _run_git(["fetch", "--no-tags", remote, f"{ref}:{local_name}"], cwd=repo_dir)
    if result.returncode == 0:
        return
    if fallback_remote:
        fallback = _run_git(
            ["fetch", "--no-tags", fallback_remote, f"{ref}:{local_name}"],
            cwd=repo_dir,
        )
        if fallback.returncode == 0:
            return
    raise _git_fail("PR_FETCH_FAILED", f"fetch {ref}", result.stderr)


def _rev_parse(repo_dir: Path, rev: str) -> str:
    result = _run_git(["rev-parse", "--verify", rev], cwd=repo_dir)
    if result.returncode != 0 or not result.stdout.strip():
        raise SkillError("PR_SHA_UNRESOLVED", f"Cannot resolve {rev}")
    sha = result.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise SkillError("PR_SHA_NOT_FULL", f"{rev} is not a full 40-character SHA: {sha}")
    return sha


def _default_branch(repo_dir: Path, remote: str) -> Optional[str]:
    result = _run_git(["symbolic-ref", "--quiet", f"refs/remotes/{remote}/HEAD"], cwd=repo_dir)
    if result.returncode == 0:
        ref = result.stdout.strip()
        prefix = f"refs/remotes/{remote}/"
        if ref.startswith(prefix):
            return ref[len(prefix) :]
    for name in DEFAULT_BRANCH_CANDIDATES:
        probe = _run_git(["rev-parse", "--verify", f"{remote}/{name}"], cwd=repo_dir)
        if probe.returncode == 0:
            return name
    return None


def _api_base_sha(parsed: Dict[str, Any]) -> Optional[str]:
    if parsed.get("number") is None:
        return None
    host = parsed["host"]
    owner = parsed["owner"]
    repo = parsed["repo"]
    number = parsed["number"]
    try:
        if parsed.get("apiKind") == "github":
            url = f"https://{host}/api/v3/repos/{owner}/{repo}/pulls/{number}"
            if host in {"github.com", "www.github.com"}:
                url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{number}"
        elif parsed.get("apiKind") == "gitlab":
            project = f"{owner}/{repo}".replace("/", "%2F")
            url = f"https://{host}/api/v4/projects/{project}/merge_requests/{number}"
        else:
            return None
        req = Request(url, headers={"Accept": "application/json", "User-Agent": "testcase-generation"})
        with urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if parsed.get("apiKind") == "github":
            sha = ((data.get("base") or {}).get("sha") or "").strip()
        else:
            sha = (data.get("diff_refs") or {}).get("base_sha") or ""
            sha = str(sha).strip()
        if re.fullmatch(r"[0-9a-f]{40}", sha):
            return sha
    except Exception:
        return None
    return None


def _probe_remotes(
    repo_dir: Path,
    primary: str,
    fallback: Optional[str],
) -> List[str]:
    listed = _run_git(["remote"], cwd=repo_dir)
    have = {line.strip() for line in (listed.stdout or "").splitlines() if line.strip()}
    remotes: List[str] = []
    for name in (primary, fallback, "origin", "source"):
        if name and name in have and name not in remotes:
            remotes.append(name)
    if not remotes and primary:
        remotes.append(primary)
    return remotes


def _discover_pr_ref(repo_dir: Path, number: int, remotes: List[str]) -> Optional[str]:
    for remote in remotes:
        for glob in (pattern.format(n=number) for pattern in PR_REF_GLOBS):
            result = _run_git(["ls-remote", remote, glob], cwd=repo_dir)
            if result.returncode != 0:
                if _is_permission_error(result.stderr):
                    raise _git_fail("PR_LSREMOTE_FAILED", f"read {glob}", result.stderr)
                continue
            heads: List[str] = []
            others: List[str] = []
            for line in result.stdout.splitlines():
                parts = line.split()
                if len(parts) < 2:
                    continue
                ref = parts[1]
                (heads if ref.endswith("/head") else others).append(ref)
            if heads:
                return heads[0]
            if others:
                return others[0]
    return None


def _resolve_head_ref(
    repo_dir: Path,
    parsed: Dict[str, Any],
    head_ref: str,
    fallback_remote: Optional[str] = None,
    primary_remote: str = "origin",
) -> str:
    remotes = _probe_remotes(repo_dir, primary_remote, fallback_remote)
    first_remote = remotes[0]
    extra_remote = remotes[1] if len(remotes) > 1 else None
    local_candidates = _head_ref_aliases(head_ref)
    if parsed.get("number") is not None:
        number = parsed["number"]
        local_candidates.extend(pattern.format(n=number) for pattern in PR_REF_CANDIDATES)
    for candidate in _unique_urls(*local_candidates):
        if _local_commit(repo_dir, candidate):
            return candidate
    if parsed.get("number") is None:
        if head_ref == "HEAD" or _ls_remote(repo_dir, first_remote, head_ref, extra_remote):
            return head_ref
        raise SkillError(
            "PR_HEAD_REF_MISSING",
            f"Remote does not have {head_ref}; use --head-sha / --head-ref or check the repository URL",
        )
    number = parsed["number"]
    seen: List[str] = []
    for candidate in (head_ref, *local_candidates, *(pattern.format(n=number) for pattern in PR_REF_CANDIDATES)):
        if candidate in seen:
            continue
        seen.append(candidate)
        if _ls_remote(repo_dir, first_remote, candidate, extra_remote):
            return candidate
    discovered = _discover_pr_ref(repo_dir, number, remotes)
    if discovered:
        return discovered
    raise SkillError(
        "PR_HEAD_REF_MISSING",
        f"Cannot find the head ref for PR/MR {number}. Code UI remotes usually do not publish refs/pull/{{n}}/head; pass --head-sha, --head-ref, or a branch that already exists in the local repo",
    )


def _resolve_cache_root(run_dir: Path, cache_dir: Optional[Path]) -> Path:
    pr_cache = run_dir / CACHE_REL
    pr_cache.mkdir(parents=True, exist_ok=True)
    if cache_dir is None:
        return pr_cache
    raw = cache_dir.expanduser()
    if not raw.is_absolute():
        raise SkillError("ABSOLUTE_PATH_REQUIRED", "--cache-dir must be an absolute path")
    try:
        return ensure_within(raw, pr_cache)
    except SkillError as exc:
        raise SkillError(
            "CACHE_DIR_OUTSIDE_PR_CACHE",
            "--cache-dir must be under {runDir}/testcase/.pr-cache",
            {"path": str(raw), "prCache": str(pr_cache)},
        ) from exc


def _has_commit(repo_dir: Path, sha: str) -> bool:
    result = _run_git(["cat-file", "-e", f"{sha}^{{commit}}"], cwd=repo_dir)
    return result.returncode == 0


def _materialize_sha(
    repo_dir: Path,
    remote: str,
    sha: str,
    fallback_remote: Optional[str] = None,
) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise SkillError("PR_SHA_NOT_FULL", f"Must be a full 40-character SHA: {sha}")
    if _has_commit(repo_dir, sha):
        return sha
    fetch = _run_git(["fetch", "--no-tags", remote, sha], cwd=repo_dir)
    if fetch.returncode != 0 and fallback_remote:
        fetch = _run_git(["fetch", "--no-tags", fallback_remote, sha], cwd=repo_dir)
    if fetch.returncode != 0:
        raise _git_fail("PR_BASE_FETCH_FAILED", "fetch commit", fetch.stderr)
    return _rev_parse(repo_dir, sha)


def fetch_pr(
    *,
    pr_url: str,
    run_dir: Path,
    run_id: str,
    cache_dir: Optional[Path],
    local_repo: Optional[Path],
    git_url: Optional[str],
    base_sha: Optional[str],
    head_sha: Optional[str],
    head_ref: Optional[str],
) -> Dict[str, Any]:
    parsed = parse_source_url(pr_url)
    if git_url:
        override = parse_source_url(git_url)
        if override.get("number") is not None:
            raise SkillError("PR_URL_UNSUPPORTED", "--git-url must be a git repository URL, not a PR/MR page")
        parsed["gitUrl"] = override["gitUrl"]
        parsed["host"] = override["host"]
        parsed["owner"] = override["owner"]
        parsed["repo"] = override["repo"]
        parsed["gitUrlCandidates"] = [override["gitUrl"]]

    context = resolve_run_context(run_dir, run_id)
    public_dir = Path(context["runDir"])
    cache_root = _resolve_cache_root(public_dir, cache_dir)
    repo_dir = _cache_repo_dir(cache_root, parsed)
    candidates = _unique_urls(*(parsed.get("gitUrlCandidates") or []), parsed["gitUrl"])
    resolved_head_ref = head_ref or parsed["headRef"]
    limitations: List[str] = []

    _ensure_worktree(repo_dir, candidates, local_repo)
    remote_git_url = parsed["gitUrl"]
    fetch_remote = "origin"
    fallback_remote = None
    if local_repo is not None:
        limitations.append("Resolved SHAs from --local-repo local objects; rewritten remote git is not contacted by default")

    def _need_source_fallback() -> Optional[str]:
        nonlocal fallback_remote
        if local_repo is None or fallback_remote == "source":
            return fallback_remote
        _bind_source_remote(repo_dir, remote_git_url)
        fallback_remote = "source"
        limitations.append("Local objects missing; fell back to remote source")
        return fallback_remote

    if head_sha:
        if not _has_commit(repo_dir, head_sha):
            _need_source_fallback()
        head_sha = _materialize_sha(repo_dir, fetch_remote, head_sha, fallback_remote)
        if not _update_ref(repo_dir, "refs/pr/head", head_sha):
            raise SkillError("PR_SHA_UNRESOLVED", f"Cannot write head: {head_sha}")
        resolved_head_ref = head_ref or parsed["headRef"]
    else:
        try:
            resolved_head_ref = _resolve_head_ref(
                repo_dir,
                parsed,
                resolved_head_ref,
                fallback_remote,
                primary_remote=fetch_remote,
            )
        except SkillError as error:
            if error.code != "PR_HEAD_REF_MISSING" or local_repo is None:
                raise
            _need_source_fallback()
            resolved_head_ref = _resolve_head_ref(
                repo_dir,
                parsed,
                resolved_head_ref,
                fallback_remote,
                primary_remote=fetch_remote,
            )
        try:
            _fetch_ref(
                repo_dir,
                fetch_remote,
                resolved_head_ref,
                "refs/pr/head",
                fallback_remote,
            )
        except SkillError:
            _need_source_fallback()
            _fetch_ref(
                repo_dir,
                fetch_remote,
                resolved_head_ref,
                "refs/pr/head",
                fallback_remote,
            )
        head_sha = _rev_parse(repo_dir, "refs/pr/head")

    if base_sha:
        if not _has_commit(repo_dir, base_sha):
            _need_source_fallback()
        resolved_base = _materialize_sha(repo_dir, fetch_remote, base_sha, fallback_remote)
        base_resolution = "explicit"
    else:
        api_base = _api_base_sha(parsed)
        if api_base:
            if not _has_commit(repo_dir, api_base):
                _need_source_fallback()
            resolved_base = _materialize_sha(
                repo_dir, fetch_remote, api_base, fallback_remote
            )
            base_resolution = "api"
        else:
            if parsed.get("number") is None:
                limitations.append("Custom repo did not provide --base-sha; base is inferred from merge-base of the default branch and head")
            branch = _default_branch(repo_dir, fetch_remote)
            if not branch:
                _run_git(["remote", "set-head", fetch_remote, "-a"], cwd=repo_dir)
                branch = _default_branch(repo_dir, fetch_remote)
            if not branch:
                raise SkillError("PR_BASE_UNRESOLVED", "Cannot infer base; pass --base-sha")
            _fetch_ref(
                repo_dir,
                fetch_remote,
                branch,
                "refs/pr/default",
                fallback_remote,
            )
            merge = _run_git(["merge-base", "refs/pr/default", "refs/pr/head"], cwd=repo_dir)
            if merge.returncode != 0 or not merge.stdout.strip():
                raise SkillError("PR_BASE_UNRESOLVED", "Cannot compute merge-base; pass --base-sha")
            resolved_base = merge.stdout.strip()
            if not re.fullmatch(r"[0-9a-f]{40}", resolved_base):
                raise SkillError("PR_SHA_NOT_FULL", f"merge-base is not a full SHA: {resolved_base}")
            base_resolution = "merge-base"

    if parsed.get("family") == "code-ui":
        limitations.append(
            "Code UI URL rewritten to a git remote; no platform PR API, so base uses merge-base; if the remote has no PR head ref, use --head-sha / --head-ref or a local branch"
        )
    if parsed.get("family") == "git":
        limitations.append("Custom repository URL does not use a platform PR API; fetch is git-remote only")

    return {
        "ok": True,
        "code": "PR_FETCHED",
        "message": "Fetched into the local cache; ready to archive into the GIT slot",
        "runDir": context["runDir"],
        "runId": context["runId"],
        "prUrl": pr_url,
        "family": parsed["family"],
        "host": parsed["host"],
        "owner": parsed["owner"],
        "repo": parsed["repo"],
        "number": parsed["number"],
        "gitUrl": remote_git_url,
        "worktree": str(repo_dir),
        "cacheDir": str(repo_dir),
        "repositoryId": _repository_id(parsed),
        "localRepo": str(local_repo) if local_repo else None,
        "baselineCommitId": resolved_base,
        "targetCommitId": head_sha,
        "baseSha": resolved_base,
        "headSha": head_sha,
        "headRef": resolved_head_ref,
        "baseResolution": base_resolution,
        "limitations": limitations,
    }


def run_self_check() -> Dict[str, Any]:
    """No-network parse and permission-classification checks."""
    failures: List[str] = []

    code_ui = parse_source_url(
        "https://dev.example.com/code/repo-detail/group/repo/pr/731/diff"
    )
    if code_ui["family"] != "code-ui":
        failures.append("code-ui family=%s" % code_ui["family"])
    if code_ui["number"] != 731:
        failures.append("code-ui number=%s" % code_ui["number"])
    if code_ui["owner"] != "group" or code_ui["repo"] != "repo":
        failures.append("code-ui owner/repo=%s/%s" % (code_ui["owner"], code_ui["repo"]))
    if code_ui["host"] != "git.example.com":
        failures.append("code-ui host=%s" % code_ui["host"])
    if code_ui["gitUrl"] != "https://git.example.com/group/repo.git":
        failures.append("code-ui gitUrl=%s" % code_ui["gitUrl"])
    if "ssh://git@git.example.com/group/repo.git" not in code_ui["gitUrlCandidates"]:
        failures.append("code-ui missing ssh candidate")
    if code_ui["apiKind"] is not None:
        failures.append("code-ui apiKind should be None")

    github = parse_source_url("https://github.com/owner/repo/pull/731/files")
    if github["family"] != "github" or github["number"] != 731:
        failures.append("github parse drifted")
    if github["gitUrl"] != "https://github.com/owner/repo.git":
        failures.append("github gitUrl=%s" % github["gitUrl"])

    gitlab = parse_source_url("https://gitlab.com/group/repo/-/merge_requests/731")
    if gitlab["family"] != "gitlab" or gitlab["number"] != 731:
        failures.append("gitlab parse drifted")

    short_pr = parse_source_url("https://example.com/owner/repo/pr/731")
    if short_pr["number"] != 731 or short_pr["repo"] != "repo":
        failures.append("generic /pr/ parse drifted")

    samples = (
        "致命错误：无法更新重定向后的 URL 基址：\n重定向：https://login.example.com/",
        "fatal: unable to update url base from redirection.\nredirected to https://login.example.com/",
    )
    for sample in samples:
        if not _is_permission_error(sample):
            failures.append("permission marker missed: %s" % sample[:40])
    perm_msg = _git_fail("PR_CLONE_FAILED", "clone", samples[0]).message
    if "two full commits" in perm_msg:
        failures.append("permission speech still asks for two commits")
    if "Permission denied" not in perm_msg or "--head-sha" not in perm_msg:
        failures.append("permission speech missing local-repo / head hint")

    aliases = _head_ref_aliases("feature/demo")
    if "refs/remotes/origin/feature/demo" not in aliases or "origin/feature/demo" not in aliases:
        failures.append("head-ref aliases missing origin variants")

    ok = not failures
    return {
        "ok": ok,
        "code": "SELF_CHECK_OK" if ok else "SELF_CHECK_FAILED",
        "failures": failures,
        "msg": "self-check passed" if ok else "; ".join(failures),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fetch a PR/MR or custom git remote into runDir cache")
    parser.add_argument("--pr-url", default="", help="PR/MR URL, or a custom git repository URL")
    parser.add_argument("--run-dir", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--cache-dir", help="Defaults to {runDir}/testcase/.pr-cache and must stay under that directory")
    parser.add_argument("--local-repo", help="Existing local repo used only as a credential landing; working tree is not modified")
    parser.add_argument("--git-url", help="Override the git remote used for clone/fetch")
    parser.add_argument("--base-sha", help="Full 40-character base SHA; optional")
    parser.add_argument("--head-sha", help="Full 40-character head SHA; can be set explicitly for a custom repo")
    parser.add_argument("--head-ref", help="Override the remote head ref, e.g. refs/heads/feature-x")
    parser.add_argument("--self-check", action="store_true", help="No-network parse and permission-classification self-check")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.self_check:
        result = run_self_check()
        print_result(result)
        return 0 if result["ok"] else 1
    if not args.pr_url or not args.run_dir or not args.run_id:
        print_error(SkillError("PR_ARGS_REQUIRED", "--pr-url / --run-dir / --run-id are required"))
        return 2
    local_repo = Path(args.local_repo).expanduser().resolve() if args.local_repo else None
    if local_repo is not None and not (local_repo / ".git").exists() and not local_repo.as_posix().endswith(".git"):
        print_error(SkillError("PR_LOCAL_REPO_INVALID", f"--local-repo is not a git repository: {local_repo}"))
        return 2
    try:
        result = fetch_pr(
            pr_url=args.pr_url,
            run_dir=Path(args.run_dir).expanduser(),
            run_id=args.run_id,
            cache_dir=Path(args.cache_dir).expanduser() if args.cache_dir else None,
            local_repo=local_repo,
            git_url=args.git_url,
            base_sha=args.base_sha,
            head_sha=args.head_sha,
            head_ref=args.head_ref,
        )
    except SkillError as error:
        print_error(error)
        return 2
    print_result(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

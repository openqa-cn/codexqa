# Single PATH policy for the CodexQA CLI, SAST tools, and the runtimes that install them.
# Source this file, then call sast_refresh_path. Safe to call more than once.
# Do not hardcode a machine prefix. Resolve bins from config and the tool itself.
#
# Each ecosystem is resolved from that tool's own config, then a bounded search
# only when the runtime is not already visible. No install prefix is hardcoded.
#   npm (codexqa, eslint): ~/.npmrc prefix, $npm_config_prefix, `npm prefix -g`
#     Unix: <prefix>/bin. Windows: the prefix directory itself (eslint.cmd lives there).
#   pip (semgrep, bandit, ruff): sysconfig scripts. Unix user scheme is bin;
#     Windows user scheme is Scripts. Also accept name.exe / .cmd / .bat.
#   go (gitleaks, gosec, osv-scanner): $GOBIN, $GOPATH, `go env`, brew/asdf if present.
#     Windows GOPATH is split on ';'. Search roots come from PROGRAMFILES and LOCALAPPDATA.
#   node shims: $NVM_DIR, $VOLTA_HOME, $FNM_DIR, $ASDF_DATA_DIR
# codexqa_cli_path prints the resolved `codexqa`.
# A directory is prepended when it contains go, npm, node, codexqa, or a SAST tool,
# or when it is an install destination (so a tool written there is visible).

sast_prepend_dir() {
  local dir="${1%/}"
  [[ -n "$dir" && -d "$dir" ]] || return 1
  case ":${PATH:-}:" in
    *":${dir}:"*) return 1 ;;
  esac
  export PATH="${dir}:${PATH:-}"
  return 0
}

# Git Bash / MSYS / Cygwin. Native cmd.exe is not a supported shell.
sast_is_windows() {
  if [[ -n "${SAST_IS_WINDOWS:-}" ]]; then
    [[ "$SAST_IS_WINDOWS" == 1 ]]
    return
  fi
  SAST_IS_WINDOWS=0
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) SAST_IS_WINDOWS=1 ;;
  esac
  case "${OSTYPE:-}" in
    msys*|mingw*|cygwin*) SAST_IS_WINDOWS=1 ;;
  esac
  # Do not treat WINDIR/SYSTEMROOT as Windows: WSL is Linux and may inherit them.
  [[ "$SAST_IS_WINDOWS" == 1 ]]
}

# C:\Users\a\AppData\Roaming\npm -> /c/Users/a/AppData/Roaming/npm under Git Bash.
# Unix paths are returned unchanged. cygpath wins when it exists.
sast_posix_path() {
  local p="${1:-}" converted drive rest
  [[ -n "$p" ]] || return 0
  if command -v cygpath >/dev/null 2>&1; then
    converted="$(cygpath -u "$p" 2>/dev/null || true)"
    if [[ -n "$converted" ]]; then
      printf '%s\n' "$converted"
      return 0
    fi
  fi
  case "$p" in
    [A-Za-z]:\\*|[A-Za-z]:/*)
      drive="${p:0:1}"
      drive="$(printf '%s' "$drive" | tr '[:upper:]' '[:lower:]')"
      rest="${p:2}"
      rest="${rest//\\//}"
      printf '/%s%s\n' "$drive" "$rest"
      ;;
    *)
      printf '%s\n' "${p//\\//}"
      ;;
  esac
}

sast_can_run() {
  local f="${1:-}"
  [[ -n "$f" && -e "$f" ]] || return 1
  [[ -x "$f" ]] && return 0
  case "$f" in
    *.exe|*.cmd|*.bat) return 0 ;;
  esac
  return 1
}

sast_tool_in_dir() {
  local dir="${1%/}" name="${2:-}" cand
  [[ -n "$dir" && -n "$name" ]] || return 1
  for cand in "$name" "${name}.exe" "${name}.cmd" "${name}.bat"; do
    if sast_can_run "${dir}/${cand}"; then
      return 0
    fi
  done
  return 1
}

sast_push_candidate() {
  local dir existing
  dir="$(sast_posix_path "${1:-}")"
  dir="${dir%/}"
  [[ -n "$dir" && -d "$dir" ]] || return 0
  if [[ ${#SAST_CANDIDATES[@]} -gt 0 ]]; then
    for existing in "${SAST_CANDIDATES[@]}"; do
      [[ "$existing" == "$dir" ]] && return 0
    done
  fi
  SAST_CANDIDATES+=("$dir")
}

sast_push_front() {
  local dir="${1%/}"
  local existing
  [[ -n "$dir" && -d "$dir" ]] || return 0
  if [[ ${#SAST_CANDIDATES[@]} -gt 0 ]]; then
    for existing in "${SAST_CANDIDATES[@]}"; do
      [[ "$existing" == "$dir" ]] && return 0
    done
    SAST_CANDIDATES=("$dir" "${SAST_CANDIDATES[@]}")
  else
    SAST_CANDIDATES=("$dir")
  fi
}

sast_move_front() {
  local dir="${1%/}"
  local existing
  local -a kept=()
  if [[ ${#SAST_CANDIDATES[@]} -gt 0 ]]; then
    for existing in "${SAST_CANDIDATES[@]}"; do
      [[ "$existing" == "$dir" ]] && continue
      kept+=("$existing")
    done
    SAST_CANDIDATES=("${kept[@]+"${kept[@]}"}")
  fi
  sast_push_front "$dir"
}

sast_mark_dest() {
  local dir="${1%/}"
  [[ -n "$dir" && -d "$dir" ]] || return 0
  local existing
  if [[ ${#SAST_INSTALL_DESTS[@]} -gt 0 ]]; then
    for existing in "${SAST_INSTALL_DESTS[@]}"; do
      if [[ "$existing" == "$dir" ]]; then
        # A later ecosystem report wins over an earlier one.
        sast_move_front "$dir"
        return 0
      fi
    done
  fi
  SAST_INSTALL_DESTS+=("$dir")
  sast_push_front "$dir"
}

# v22.20.0 -> zero-padded key so string compare matches version order.
sast_ver_key() {
  local base
  base="$(basename "$(dirname "$1")")"
  base="${base#v}"
  local IFS=.
  local p1 p2 p3
  IFS=. read -r p1 p2 p3 <<< "$base"
  printf '%05d%05d%05d' "${p1:-0}" "${p2:-0}" "${p3:-0}"
}

sast_push_versioned_bins() {
  local root="$1"
  [[ -d "$root" ]] || return 0
  local -a dirs=()
  local d i j n tmp
  for d in "$root"/*/bin; do
    [[ -d "$d" ]] || continue
    dirs+=("$d")
  done
  n=${#dirs[@]}
  [[ "$n" -eq 0 ]] && return 0
  for ((i = 0; i < n; i++)); do
    for ((j = i + 1; j < n; j++)); do
      if [[ "$(sast_ver_key "${dirs[$i]}")" < "$(sast_ver_key "${dirs[$j]}")" ]]; then
        tmp="${dirs[$i]}"
        dirs[$i]="${dirs[$j]}"
        dirs[$j]="$tmp"
      fi
    done
  done
  for d in "${dirs[@]}"; do
    sast_push_candidate "$d"
  done
}

# Raw npm prefix from npmrc. Bin layout is applied by sast_expand_npm_prefix.
sast_npmrc_prefix() {
  local f line val
  for f in "${HOME}/.npmrc" /usr/local/etc/npmrc /etc/npmrc "${APPDATA:-}/npm/etc/npmrc"; do
    [[ -n "$f" && -f "$f" ]] || continue
    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in
        prefix=*)
          val="${line#prefix=}"
          val="${val#"${val%%[![:space:]]*}"}"
          val="${val%"${val##*[![:space:]]}"}"
          val="${val#\"}"
          val="${val%\"}"
          val="${val#\'}"
          val="${val%\'}"
          if [[ -n "$val" ]]; then
            sast_posix_path "$val"
            return 0
          fi
          ;;
      esac
    done < "$f"
  done
  return 0
}

# Unix global bins live in <prefix>/bin. Windows npm puts eslint.cmd in <prefix> itself.
sast_expand_npm_prefix() {
  local prefix
  prefix="$(sast_posix_path "${1:-}")"
  prefix="${prefix%/}"
  [[ -n "$prefix" ]] || return 0
  if sast_is_windows; then
    printf '%s\n' "$prefix"
  fi
  printf '%s\n' "${prefix}/bin"
}

# Every npm global bin this probe knows about. No absolute prefix is hardcoded.
# npmrc and npm_config_prefix work before npm is on PATH. `npm prefix -g` runs
# only after a previous pass has made npm visible (nvm / volta / fnm / asdf).
sast_npm_global_bins() {
  local bin prefix
  bin="$(sast_npmrc_prefix || true)"
  if [[ -n "$bin" ]]; then
    sast_expand_npm_prefix "$bin"
  fi
  if [[ -n "${npm_config_prefix:-}" ]]; then
    sast_expand_npm_prefix "$npm_config_prefix"
  fi
  if command -v npm >/dev/null 2>&1; then
    prefix="$(npm prefix -g 2>/dev/null || true)"
    if [[ -n "$prefix" ]]; then
      sast_expand_npm_prefix "$prefix"
    fi
  fi
}

sast_mark_bins() {
  local bin
  while IFS= read -r bin; do
    [[ -n "$bin" ]] || continue
    sast_mark_dest "$bin"
  done
}

sast_mark_npm_global_bins() {
  sast_mark_bins < <(sast_npm_global_bins)
}

# pip user and interpreter script dirs. The path comes from Python, not a fixed prefix.
sast_python_bins() {
  local py c scripts user_scripts user_base seen=""
  for c in ${PY:-} python3 python python3.13 python3.12 python3.11 python3.10; do
    [[ -n "$c" ]] || continue
    if [[ "$c" == /* && -x "$c" ]]; then
      py="$c"
    elif command -v "$c" >/dev/null 2>&1; then
      py="$(command -v "$c")"
    else
      continue
    fi
    case " ${seen} " in
      *" ${py} "*) continue ;;
    esac
    seen="${seen} ${py}"
    scripts="$("$py" -c 'import sysconfig; print(sysconfig.get_path("scripts") or "")' 2>/dev/null || true)"
    if sast_is_windows; then
      user_scripts="$("$py" -c 'import sysconfig; print(sysconfig.get_path("scripts", scheme="nt_user") or "")' 2>/dev/null || true)"
    else
      user_scripts="$("$py" -c 'import sysconfig; print(sysconfig.get_path("scripts", scheme="posix_user") or "")' 2>/dev/null || true)"
    fi
    user_base="$("$py" -c 'import site; print(site.getuserbase() or "")' 2>/dev/null || true)"
    [[ -n "$scripts" ]] && sast_posix_path "$scripts"
    # User scheme last so pip --user wins over the interpreter's system scripts dir.
    [[ -n "$user_scripts" ]] && sast_posix_path "$user_scripts"
    if [[ -n "$user_base" ]]; then
      if sast_is_windows; then
        sast_posix_path "${user_base%/}/Scripts"
      else
        sast_posix_path "${user_base%/}/bin"
      fi
    fi
  done
  if command -v pyenv >/dev/null 2>&1; then
    local root
    root="$(pyenv root 2>/dev/null || true)"
    [[ -n "$root" ]] && printf '%s\n' "${root%/}/shims"
  elif [[ -n "${PYENV_ROOT:-}" ]]; then
    printf '%s\n' "${PYENV_ROOT%/}/shims"
  fi
}

sast_mark_python_bins() {
  sast_mark_bins < <(sast_python_bins)
}

# Unix searches /usr/local, /usr/lib, /opt. Windows searches the Program Files
# and LocalAppData directories the environment already names.
sast_go_search_roots() {
  local e val
  if [[ -n "${GOROOT:-}" ]]; then
    sast_posix_path "${GOROOT}/bin"
  fi
  if sast_is_windows; then
    for e in LOCALAPPDATA PROGRAMFILES ProgramW6432; do
      val="${!e:-}"
      [[ -n "$val" ]] && sast_posix_path "$val"
    done
  else
    printf '%s\n' /usr/local /usr/lib /opt
  fi
  printf '%s\n' "${HOME}/sdk" "${HOME}/.go" "${HOME}/go"
}

# suffix is "" or "/bin". Windows lists use ';'; a drive letter must not be split.
sast_emit_joined() {
  local raw="$1" suffix="$2" sep part
  if sast_is_windows; then sep=';'; else sep=':'; fi
  local IFS="$sep"
  for part in $raw; do
    [[ -n "$part" ]] || continue
    part="$(sast_posix_path "$part")"
    printf '%s\n' "${part%/}${suffix}"
  done
}

# Locate a go binary from PATH, version managers, or a depth-capped search.
# The search does not assume a particular .../bin/go path.
sast_discover_go() {
  local cand
  if command -v go >/dev/null 2>&1; then
    command -v go
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    cand="$(brew --prefix go 2>/dev/null || true)"
    if [[ -n "$cand" ]] && sast_can_run "${cand%/}/bin/go"; then
      printf '%s\n' "${cand%/}/bin/go"
      return 0
    fi
    if [[ -n "$cand" ]] && sast_can_run "${cand%/}/bin/go.exe"; then
      sast_posix_path "${cand%/}/bin/go.exe"
      return 0
    fi
  fi
  if command -v asdf >/dev/null 2>&1; then
    cand="$(asdf where golang 2>/dev/null || true)"
    if [[ -n "$cand" ]] && sast_can_run "${cand%/}/bin/go"; then
      printf '%s\n' "${cand%/}/bin/go"
      return 0
    fi
    if [[ -n "$cand" ]] && sast_can_run "${cand%/}/bin/go.exe"; then
      sast_posix_path "${cand%/}/bin/go.exe"
      return 0
    fi
  fi
  local root
  while IFS= read -r root; do
    [[ -n "$root" && -d "$root" ]] || continue
    while IFS= read -r cand; do
      sast_can_run "$cand" || continue
      if "$cand" version >/dev/null 2>&1; then
        sast_posix_path "$cand"
        return 0
      fi
    done < <(find "$root" -maxdepth 4 \( -type f -o -type l \) \( -name go -o -name 'go.exe' \) 2>/dev/null)
  done < <(sast_go_search_roots)
  return 0
}

sast_go_binary() {
  if sast_can_run "${SAST_GO_BIN:-}"; then
    printf '%s\n' "$SAST_GO_BIN"
    return 0
  fi
  local cand
  cand="$(sast_discover_go || true)"
  if sast_can_run "$cand"; then
    SAST_GO_BIN="$cand"
    printf '%s\n' "$cand"
  fi
}

# GOPATH/bin and GOROOT/bin from the environment and from `go env`.
sast_go_bins() {
  local go_bin goroot gopath gobin
  if [[ -n "${GOBIN:-}" ]]; then
    sast_emit_joined "$GOBIN" ""
  fi
  if [[ -n "${GOROOT:-}" ]]; then
    sast_emit_joined "$GOROOT" "/bin"
  fi
  if [[ -n "${GOPATH:-}" ]]; then
    sast_emit_joined "$GOPATH" "/bin"
  else
    printf '%s\n' "${HOME}/go/bin"
  fi
  go_bin="$(sast_go_binary || true)"
  if sast_can_run "$go_bin"; then
    printf '%s\n' "$(dirname "$go_bin")"
    goroot="$("$go_bin" env GOROOT 2>/dev/null || true)"
    gopath="$("$go_bin" env GOPATH 2>/dev/null || true)"
    gobin="$("$go_bin" env GOBIN 2>/dev/null || true)"
    [[ -n "$goroot" ]] && sast_emit_joined "$goroot" "/bin"
    [[ -n "$gobin" ]] && sast_emit_joined "$gobin" ""
    [[ -n "$gopath" ]] && sast_emit_joined "$gopath" "/bin"
  fi
  if command -v brew >/dev/null 2>&1; then
    local bp
    bp="$(brew --prefix 2>/dev/null || true)"
    [[ -n "$bp" ]] && printf '%s\n' "${bp%/}/bin"
  fi
  local asdf_data="${ASDF_DATA_DIR:-${HOME}/.asdf}"
  local d
  for d in "$asdf_data"/installs/golang/*/bin; do
    [[ -d "$d" ]] && printf '%s\n' "$d"
  done
}

sast_mark_go_bins() {
  sast_mark_bins < <(sast_go_bins)
}

sast_collect_candidates() {
  SAST_CANDIDATES=()
  SAST_INSTALL_DESTS=()

  sast_mark_python_bins
  sast_mark_go_bins
  sast_mark_npm_global_bins

  sast_push_versioned_bins "${NVM_DIR:-${HOME}/.nvm}/versions/node"
  sast_push_candidate "${VOLTA_HOME:-${HOME}/.volta}/bin"
  sast_push_candidate "${FNM_DIR:-${HOME}/.local/share/fnm}/aliases/default/bin"
  sast_push_candidate "${HOME}/.asdf/shims"
  if [[ -n "${ASDF_DATA_DIR:-}" ]]; then
    sast_push_candidate "${ASDF_DATA_DIR}/shims"
  fi
}

# Second pass: npm, python, and go may only exist after the first prepend.
sast_add_live_install_dirs() {
  sast_mark_npm_global_bins
  sast_mark_python_bins
  sast_mark_go_bins
}

sast_dir_has_tool() {
  local dir="$1" name
  for name in go npm node codexqa semgrep bandit ruff eslint gitleaks gosec osv-scanner; do
    if sast_tool_in_dir "$dir" "$name"; then
      return 0
    fi
  done
  return 1
}

sast_is_install_dest() {
  local dir="$1" existing
  [[ ${#SAST_INSTALL_DESTS[@]} -gt 0 ]] || return 1
  for existing in "${SAST_INSTALL_DESTS[@]}"; do
    [[ "$existing" == "$dir" ]] && return 0
  done
  return 1
}

sast_apply_candidates() {
  local i dir
  [[ ${#SAST_CANDIDATES[@]} -gt 0 ]] || return 0
  for ((i = ${#SAST_CANDIDATES[@]} - 1; i >= 0; i--)); do
    dir="${SAST_CANDIDATES[$i]}"
    if sast_dir_has_tool "$dir" || sast_is_install_dest "$dir"; then
      sast_prepend_dir "$dir" || true
    fi
  done
  hash -r
}

sast_log_discovered() {
  local name resolved dir
  for name in go npm codexqa semgrep bandit ruff eslint gitleaks gosec osv-scanner; do
    resolved="$(command -v "$name" 2>/dev/null || true)"
    [[ -n "$resolved" ]] || continue
    dir="$(dirname "$resolved")"
    case ":${SAST_PATH_BEFORE:-}:" in
      *":${dir}:"*) continue ;;
    esac
    case " ${SAST_LOGGED:-} " in
      *" ${name} "*) continue ;;
    esac
    SAST_LOGGED="${SAST_LOGGED:-} ${name}"
    printf '[sast-tool-path] %s not on PATH; using %s\n' "$name" "$resolved" >&2
  done
}

# Rebuild PATH so the CodexQA CLI, every SAST tool, and its installer runtime are visible.
sast_refresh_path() {
  SAST_GO_BIN=""
  SAST_PATH_BEFORE="${PATH:-}"
  sast_collect_candidates
  sast_apply_candidates
  sast_add_live_install_dirs
  sast_apply_candidates
  sast_log_discovered
}

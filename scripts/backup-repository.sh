#!/usr/bin/env bash
set -Eeuo pipefail

# Create/update a full Git mirror on a separate disk or independent storage.
# Usage: bash scripts/backup-repository.sh /path/on/separate-storage/userdie-digital.git

REPOSITORY_URL="https://github.com/userdie-foundation/userdie-digital.git"
DESTINATION="${1:-}"

if [[ -z "$DESTINATION" ]]; then
  echo "Usage: $0 /path/on/separate-storage/userdie-digital.git" >&2
  exit 2
fi

# Resolve the destination parent and refuse a backup inside this working tree.
mkdir -p "$(dirname "$DESTINATION")"
DEST_PARENT="$(cd "$(dirname "$DESTINATION")" && pwd -P)"
DEST_ABSOLUTE="$DEST_PARENT/$(basename "$DESTINATION")"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$REPO_ROOT" ]]; then
  REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"
  case "$DEST_ABSOLUTE/" in
    "$REPO_ROOT/"*)
      echo "Refusing a backup destination inside the working repository. Use separate storage." >&2
      exit 2
      ;;
  esac
fi

if [[ -e "$DEST_ABSOLUTE" ]]; then
  if [[ ! -d "$DEST_ABSOLUTE" ]] || [[ "$(git -C "$DEST_ABSOLUTE" rev-parse --is-bare-repository 2>/dev/null || true)" != "true" ]]; then
    echo "Destination exists but is not a bare Git repository: $DEST_ABSOLUTE" >&2
    exit 2
  fi
  git -C "$DEST_ABSOLUTE" remote set-url origin "$REPOSITORY_URL"
  git -C "$DEST_ABSOLUTE" fetch --prune origin '+refs/*:refs/*'
else
  git clone --mirror "$REPOSITORY_URL" "$DEST_ABSOLUTE"
fi

git -C "$DEST_ABSOLUTE" fsck --full
echo
echo "Backup mirror verified: $DEST_ABSOLUTE"
echo "Repository refs:"
git -C "$DEST_ABSOLUTE" show-ref
echo
echo "IMPORTANT: this is independent only if stored outside the primary GitHub account and available separately."

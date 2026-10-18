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

case "$DESTINATION" in
  */.git|*/.git/*)
    echo "Refusing a destination inside a .git directory." >&2
    exit 2
    ;;
esac

if [[ -e "$DESTINATION" ]]; then
  if [[ ! -d "$DESTINATION" ]] || ! git -C "$DESTINATION" rev-parse --is-bare-repository >/dev/null 2>&1; then
    echo "Destination exists but is not a bare Git repository: $DESTINATION" >&2
    exit 2
  fi
  git -C "$DESTINATION" remote set-url origin "$REPOSITORY_URL"
  git -C "$DESTINATION" fetch --prune origin '+refs/*:refs/*'
else
  mkdir -p "$(dirname "$DESTINATION")"
  git clone --mirror "$REPOSITORY_URL" "$DESTINATION"
fi

git -C "$DESTINATION" fsck --full
echo
echo "Backup mirror verified: $DESTINATION"
echo "Repository refs:"
git -C "$DESTINATION" show-ref
echo
echo "IMPORTANT: this is independent only if the destination is stored outside the primary GitHub account and is available separately."

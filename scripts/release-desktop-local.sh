#!/usr/bin/env bash
# Build the macOS arm64 desktop app on this machine and publish it as a GitHub
# Release that the in-app updater (electron-updater, GitHub provider) reads.
#
#   scripts/release-desktop-local.sh 0.0.46                      # stable ("latest" channel)
#   scripts/release-desktop-local.sh 0.0.47-nightly.20261022.1   # nightly channel
#
# Env:
#   FLORIPACODE_DESKTOP_UPDATE_REPOSITORY  owner/repo for the release and the update feed
#                                          (default: wellguimaraes/floripa-code)
#   FLORIPACODE_DESKTOP_SIGNED=1           Developer ID sign + notarize. Needs CSC_NAME, an unlocked
#                                          CSC_KEYCHAIN holding the certificate, and APPLE_API_KEY,
#                                          APPLE_API_KEY_ID, APPLE_API_ISSUER. Avoid CSC_LINK: on
#                                          electron-builder 26 its p12 password reaches the build log.
#
# macOS only applies an update whose signature satisfies the running app's
# designated requirement. Ad-hoc (unsigned) builds install and run, but cannot
# auto-update: ship signed builds to anyone who should receive updates.
set -euo pipefail

version="${1:?usage: scripts/release-desktop-local.sh <version>}"
version="${version#v}"
tag="v$version"
repo="${FLORIPACODE_DESKTOP_UPDATE_REPOSITORY:-wellguimaraes/floripa-code}"
export FLORIPACODE_DESKTOP_UPDATE_REPOSITORY="$repo"

cd "$(dirname "$0")/.."

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-nightly\.[0-9]{8}\.[0-9]+)?$ ]]; then
  echo "Version must be X.Y.Z or X.Y.Z-nightly.YYYYMMDD.N, got: $version" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit or stash first so the tag matches the build." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Tag $tag already exists." >&2
  exit 1
fi
gh auth status >/dev/null

signed_args=()
if [[ "${FLORIPACODE_DESKTOP_SIGNED:-}" == "1" ]]; then
  signed_args=(--signed)
else
  echo "warning: building unsigned (ad-hoc). Installs of this build cannot auto-update." >&2
fi

# Stable releases bump the package versions on the branch, like CI's finalize
# job. Nightlies leave the branch alone; the version lives only in the build.
if [[ "$version" != *-* ]]; then
  node scripts/update-release-package-versions.ts "$version"
  vp fmt apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json
  vp install --lockfile-only --ignore-scripts
  if [[ -n "$(git status --porcelain)" ]]; then
    git commit -am "chore(release): $tag"
  fi
fi

out_dir="release/$tag"
rm -rf "$out_dir"
vp run dist:desktop:artifact \
  --platform mac \
  --target dmg \
  --arch arm64 \
  --build-version "$version" \
  --output-dir "$out_dir" \
  ${signed_args[@]+"${signed_args[@]}"}

shopt -s nullglob
assets=("$out_dir"/*.dmg "$out_dir"/*.zip "$out_dir"/*.blockmap "$out_dir"/*-mac.yml)
if ! compgen -G "$out_dir/*-mac.yml" >/dev/null; then
  echo "No updater manifest in $out_dir; the update feed was not configured." >&2
  exit 1
fi

git tag "$tag"
git push origin HEAD "$tag"

release_args=(--repo "$repo" --title "Floripa Code $tag" --generate-notes --verify-tag)
if [[ "$version" == *-* ]]; then
  release_args+=(--prerelease --latest=false)
else
  release_args+=(--latest)
fi
gh release create "$tag" "${assets[@]}" "${release_args[@]}"

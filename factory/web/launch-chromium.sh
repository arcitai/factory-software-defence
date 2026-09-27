#!/bin/sh
set -eu
: "${FACTORY_CHROMIUM_EXECUTABLE:?trusted Playwright browser path is required}"
: "${FACTORY_BROWSER_UID:?trusted browser UID is required}"
: "${FACTORY_BROWSER_GID:?trusted browser GID is required}"
exec /usr/bin/setpriv --reuid "$FACTORY_BROWSER_UID" --regid "$FACTORY_BROWSER_GID" --clear-groups -- "$FACTORY_CHROMIUM_EXECUTABLE" "$@"

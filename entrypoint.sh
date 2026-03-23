#!/bin/sh
set -e
# Fix ownership of the data volume at startup (Docker mounts volumes as root:root)
chown dosh:dosh /data
exec su-exec dosh node --experimental-sqlite dist/server.js

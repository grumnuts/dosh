#!/bin/sh
set -e
# Fix ownership of the data volume and copied database files at startup.
chown -R dosh:dosh /data
exec su-exec dosh node --experimental-sqlite dist/server.js

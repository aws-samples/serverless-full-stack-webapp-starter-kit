#!/bin/bash -x

[ ! -d '/tmp/cache' ] && mkdir -p /tmp/cache

exec node apps/webapp/server.js

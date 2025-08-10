#!/bin/bash

set -eEuo pipefail

(cd frontend && npm run build)

go run .

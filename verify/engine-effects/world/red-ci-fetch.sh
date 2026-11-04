#!/bin/sh
# World step for red-ci: save GitHub REST's check runs for a scratch PR head. Usage: red-ci-fetch.sh <head sha>
curl -s "https://api.github.com/repos/suredesigntshirts/ccp_xstate_scratch/commits/$1/check-runs" > "$(dirname "$0")/../evidence/check-runs-pr18.json"

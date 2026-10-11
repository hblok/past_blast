#!/bin/sh
# self-test of port_kit: the oracle runner matches a toy recording, reports a difference when the toy is changed, and the mutation runner kills a real mutant and lets an equivalent one survive
set -e; cd "$(dirname "$0")/selftest"
node ../js/oracle.mjs adapter.mjs toy.jsonl toy.txt | grep -q "ALL MATCH"
sed -i 's/2 \* tics/3 * tics/' toy.js; ! node ../js/oracle.mjs adapter.mjs toy.jsonl toy.txt >/dev/null; sed -i 's/3 \* tics/2 * tics/' toy.js
python3 ../py/mutants.py mutants.json > /tmp/_mut.out; grep -q "speed: KILLED" /tmp/_mut.out; grep -q "noop: SURVIVED" /tmp/_mut.out
echo "port_kit selftest ok"

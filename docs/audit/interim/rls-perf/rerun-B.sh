#!/usr/bin/env bash
cd "$(dirname "$0")"
python3 run-measure.py perf_scratch B-orig > B-orig.log 2>&1
python3 run-measure.py perf_scratch_b B-rewrite > B-rewrite.log 2>&1
python3 05-loadtest.py perf_scratch B-orig 8,16 30 > B-orig-load.log 2>&1
python3 05-loadtest.py perf_scratch_b B-rewrite 8,16 30 > B-rewrite-load.log 2>&1
echo finished > rerun-B.done

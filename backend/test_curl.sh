#!/usr/bin/env sh
curl -N http://localhost:8000/chat \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","site":"example","page_type":"article","structured":{"title":"Example article"},"jsonld":[],"fallback_text":"This is an example page about renewable energy and solar power.","question":"What is this page about?","history":[]}'

#!/usr/bin/env bash
#
# ai-caller — bash / curl example
#
# Requires:
#   - curl, jq
#   - any Lightning wallet that can decode a bolt11 invoice and return a preimage
#     (e.g., Alby, Phoenix, Zeus, LNBits)
#
# Usage:
#   PHONE="+14155552671" TASK="Call and confirm reservation for 6pm" ./curl.sh

set -euo pipefail

ENDPOINT="${ENDPOINT:-https://sats4ai.com/api/l402/ai-call}"
PHONE="${PHONE:?set PHONE in E.164 format, e.g. +14155552671}"
TASK="${TASK:?set TASK as the instruction for the AI agent}"
DURATION="${DURATION:-3}"
LANGUAGE="${LANGUAGE:-en-US}"
REFUND_ADDRESS="${REFUND_ADDRESS:-}"

BODY=$(jq -n \
  --arg phone_number "$PHONE" \
  --arg task "$TASK" \
  --argjson duration_minutes "$DURATION" \
  --arg language "$LANGUAGE" \
  --arg refund_address "$REFUND_ADDRESS" \
  '{phone_number:$phone_number, task:$task, duration_minutes:$duration_minutes, language:$language}
   + (if $refund_address == "" then {} else {refund_address:$refund_address} end)')

echo "→ Step 1: requesting invoice"
HEADERS=$(curl -si -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$BODY" | tr -d '\r')

WWW_AUTH=$(echo "$HEADERS" | awk 'tolower($1)=="www-authenticate:" {sub(/^[^:]+:[ ]*/,""); print; exit}')
MACAROON=$(echo "$WWW_AUTH" | sed -n 's/.*macaroon="\([^"]*\)".*/\1/p')
INVOICE=$(echo "$WWW_AUTH"  | sed -n 's/.*invoice="\([^"]*\)".*/\1/p')

if [[ -z "$MACAROON" || -z "$INVOICE" ]]; then
  echo "  ✗ Did not receive a 402 challenge. Response headers:" >&2
  echo "$HEADERS" >&2
  exit 1
fi

echo "  ✓ Got macaroon and invoice"
echo ""
echo "→ Step 2: pay this invoice with your Lightning wallet, then paste the preimage below"
echo ""
echo "$INVOICE"
echo ""
read -rp "preimage (hex): " PREIMAGE

echo "→ Step 3: submitting authenticated call"
RESPONSE=$(curl -s -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: L402 ${MACAROON}:${PREIMAGE}" \
  -d "$BODY")

echo "$RESPONSE" | jq .

STATE=$(echo "$RESPONSE" | jq -r '.state // empty')
CALL_ID=$(echo "$RESPONSE" | jq -r '.call_id // empty')
SESSION_ID=$(echo "$RESPONSE" | jq -r '.session_id // empty')

if [[ "$STATE" == "pending_confirm" ]]; then
  echo ""
  echo "→ Agent needs clarification. Questions:"
  echo "$RESPONSE" | jq -r '.questions[]'
  echo ""
  echo "Build an answers object and POST again with action=confirm, session_id=$SESSION_ID"
  exit 0
fi

echo ""
echo "→ Call in progress. Poll with:"
echo "   curl \"${ENDPOINT}?call_id=${CALL_ID}\""

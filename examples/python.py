"""
ai-caller — Python example.

Requires:
    pip install requests

Pay the returned invoice with any Lightning wallet that gives you a preimage
(Alby, Phoenix, Zeus, LNBits, etc.), then paste the preimage when prompted.

Usage:
    python python.py --phone +14155552671 --task "Confirm reservation for 6pm"
"""

from __future__ import annotations

import argparse
import re
import sys
import time

import requests

ENDPOINT = "https://sats4ai.com/api/l402/ai-call"


def parse_challenge(www_authenticate: str) -> tuple[str, str]:
    mac = re.search(r'macaroon="([^"]+)"', www_authenticate)
    inv = re.search(r'invoice="([^"]+)"', www_authenticate)
    if not (mac and inv):
        raise RuntimeError(f"Could not parse L402 challenge: {www_authenticate!r}")
    return mac.group(1), inv.group(1)


def place_call(body: dict) -> None:
    # Step 1 — request invoice
    r = requests.post(ENDPOINT, json=body)
    if r.status_code != 402:
        sys.exit(f"Expected 402, got {r.status_code}: {r.text}")

    macaroon, invoice = parse_challenge(r.headers["WWW-Authenticate"])

    # Step 2 — pay out-of-band
    print("\nPay this invoice with your Lightning wallet:\n")
    print(invoice + "\n")
    preimage = input("preimage (hex): ").strip()

    # Step 3 — authenticated call
    r = requests.post(
        ENDPOINT,
        json=body,
        headers={"Authorization": f"L402 {macaroon}:{preimage}"},
    )
    r.raise_for_status()
    result = r.json()
    print("\nResponse:", result)

    if result.get("state") == "pending_confirm":
        print("\nAgent needs clarification. Questions:")
        for q in result.get("questions", []):
            print(" -", q)
        # Follow up with: POST {action: "confirm", session_id, answers: {...}}
        return

    call_id = result.get("call_id")
    if not call_id:
        return

    # Poll until terminal state
    while True:
        time.sleep(5)
        status = requests.get(ENDPOINT, params={"call_id": call_id}).json()
        state = status.get("state")
        print(f"  [{state}]")
        if state in {"completed", "failed"}:
            print("\nFinal:", status)
            return


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--phone", required=True, help="Destination in E.164 format")
    p.add_argument("--task", required=True, help="Instruction for the AI agent")
    p.add_argument("--duration-minutes", type=int, default=3)
    p.add_argument("--language", default="en-US")
    p.add_argument("--refund-address", default=None, help="Optional Lightning address")
    args = p.parse_args()

    body: dict = {
        "phone_number": args.phone,
        "task": args.task,
        "duration_minutes": args.duration_minutes,
        "language": args.language,
    }
    if args.refund_address:
        body["refund_address"] = args.refund_address

    place_call(body)


if __name__ == "__main__":
    main()

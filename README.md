# ai-caller

**AI voice agent API. Give your AI agent a phone. Pay per call with Bitcoin Lightning. No signup, no API key, no KYC.**

> Alternative to Vapi, Retell, and Bland — without the subscription, account, or credit card. MCP-native for agent frameworks.

A compound **voice agent API** that bundles AI reasoning, PSTN calling, speech-to-text, text-to-speech, automatic retry, and transcript analysis into one HTTP endpoint. Useful for AI outbound calling, AI appointment booking, AI bill negotiation, IVR navigation, and any task where an agent needs to pick up a phone. Built on Sats4AI's L402 payment protocol — pay for the minutes you use, unused deposit auto-refunds to a Lightning address.

---

## What makes it different

- **Push-back on ambiguity.** Before dialing, the agent checks if your task has enough info. If not (e.g., "book an appointment" without a date), it returns clarification questions. You answer, the call proceeds. No wasted minutes on doomed calls.
- **Pay-per-call deposit billing.** Deposit for N minutes upfront, get unused time refunded to a Lightning address automatically. The price varies by destination and duration, and the first request returns the exact amount as a Lightning invoice.
- **Any language.** en-US, es-ES, fr-FR, hi-IN, yo-NG, zh-CN — full Unicode range, not just the big-five. Useful when your caller, your callee, or your task is in an underserved language.
- **Auto-retry on voicemail / busy / no-answer.** Up to 3 attempts, included in the deposit. The poll endpoint shows retry progress.
- **Full transcript on failure.** If the agent couldn't complete the task, you get the transcript, call analysis, and disconnection reason — enough to adjust the task and retry with a new payment.
- **MCP-native.** If you're calling from an agent framework, the Sats4AI MCP server handles the payment challenge/response inline. No separate wallet integration, no L402 boilerplate.

---

## Quickstart

### Via MCP (agent-native — payment handled inline)

Sats4AI ships an MCP server that bundles this and 35+ other services. Agents discover the `ai-call` tool and invoke it directly — the Lightning payment challenge is negotiated inside the protocol, so there's no "get 402, pay, retry" dance to write.

```
{
  "mcpServers": {
    "sats4ai": {
      "command": "npx",
      "args": ["-y", "sats4ai-mcp"]
    }
  }
}
```

Your agent then calls `ai-call` with the same fields shown below.

### Via HTTP (any language, any wallet)

```bash
# Step 1: POST without auth → receive 402 Payment Required + Lightning invoice
curl -i -X POST https://sats4ai.com/api/l402/ai-call \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+14155552671",
    "task": "Call Dr. Smith'\''s office and book the earliest available appointment for a routine checkup. My name is Alice Jones, phone 415-555-0199. Flexible on date but prefer mornings.",
    "duration_minutes": 5,
    "language": "en-US",
    "refund_address": "alice@getalby.com"
  }'

# Response:
#   HTTP/1.1 402 Payment Required
#   WWW-Authenticate: L402 macaroon="<b64>", invoice="lnbc..."

# Step 2: Pay the invoice with any Lightning wallet → you get a preimage (hex)

# Step 3: Retry with Authorization header
curl -X POST https://sats4ai.com/api/l402/ai-call \
  -H "Authorization: L402 <macaroon>:<preimage>" \
  -H "Content-Type: application/json" \
  -d '{ ...same body... }'

# Response:
#   { "success": true, "call_id": "...", "state": "in_progress", "poll_url": "..." }
#   OR
#   { "state": "pending_confirm", "session_id": "...", "questions": [...] }
```

If `state` is `pending_confirm`, the agent needs more info. POST again with `{ "action": "confirm", "session_id": "...", "answers": { ... } }` — no second payment needed, the session validates the prior one.

See [examples/](examples/) for complete runnable scripts in curl, Python, and TypeScript.

---

## How it works

```
┌──────────┐   1. POST task      ┌────────────┐
│  Agent   │ ──────────────────> │  Sats4AI   │
│          │                     │  ai-call   │
│          │ <────────── 402 ─── │  endpoint  │
└──────────┘  invoice + macaroon └────────────┘
      │
      │ 2. Pay invoice via Lightning wallet
      │
      ▼
┌──────────┐   3. POST + L402 auth
│  Agent   │ ──────────────────>    Task analysis
│          │                         │
│          │ <── questions? ──── Ambiguous?
│          │                         │
│          │ 4. POST answers ───> Dial destination
│          │                         │
│          │                     Retry up to 3×
│          │                         │
│          │ 5. GET poll ───────> Transcribe + analyze
│          │                         │
│          │ <── transcript ──── Refund unused minutes
└──────────┘     + analysis
```

---

## Pricing

- **Deposit model.** You specify `duration_minutes` (1–30). Invoice is sized for telephony + AI minutes upfront.
- **Refund.** When the call ends, actual duration is measured server-side. Unused sats are refunded automatically to the Lightning address in `refund_address`. If omitted, the refund is claimable via a returned bolt11 invoice.
- **Rates.** The price varies by destination country and duration, so no fixed total is published. The invoice in the first 402 response is the exact amount.
- **Failure path.** If the task fails (IVR maze, destination unreachable, misunderstanding), the full call cost still applies but you get the transcript + analysis so a follow-up attempt can be more specific.

See [/api/estimate-cost](https://sats4ai.com/api/estimate-cost) to price a call before paying.

---

## Real use cases

- **Call your bank from another country.** Roaming fees vanish — pay sats for the minutes you actually use.
- **Book appointments while you sleep.** Push a task, the agent calls, confirms, returns a transcript.
- **Bill negotiation.** Hand the agent your last bill, the counter-offer target, and a willingness range.
- **IVR navigation at scale.** Agents tolerate "press 4 for billing" sequences humans hate.
- **Customer callback automation.** Fire-and-forget outbound calls from automations that don't own a phone system.

---

## Request reference

| Field | Required | Example |
|---|---|---|
| `phone_number` | yes | `"+14155552671"` (E.164) |
| `task` | yes | `"Call Dr. Smith's office and book the earliest appointment..."` |
| `duration_minutes` | no | `5` (default 3, range 1–30) |
| `voice` | no | `"Adrian"` |
| `language` | no | `"en-US"` |
| `begin_message` | no | `"Hi, I'm calling on behalf of a client..."` |
| `refund_address` | no | `"alice@getalby.com"` (Lightning address) |

Full JSON Schema: [sats4ai.com/api/openapi.json](https://sats4ai.com/api/openapi.json) (tag: `ai-call`).

---

## Polling the call

```bash
curl "https://sats4ai.com/api/l402/ai-call?call_id=<call_id>"
```

States: `pending_confirm` → `in_progress` → `retrying` → `completed` | `failed`.

On completion: transcript, call analysis, `task_completed` boolean, disconnection reason.

---

## Compare

| | ai-caller (Sats4AI) | Typical voice agent platform |
|---|---|---|
| Signup required | No | Yes (email + credit card + org verification) |
| Pricing model | Per-call deposit, auto-refund unused minutes | Monthly subscription + per-minute on top |
| Credential | Lightning preimage | API key you have to rotate and protect |
| Ambiguity handling | Agent pushes back before dialing | Runs the call anyway, you pay |
| Language coverage | en-US, es-ES, fr-FR, hi-IN, yo-NG, zh-CN, … | Usually the big-five |
| MCP-native | Yes | No (you integrate manually) |

## Related

- [`book-to-audiobook`](https://github.com/cnghockey/book-to-audiobook) — Turn any book into an audiobook in 600+ languages.
- [`pay-per-use-fax`](https://github.com/cnghockey/pay-per-use-fax) — Send a fax with Lightning, no contract.
- [`fax-to-email`](https://github.com/cnghockey/fax-to-email) — Receive faxes to your inbox, no monthly number rental.
- [`sats4ai-mcp`](https://github.com/cnghockey/sats4ai-mcp-server) — MCP server bundling all 35+ Sats4AI services.
- [`sats4ai-l402-examples`](https://github.com/cnghockey/sats4ai-l402-examples) — Full L402 examples across every service.

## Links

- **Sats4AI homepage** — https://sats4ai.com
- **Developer docs** — https://sats4ai.com/docs
- **OpenAPI spec** — https://sats4ai.com/api/openapi.json
- **L402 protocol reference** — https://sats4ai.com/docs#payment-protocols

## Support / donate
Yes, we gave an AI a phone. Its call etiquette is better than most humans'. We are at peace with it.

If this was useful to you and you like what we do, consider sending a few sats our way:

⚡ **`sats4ai@blink.sv`**

(It's a **Bitcoin Lightning** address: pay it from any Lightning wallet. Looks like an email, isn't one. Lightning sats only: no on-chain, no fiat, no cards, no altcoins, no refunds on gratitude.)

Not this time? That's cool too. We've been there. A star on the repo is a free hug.

## License

MIT — see [LICENSE](LICENSE).

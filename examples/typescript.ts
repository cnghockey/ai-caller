/**
 * ai-caller — TypeScript example (Node 18+).
 *
 * No dependencies — uses built-in fetch and readline.
 *
 * Pay the returned invoice with any Lightning wallet that gives you a preimage
 * (Alby, Phoenix, Zeus, LNBits, etc.), then paste the preimage when prompted.
 *
 * Usage:
 *   npx tsx typescript.ts --phone +14155552671 --task "Confirm reservation for 6pm"
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ENDPOINT = "https://sats4ai.com/api/l402/ai-call";

interface CallBody {
    phone_number: string;
    task: string;
    duration_minutes?: number;
    language?: string;
    voice?: string;
    refund_address?: string;
}

function parseChallenge(header: string): { macaroon: string; invoice: string } {
    const mac = header.match(/macaroon="([^"]+)"/);
    const inv = header.match(/invoice="([^"]+)"/);
    if (!mac || !inv) throw new Error(`Could not parse L402 challenge: ${header}`);
    return { macaroon: mac[1], invoice: inv[1] };
}

async function placeCall(body: CallBody): Promise<void> {
    // Step 1 — request invoice
    const r1 = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (r1.status !== 402) {
        throw new Error(`Expected 402, got ${r1.status}: ${await r1.text()}`);
    }
    const { macaroon, invoice } = parseChallenge(r1.headers.get("www-authenticate") ?? "");

    // Step 2 — pay out-of-band
    console.log("\nPay this invoice with your Lightning wallet:\n");
    console.log(invoice + "\n");
    const rl = readline.createInterface({ input, output });
    const preimage = (await rl.question("preimage (hex): ")).trim();
    rl.close();

    // Step 3 — authenticated call
    const r2 = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `L402 ${macaroon}:${preimage}`,
        },
        body: JSON.stringify(body),
    });
    if (!r2.ok) throw new Error(`Call submission failed: ${r2.status} ${await r2.text()}`);
    const result = await r2.json();
    console.log("\nResponse:", result);

    if (result.state === "pending_confirm") {
        console.log("\nAgent needs clarification. Questions:");
        for (const q of result.questions ?? []) console.log(" -", q);
        // Follow up with: POST { action: "confirm", session_id, answers: {...} }
        return;
    }

    if (!result.call_id) return;

    // Poll until terminal state
    while (true) {
        await new Promise((r) => setTimeout(r, 5000));
        const status = await (await fetch(`${ENDPOINT}?call_id=${result.call_id}`)).json();
        console.log(`  [${status.state}]`);
        if (status.state === "completed" || status.state === "failed") {
            console.log("\nFinal:", status);
            return;
        }
    }
}

function parseArgs(): CallBody {
    const argv = process.argv.slice(2);
    const get = (flag: string): string | undefined => {
        const i = argv.indexOf(flag);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const phone = get("--phone");
    const task = get("--task");
    if (!phone || !task) {
        console.error("Usage: --phone +14155552671 --task \"...\" [--duration-minutes 5] [--language en-US] [--refund-address alice@getalby.com]");
        process.exit(1);
    }
    const body: CallBody = { phone_number: phone, task, duration_minutes: 3, language: "en-US" };
    const dm = get("--duration-minutes");
    if (dm) body.duration_minutes = Number(dm);
    const lang = get("--language");
    if (lang) body.language = lang;
    const refund = get("--refund-address");
    if (refund) body.refund_address = refund;
    return body;
}

placeCall(parseArgs()).catch((err) => {
    console.error(err);
    process.exit(1);
});

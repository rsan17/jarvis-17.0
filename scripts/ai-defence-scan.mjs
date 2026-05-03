#!/usr/bin/env node
// Deterministic PII + prompt-injection scanner. Reads text from stdin, emits
// JSON to stdout. Used by the ai-defence skill (and inbox-triage step 0) to
// flag risky content before it gets injected into a Claude prompt.
//
// Usage:
//   echo "text to scan" | node scripts/ai-defence-scan.mjs
//   cat email-body.txt   | node scripts/ai-defence-scan.mjs
//
// Output:
//   {
//     "riskLevel": "none" | "low" | "medium" | "high",
//     "piiFlags": [{type, masked, offset}],
//     "injectionFlags": [{type, match, severity}],
//     "sanitized": "...",          // PII replaced with <redacted:type>
//     "summary": "human-readable one-liner"
//   }
//
// Exit code is always 0 — caller inspects riskLevel. Non-zero only on input
// read errors.

import { readFileSync } from "node:fs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch (e) {
    process.stderr.write(`ai-defence-scan: failed to read stdin: ${e.message}\n`);
    process.exit(1);
  }
}

// ---------- PII detectors ----------

// Order matters: list high-specificity patterns first so they consume their
// bytes before the greedier ones (phone) scan the residue.
const PII_PATTERNS = [
  {
    type: "api-key",
    // Common provider prefixes. Conservative — only well-known shapes.
    regex:
      /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}|AIza[A-Za-z0-9_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
    mask: (m) => `${m.slice(0, 6)}${"*".repeat(Math.max(m.length - 10, 4))}${m.slice(-4)}`,
  },
  {
    type: "credit-card",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => luhn(m.replace(/\D/g, "")),
    mask: (m) => {
      const digits = m.replace(/\D/g, "");
      return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
    },
  },
  {
    type: "iban",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    mask: (m) => `${m.slice(0, 4)}${"*".repeat(m.length - 8)}${m.slice(-4)}`,
  },
  {
    type: "us-ssn",
    // Only with explicit "SSN" / "social security" context word nearby.
    regex: /(?:SSN|social\s+security[\s#:]*)\D{0,8}(\d{3}-\d{2}-\d{4})/gi,
    mask: () => "***-**-****",
  },
  {
    type: "email",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    mask: (m) => {
      const [local, domain] = m.split("@");
      const head = local.slice(0, 1);
      return `${head}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
    },
  },
  {
    type: "phone",
    // International or local 9-15 digit phone numbers with separators.
    regex:
      /(?<!\d)(\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{2,4}[\s\-.]?\d{2,4}(?:[\s\-.]?\d{1,4})?(?!\d)/g,
    validate: (m) => m.replace(/\D/g, "").length >= 9 && m.replace(/\D/g, "").length <= 15,
    mask: (m) => m.replace(/\d(?=\d{2})/g, "*"),
  },
];

function luhn(digits) {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function scanPII(text) {
  const flags = [];
  // Each pattern scans the progressively-sanitized output of the prior. This
  // prevents specific patterns (api-key, credit-card) from being re-flagged
  // by greedier ones (phone) once their bytes have been replaced with the
  // <redacted:type> marker. Order matters — list specific patterns first.
  let sanitized = text;
  for (const { type, regex, validate, mask } of PII_PATTERNS) {
    const matches = [...sanitized.matchAll(regex)];
    for (const m of matches) {
      const matchText = m[0];
      if (validate && !validate(matchText)) continue;
      const masked = mask(matchText);
      flags.push({ type, masked, offset: m.index });
      sanitized = sanitized.split(matchText).join(`<redacted:${type}>`);
    }
  }
  return { flags, sanitized };
}

// ---------- Prompt-injection detectors ----------

const INJECTION_PATTERNS = [
  {
    type: "instruction-override",
    severity: "high",
    regex:
      /\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above|earlier|the\s+system)\s+(instructions?|rules?|prompts?|messages?)/i,
  },
  {
    type: "system-prompt-injection",
    severity: "high",
    regex: /\b(new\s+(system\s+)?(instructions?|prompt)|system\s+prompt[:\s])/i,
  },
  {
    type: "role-hijack",
    severity: "medium",
    regex: /\byou\s+are\s+now\s+(a\s+|an\s+)?(?:DAN|jailbroken|unrestricted|developer\s+mode|evil)/i,
  },
  {
    type: "developer-mode",
    severity: "medium",
    regex: /\b(developer|debug|admin|god)\s+mode\s+(enabled|on|activated)/i,
  },
  {
    type: "tool-abuse-cue",
    severity: "medium",
    regex: /\b(execute|run|invoke)\s+(the\s+)?(following|this)\s+(command|code|tool|function)\b/i,
  },
  {
    type: "exfiltration-cue",
    severity: "high",
    regex: /\b(send|email|post|forward|upload|leak)\s+(your|the|all)\s+(system\s+prompt|instructions|secrets|api\s+keys|memory)/i,
  },
  {
    type: "html-comment-prompt",
    severity: "high",
    regex: /<!--\s*(prompt|instruction|system)[\s:]/i,
  },
  {
    type: "invisible-unicode",
    severity: "medium",
    // Zero-width space, ZWNJ, ZWJ, RTL/LTR override, BOM
    regex: /[​-‏‪-‮﻿]/,
  },
  {
    type: "markdown-link-payload",
    severity: "medium",
    regex: /\[[^\]]+\]\((?:javascript:|data:text\/html)/i,
  },
  {
    type: "ua-instruction-override",
    severity: "high",
    // \b in JS is ASCII-only — use Unicode-aware boundary instead.
    regex: /(?<![\p{L}])(ігноруй|забудь|відкинь)\s+(всі\s+)?(попередні\s+)?(вищі\s+)?(інструкції|правила|команди|промпт)/iu,
  },
];

function scanInjection(text) {
  const flags = [];
  for (const { type, severity, regex } of INJECTION_PATTERNS) {
    const m = text.match(regex);
    if (m) {
      flags.push({
        type,
        severity,
        match: m[0].slice(0, 80),
      });
    }
  }
  return flags;
}

// ---------- Risk aggregation ----------

function computeRisk(piiFlags, injectionFlags) {
  const hasHighInjection = injectionFlags.some((f) => f.severity === "high");
  const hasMediumInjection = injectionFlags.some((f) => f.severity === "medium");
  const piiTypes = new Set(piiFlags.map((f) => f.type));

  if (hasHighInjection || piiTypes.size >= 2) return "high";
  if (hasMediumInjection || piiTypes.size === 1) return "medium";
  if (piiFlags.length || injectionFlags.length) return "low";
  return "none";
}

function summarize(riskLevel, piiFlags, injectionFlags) {
  const parts = [];
  if (piiFlags.length) {
    const types = [...new Set(piiFlags.map((f) => f.type))].join(", ");
    parts.push(`${piiFlags.length} PII (${types})`);
  }
  if (injectionFlags.length) {
    const types = injectionFlags.map((f) => f.type).join(", ");
    parts.push(`${injectionFlags.length} injection (${types})`);
  }
  if (!parts.length) return "clean";
  return `risk=${riskLevel} — ${parts.join("; ")}`;
}

// ---------- Main ----------

const text = readStdin();
const { flags: piiFlags, sanitized } = scanPII(text);
const injectionFlags = scanInjection(text);
const riskLevel = computeRisk(piiFlags, injectionFlags);

process.stdout.write(
  JSON.stringify(
    {
      riskLevel,
      piiFlags,
      injectionFlags,
      sanitized,
      summary: summarize(riskLevel, piiFlags, injectionFlags),
    },
    null,
    2,
  ) + "\n",
);

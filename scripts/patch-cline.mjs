#!/usr/bin/env node
// cline-build — apply the musl libc patch to a Cline checkout.
//
// Usage: node scripts/patch-cline.mjs <cline-checkout>
//
// The only source change a musl build needs is baking OPENTUI_LIBC=musl into
// the compiled binary: OpenTUI picks its native library from that variable at
// runtime and defaults to glibc, so a musl binary would load the glibc one and
// die in the loader — and a compiled binary cannot be re-pointed afterwards.
//
// This is done as an anchored insertion rather than `git apply` on
// patches/opentui-musl-libc.patch (which is the same change, kept for review):
// the upstream file moves, and a failed hunk with a line number is a worse
// diagnostic than "the line this inserts before is gone". Both forms fail
// loudly; neither silently builds a glibc binary under a musl name.
//
// Idempotent: a checkout that already carries the change is left alone.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) {
	console.error("usage: node scripts/patch-cline.mjs <cline-checkout>");
	process.exit(2);
}

const file = join(root, "apps/cli/script/compile-binary.ts");

// Anchored on the last define entry upstream adds before the telemetry ones.
const anchor = "\t\t\t\t// Inline telemetry/OTEL env vars at build time so the compiled\n";

const insertion =
	"\t\t\t\t// OpenTUI selects its native library from OPENTUI_LIBC at runtime and\n" +
	"\t\t\t\t// defaults to glibc; a musl build would load the glibc one and die in\n" +
	"\t\t\t\t// the loader. A compiled binary cannot be re-pointed afterwards, so\n" +
	"\t\t\t\t// the target libc is baked in here.\n" +
	'\t\t\t\t...(input.bunTarget.includes("-musl")\n' +
	'\t\t\t\t\t? { "process.env.OPENTUI_LIBC": JSON.stringify("musl") }\n' +
	"\t\t\t\t\t: {}),\n";

const source = readFileSync(file, "utf8");

if (source.includes('"process.env.OPENTUI_LIBC"')) {
	console.log(`${file}: already carries the musl libc patch`);
	process.exit(0);
}

if (source.split(anchor).length !== 2) {
	console.error(
		`${file}: the anchor this patch inserts before is missing or duplicated.\n` +
			"Upstream changed the define block; refresh the anchor in\n" +
			"scripts/patch-cline.mjs and patches/opentui-musl-libc.patch.\n" +
			`anchor: ${JSON.stringify(anchor)}`,
	);
	process.exit(1);
}

writeFileSync(file, source.replace(anchor, insertion + anchor));
console.log(`${file}: musl libc patch applied`);

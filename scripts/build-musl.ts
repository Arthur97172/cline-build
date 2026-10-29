#!/usr/bin/env bun
// cline-build — compile @cline/cli for musl (x64 and arm64).
//
// Usage: bun run scripts/build-musl.ts <cline-checkout> <out-dir>
//
// Runs from *outside* the upstream checkout: the compile entrypoint is imported
// by absolute path, so this repository never has to be copied into cline/cline.
// The steps mirror apps/cli/script/build.ts (SDK build, OpenTUI native
// variants, compileCliBinary) with the target list narrowed to the two musl
// builds and the package-writing part of that script left out — npm packages
// are upstream's job; these are loose binaries for luci-app-fcc to fetch.
//
// Outputs, all in <out-dir>: cli-linux-x64-musl, cli-linux-arm64-musl,
// SHA256SUMS, manifest.json, RELEASE_NOTES.md.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { $ } from "bun";

const [srcArg, outArg] = process.argv.slice(2);
if (!srcArg || !outArg) {
	console.error("usage: bun run scripts/build-musl.ts <cline-checkout> <out-dir>");
	process.exit(2);
}

const src = resolve(srcArg);
const out = resolve(outArg);
const cliDir = join(src, "apps/cli");
const compileEntry = join(cliDir, "script/compile-binary.ts");

if (!existsSync(compileEntry)) {
	console.error(`${src}: not a cline/cline checkout (missing apps/cli)`);
	process.exit(2);
}

// The patch is a precondition, not something this script applies: silently
// building a glibc-targeted binary under a musl name is the one failure mode
// that would ship. Bail out before spending 10 minutes on bun install.
const compileSource = readFileSync(compileEntry, "utf8");
if (!compileSource.includes('"process.env.OPENTUI_LIBC"')) {
	console.error(`${compileEntry}: the musl libc patch is not applied — run scripts/patch-cline.mjs first`);
	process.exit(1);
}

const targets = [
	{ bunTarget: "bun-linux-x64-musl", asset: "cli-linux-x64-musl" },
	{ bunTarget: "bun-linux-arm64-musl", asset: "cli-linux-arm64-musl" },
] as const;

const version: string = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8")).version;
console.log(`Building @cline/cli v${version} for musl`);

// compile-binary.ts resolves its own paths from import.meta, but the SDK build
// and the OpenTUI variant install are run from the tree's own package scripts
// and expect the CLI directory as the working directory, exactly as upstream's
// build.ts sets it.
process.chdir(cliDir);

const compile = await import(pathToFileURL(compileEntry).href);

// The CLI bundles workspace packages, so the SDK dist has to exist before the
// binary is compiled; compileCliBinary embeds sdk/packages/core/dist as assets.
console.log("Building SDK packages...");
await $`bun run build:sdk`.cwd(src);

console.log("Building CLI bundle...");
await $`bun -F @cline/cli build`.cwd(src);

// A cross-compiled build cannot resolve @opentui/core's FFI layer from the
// host's native package alone; upstream installs every platform variant first.
await compile.installOpenTuiNativeVariants();

mkdirSync(out, { recursive: true });

const files: { name: string; sha256: string; size: number }[] = [];

for (const target of targets) {
	console.log(`\nCompiling ${target.asset} (${target.bunTarget})...`);
	const outfile = join(out, target.asset);
	await compile.compileCliBinary({ bunTarget: target.bunTarget, outfile });
	const bytes = readFileSync(outfile);
	files.push({
		name: target.asset,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		size: bytes.length,
	});
	console.log(`  ${target.asset}: ${(bytes.length / 1024 / 1024).toFixed(1)} MiB sha256=${files.at(-1)!.sha256}`);
}

function git(args: string[]): string {
	try {
		return new TextDecoder()
			.decode(Bun.spawnSync(["git", "-C", src, ...args]).stdout)
			.trim();
	} catch {
		return "";
	}
}

const commit = git(["rev-parse", "HEAD"]);
const tag = process.env.CLINE_TAG || git(["describe", "--tags", "--exact-match", "HEAD"]);

writeFileSync(
	join(out, "SHA256SUMS"),
	files.map((f) => `${f.sha256}  ${f.name}\n`).join(""),
);

writeFileSync(
	join(out, "manifest.json"),
	JSON.stringify(
		{
			package: "@cline/cli",
			version,
			upstream_tag: tag,
			upstream_commit: commit,
			untrusted_patch: "opentui-musl-libc",
			bun: Bun.version,
			built_at: new Date().toISOString(),
			files,
		},
		null,
		2,
	) + "\n",
);

writeFileSync(
	join(out, "RELEASE_NOTES.md"),
	`# Cline CLI ${version} — unofficial musl build

Built from cline/cline \`${tag || commit}\` (${commit}) with
\`patches/opentui-musl-libc.patch\`, which bakes \`OPENTUI_LIBC=musl\` into the
compiled binary.

Assets:

| asset | for |
| --- | --- |
| \`cli-linux-x64-musl\` | x86_64 musl (OpenWrt x86, Alpine) |
| \`cli-linux-arm64-musl\` | aarch64 musl (OpenWrt arm64) |
| \`SHA256SUMS\` | checksums of both |
| \`manifest.json\` | version, upstream commit, checksums |

**These are not official Cline builds.** cline/cline is Apache-2.0; see its
LICENSE, shipped with this release. Cline publishes no musl build as of
${version} (cline/cline#15271, patch offered in cline/cline#15328); this
repository exists so musl systems can run the CLI in the meantime.

Runtime needs \`libstdc++\` (OpenWrt package \`libstdcpp6\`) on the target.
These builds carry no telemetry keys — upstream's publish workflow injects
them from secrets at build time and this one does not.
`,
);

console.log(`\nWrote ${out}: ${files.map((f) => f.name).join(", ")}, SHA256SUMS, manifest.json`);
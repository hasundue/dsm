import {
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.159.0/testing/asserts.ts";
import { $, CommandBuilder } from "https://deno.land/x/dax@0.13.0/mod.ts";

const isWindows = Deno.build.os === "windows";
const cwd = Deno.cwd();
const commandBuilder = new CommandBuilder();

async function installScripts(specs: [name: string, url: string][]) {
  for (const spec of specs) {
    await $`deno install -A --root . --name ${spec[0]} ${spec[1]}`.text();
  }
}

async function createTestEnv() {
  await installScripts([
    ["nublar", "https://deno.land/x/nublar/nublar.ts"],
    ["udd", "https://deno.land/x/udd@0.5.0/main.ts"],
  ]);
  await $`touch bin/deno`;
}

function withTestEnv(
  name: string,
  fn: () => void | Promise<void>,
) {
  Deno.test(name, async () => {
    const tempDir = Deno.makeTempDirSync();
    try {
      Deno.chdir(tempDir);
      await createTestEnv();
      await fn();
    } finally {
      Deno.chdir(cwd);
      Deno.removeSync(tempDir, { recursive: true });
    }
  });
}

async function nublar(args: string) {
  return await commandBuilder
    .command(`deno run -A ${cwd}/nublar.ts ${args}`)
    .text();
}

withTestEnv("createTestEnv", async () => {
  const expected = isWindows
    ? ["deno", "nublar", "nublar.cmd", "udd", "udd.cmd"]
    : ["deno", "nublar", "udd"];
  assertEquals(
    await $`ls bin`.lines(),
    expected,
  );
});

withTestEnv("nublar", async () => {
  assertMatch(
    await nublar("--help"),
    /nublar/,
  );
});

withTestEnv("list", async () => {
  const result = await nublar("list --root .");
  assertMatch(result, /nublar/);
  assertMatch(result, /udd/);
  assertNotMatch(result, /deno/);
});

withTestEnv("update --check", async () => {
  const result = await nublar("update --root . --check");
  assertNotMatch(result, /nublar/);
  assertMatch(result, /udd/);
});

withTestEnv("update --check udd", async () => {
  const result = await nublar("update --root . --check udd");
  assertNotMatch(result, /nublar/);
  assertMatch(result, /udd/);
});

withTestEnv("update --check nublar", async () => {
  const result = await nublar("update --root . --check nublar");
  assertNotMatch(result, /nublar/);
  assertNotMatch(result, /udd/);
});

withTestEnv("update", async () => {
  const result = await nublar("update --root .");
  assertNotMatch(result, /nublar/);
  assertMatch(result, /udd/);
});

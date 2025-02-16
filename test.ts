import {
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { $, CommandBuilder } from "https://deno.land/x/dax@0.39.2/mod.ts";

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
    ["udd", "https://deno.land/x/udd@0.5.0/main.ts"], // @denopendabot ignore
  ]);
  await $`touch bin/deno`;
}

function withTestEnv(
  name: string,
  fn: () => void | Promise<void>,
) {
  Deno.test(name, async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      Deno.chdir(tempDir);
      await createTestEnv();
      await fn();
    } finally {
      Deno.chdir(cwd);
      await Deno.remove(tempDir, { recursive: true });
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
  assertMatch(result, /nublar/);
  assertMatch(result, /udd/);
});

withTestEnv("update --check udd", async () => {
  const result = await nublar("update --root . --check udd");
  assertNotMatch(result, /nublar/);
  assertMatch(result, /udd/);
});

withTestEnv("update --check nublar", async () => {
  const result = await nublar("update --root . --check nublar");
  assertMatch(result, /nublar/);
  assertNotMatch(result, /udd/);
});

withTestEnv("update", async () => {
  const result = await nublar("update --root .");
  assertMatch(result, /nublar/);
  assertMatch(result, /udd/);
});

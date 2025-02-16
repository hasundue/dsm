import { join, resolve } from "https://deno.land/std@0.224.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { Command } from "https://deno.land/x/cliffy@v0.25.7/command/mod.ts";
import { Table } from "https://deno.land/x/cliffy@v0.25.7/table/mod.ts";
import dir from "https://deno.land/x/dir@1.5.2/mod.ts";
import {
  DependencyKind,
  DependencySpec,
  stringify,
} from "jsr:@molt/core@0.19.8/specs";
import { get } from "jsr:@molt/core@0.19.0/updates";
import { assert } from "jsr:@std/assert@1";

new Command()
  .name("nublar")
  .version("0.5.0") // @denopendabot hasundue/nublar
  .description(
    "A command-line tool to manage your Deno scripts installed via `deno install`.",
  )
  .action(function () {
    this.showHelp();
  })
  .command(
    "list",
    "List installed scripts.",
  )
  .option("--root <path>", "Specify an installation root of scripts.")
  .action((options) => list(options))
  .command(
    "update [scripts...]",
    "Update scripts.",
  )
  .option("--root <path>", "Installation root of scripts.")
  .option("-d, --check", "Don't actually update.")
  .action((options, ...scripts) => update(scripts, options))
  .parse();

interface GlobalOptions {
  root?: string;
}

// ref: https://deno.land/manual@v1.25.4/tools/script_installer
async function getRoot(options: GlobalOptions) {
  const home = dir("home");
  const dotdeno = home ? join(home, ".deno") : undefined;
  const root = options?.root ?? Deno.env.get("DENO_INSTALL_ROOT") ?? dotdeno;
  if (!root) {
    console.error("Installation root is not defined");
    Deno.exit(1);
  } else {
    await ensureDir(root);
    return root;
  }
}

async function getScriptDir(options: GlobalOptions) {
  const scriptDir = join(await getRoot(options), "bin");
  await ensureDir(scriptDir);
  return scriptDir;
}

type Script = {
  name: string;
  path: string;
  content: string;
  url?: URL;
  version?: string;
};

function parseUrls(content: string): string[] {
  const urls: string[] = [];
  // match jsr or http pkgs
  const regexp = /(https?:[^\'\"]+|jsr:@[^\'\"]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regexp.exec(content))) {
    urls.push(match[0]);
  }
  return urls;
}

async function getScriptList(options: GlobalOptions) {
  const scriptDir = await getScriptDir(options);
  const scripts: Script[] = [];
  for await (const entry of Deno.readDir(resolve(scriptDir))) {
    if (entry.name === "deno" || entry.name.startsWith(".")) {
      continue;
    }
    const path = join(scriptDir, entry.name);
    const content = await Deno.readTextFile(path);
    const urls = parseUrls(content);
    if (urls.length === 0) {
      scripts.push({
        name: entry.name,
        path,
        content,
      });
      continue;
    }
    if (urls.length > 1) {
      console.warn(`More than one importable URLs found in ${path}`);
    }
    const url = new URL(urls[0]);
    scripts.push({
      name: entry.name,
      version: parse(urls[0]).constraint,
      url,
      path,
      content,
    });
  }
  return scripts;
}

async function list(options: GlobalOptions) {
  const scripts = await getScriptList(options);
  const table = Table.from(
    scripts.map((script) => [script.name, script.version])
      // give scripts with definied version a higher priority
      .sort(([_n1, _v1], [_n2, v2]) => v2 ? 1 : -1),
  );
  console.log(table.toString());
}

type UpdateOptions = GlobalOptions & {
  check?: boolean;
};

async function update(
  scriptNames: string[],
  options: UpdateOptions,
): Promise<void> {
  const all = await getScriptList(options);
  const scripts = scriptNames.length
    ? all.filter((script) => scriptNames.includes(script.name))
    : all;
  let found = false;
  for (const script of scripts) {
    if (!script.url) {
      continue;
    }

    const current = parse(script.url.href);
    const latest = await get(current);

    const latestVersion = latest?.released ?? latest?.constrainted;
    if (latestVersion && (latestVersion !== current.constraint)) {
      found = true;
      const action = options.check ? "Found" : "Updated";
      console.log(
        `${action} ${script.name} ${script.version} => ${latestVersion}`,
      );
      if (!options.check) {
        const content = script.content.replace(
          script.url.href,
          stringify({ ...current, constraint: latestVersion }),
        );
        await Deno.writeTextFile(script.path, content);
      }
    }
  }
  if (!found) {
    console.log("No updates found.");
  }
}

const isKind = (kind: string): kind is DependencyKind =>
  ["jsr", "npm", "http", "https"].includes(kind);
export function parse(specifier: string): DependencySpec {
  const url = new URL(specifier);

  const kind = url.protocol.slice(0, -1);
  assert(isKind(kind), `Invalid protocol: ${kind}:`);

  const body = url.hostname + url.pathname;

  // best effort to match name and path if version is not specified
  if (!body.match(/@\d+/)) {
    if (body.startsWith("deno.land/std/")) {
      return {
        kind,
        name: "deno.land/std",
        path: body.replace("deno.land/std", ""),
        constraint: "",
      };
    }
    if (body.startsWith("deno.land/x/")) {
      return {
        kind,
        name: "deno.land/x",
        path: body.replace("deno.land/x", ""),
        constraint: "",
      };
    }
    return { kind, name: body, constraint: "" };
  }

  // Try to find a path segment like "<name>@<version>/"
  const matched = body.match(
    /^(?<name>.+)@(?<constraint>[^/]+)(?<path>\/.*)?$/,
  );
  if (!matched) {
    throw new Error(`Could not parse dependency: ${specifier}`);
  }
  const { name, constraint, path } = matched.groups as {
    name: string;
    constraint: string;
    path?: string;
  };
  return path ? { kind, name, constraint, path } : { kind, name, constraint };
}

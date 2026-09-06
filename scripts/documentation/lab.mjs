#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only

/** Runs documentation scenarios against an isolated, committed app snapshot. */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stateRoot = join(repository, ".documentation-labs");
const owner = createHash("sha256").update(repository).digest("hex").slice(0, 8);
const [command, name, ...options] = process.argv.slice(2);
const commands = new Set(["create", "up", "seed", "status", "stop", "destroy"]);

function fail(message) {
  throw new Error(message);
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

// Deployment variables in the caller's shell must not select another database,
// storage service, mail relay, or Docker context for this disposable instance.
const childEnvironment = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR"].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]],
  ),
);

function read(command, args, cwd = repository) {
  return execFileSync(command, args, { cwd, env: childEnvironment, encoding: "utf8" }).trim();
}

async function run(command, args, cwd = repository, extraEnvironment = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...childEnvironment, ...extraEnvironment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed (${signal ?? code}).`)),
    );
  });
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Loopback port ${port} is already in use.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

function assertDirectory(path) {
  if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()))
    fail(`Expected an owned directory: ${path}`);
}

function snapshotDigest(root) {
  const hash = createHash("sha256");
  function visit(relative) {
    for (const entry of readdirSync(join(root, relative)).sort()) {
      const name = join(relative, entry);
      if (name === ".env") continue;
      const path = join(root, name);
      const stat = lstatSync(path);
      hash.update(`${name}\0${stat.mode & 0o777}\0`);
      if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(path)}`);
      else if (stat.isDirectory()) visit(name);
      else if (stat.isFile()) hash.update(readFileSync(path));
      else fail(`Unsupported snapshot entry: ${name}`);
    }
  }
  visit("");
  return hash.digest("hex");
}

function configurationDigest(directory) {
  const hash = createHash("sha256");
  for (const relative of ["source/.env", "overlay.json"]) {
    const path = join(directory, relative);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
      fail("Lab configuration must be an owned regular file.");
    hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

async function main() {
  if (!commands.has(command) || !/^[a-z][a-z0-9-]{0,23}$/.test(name ?? "")) {
    fail(
      "Usage: node scripts/documentation/lab.mjs create|up|seed|status|stop|destroy <name> " +
        "[create only: --commit <revision> --app-port <port> --mail-port <port>]",
    );
  }
  assertDirectory(stateRoot);
  const directory = join(stateRoot, name);
  assertDirectory(directory);
  const source = join(directory, "source");
  const manifestPath = join(directory, "lab.json");
  const project = `openlaw-docs-${owner}-${name}`;
  const docker = ["--context", "default"];
  const compose = [
    ...docker,
    "compose",
    "--project-name",
    project,
    "--env-file",
    join(source, ".env"),
    "--file",
    join(source, "compose.yml"),
    "--file",
    join(directory, "overlay.json"),
  ];
  const endpoint = JSON.parse(read("docker", [...docker, "context", "inspect", "default"]))[0]
    ?.Endpoints?.docker?.Host;
  if (!endpoint?.startsWith("unix://"))
    fail("The default Docker context must be a local Unix socket.");

  if (command === "create") {
    if (existsSync(directory)) fail(`Lab ${name} already exists; choose another name.`);
    const config = { commit: "HEAD", "app-port": "43300", "mail-port": "48425" };
    for (let index = 0; index < options.length; index += 2) {
      const key = options[index]?.replace(/^--/, "");
      const value = options[index + 1];
      if (!Object.hasOwn(config, key) || value === undefined) fail("Unknown or incomplete option.");
      config[key] = value;
    }
    const appPort = Number(config["app-port"]);
    const mailPort = Number(config["mail-port"]);
    for (const port of [appPort, mailPort])
      if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("Ports must be 1024–65535.");
    if (appPort === mailPort) fail("App and mail ports must differ.");
    await assertPortFree(appPort);
    await assertPortFree(mailPort);
    const commit = read("git", [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${config.commit}^{commit}`,
    ]);
    if (!/^[a-f0-9]{40}$/.test(commit)) fail("Expected a full commit identity.");
    const existing = read("docker", [
      ...docker,
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ]);
    if (existing) fail("Containers already use the proposed project name.");
    for (const resource of ["volume", "network"])
      if (
        read("docker", [
          ...docker,
          resource,
          "ls",
          "-q",
          "--filter",
          `label=com.docker.compose.project=${project}`,
        ])
      )
        fail(`Existing ${resource} resources use the proposed project name.`);
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    mkdirSync(directory, { mode: 0o700 });
    try {
      mkdirSync(source, { mode: 0o700 });
      const archive = join(directory, "source.tar");
      await run("git", ["archive", "--format=tar", "--output", archive, commit]);
      await run("tar", ["-xf", archive, "-C", source]);
      rmSync(archive);
      writeFileSync(
        join(source, ".env"),
        [
          `AUTH_SECRET=${randomBytes(32).toString("base64")}`,
          `OPENLAW_SECRET_KEY=${randomBytes(32).toString("base64")}`,
          `PORT=127.0.0.1:${appPort}`,
          `BASE_URL=http://127.0.0.1:${appPort}`,
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      const appImage = `${project}-app:${commit.slice(0, 12)}`;
      const engineImage = `${project}-engine:${commit.slice(0, 12)}`;
      const mail = { SMTP_URL: "smtp://mailpit:1025", SMTP_FROM: "OpenLaw <legal@helix.example>" };
      writeJson(join(directory, "overlay.json"), {
        services: {
          app: { image: appImage, environment: { ...mail, AUTH_RATE_LIMIT: "off" } },
          worker: { image: appImage, environment: mail },
          "doc-engine": { image: engineImage },
          mailpit: {
            image: "axllent/mailpit:v1.30",
            networks: ["openlaw-backend"],
            ports: [`127.0.0.1:${mailPort}:8025`],
          },
        },
      });
      writeJson(manifestPath, {
        schemaVersion: 1,
        owner,
        name,
        project,
        sourceCommit: commit,
        snapshotDigest: snapshotDigest(source),
        configurationDigest: configurationDigest(directory),
        createdAt: new Date().toISOString(),
        appPort,
        mailPort,
        appUrl: `http://127.0.0.1:${appPort}`,
        mailUrl: `http://127.0.0.1:${mailPort}`,
        appImage,
        engineImage,
        seed: null,
      });
    } catch (error) {
      try {
        rmSync(directory, { recursive: true });
      } catch (cleanupError) {
        console.error(`Could not remove partial lab ${name}: ${cleanupError.message}`);
      }
      throw error;
    }
    console.log(
      `Created ${name} from ${commit}. Run up, then seed when a populated lab is needed.`,
    );
    return;
  }

  if (options.length) fail("Only create accepts options.");
  if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink())
    fail("No owned lab manifest.");
  const lab = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (lab.owner !== owner || lab.name !== name || lab.project !== project)
    fail("Lab ownership mismatch.");
  assertDirectory(source);
  if (configurationDigest(directory) !== lab.configurationDigest)
    fail(
      "Lab configuration was modified; restore its recorded configuration before using this helper.",
    );
  if (snapshotDigest(source) !== lab.snapshotDigest)
    fail("The committed source snapshot was modified; restore it before using this helper.");
  if (command === "up" || command === "seed") {
    if (
      !/^[a-f0-9]{40}$/.test(lab.sourceCommit) ||
      lab.appImage !== `${project}-app:${lab.sourceCommit.slice(0, 12)}` ||
      lab.engineImage !== `${project}-engine:${lab.sourceCommit.slice(0, 12)}` ||
      !Number.isInteger(lab.appPort) ||
      !Number.isInteger(lab.mailPort) ||
      lab.appUrl !== `http://127.0.0.1:${lab.appPort}` ||
      lab.mailUrl !== `http://127.0.0.1:${lab.mailPort}`
    )
      fail("Unexpected lab image or endpoint metadata.");
  }
  if (command === "up") {
    for (const [image, dockerfile] of [
      [lab.appImage, "Dockerfile"],
      [lab.engineImage, "services/doc-engine/Dockerfile"],
    ]) {
      await run("docker", [
        ...docker,
        "build",
        "--tag",
        image,
        "--label",
        `org.opencontainers.image.revision=${lab.sourceCommit}`,
        "--file",
        join(source, dockerfile),
        source,
      ]);
    }
    await run("docker", [
      ...compose,
      "up",
      "--detach",
      "--no-build",
      "--wait",
      "--wait-timeout",
      "180",
    ]);
    lab.appImageId = read("docker", [
      ...docker,
      "image",
      "inspect",
      lab.appImage,
      "--format",
      "{{.Id}}",
    ]);
    lab.engineImageId = read("docker", [
      ...docker,
      "image",
      "inspect",
      lab.engineImage,
      "--format",
      "{{.Id}}",
    ]);
    const containers = read("docker", [...compose, "ps", "--quiet"])
      .split("\n")
      .filter(Boolean);
    lab.containerImages = containers.map((container) => {
      const [service, imageId] = read("docker", [
        ...docker,
        "inspect",
        "--format",
        '{{index .Config.Labels "com.docker.compose.service"}} {{.Image}}',
        container,
      ]).split(" ");
      return { service, imageId };
    });
    lab.startedAt = new Date().toISOString();
    writeJson(manifestPath, lab);
    console.log(`Lab ${name}: ${lab.appUrl}; mail: ${lab.mailUrl}`);
  } else if (command === "seed") {
    const response = await fetch(`${lab.appUrl}/api/v1/auth/setup`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || !(await response.json()).needsSetup)
      fail("Seed requires this lab to be empty.");
    lab.seed = {
      status: "running",
      scale: "light",
      randomSeed: 7,
      startedAt: new Date().toISOString(),
      ai: "disabled",
      signing: "unconfigured",
    };
    writeJson(manifestPath, lab);
    try {
      await run(
        process.execPath,
        [
          join(source, "scripts/seed/index.mjs"),
          "--scale",
          "light",
          "--seed",
          "7",
          "--skip-ai",
          "--only-if-empty",
          "--wait",
        ],
        source,
        {
          SEED_BASE_URL: lab.appUrl,
          SEED_MAILPIT_URL: lab.mailUrl,
          SEED_SMTP_URL: "smtp://mailpit:1025",
        },
      );
      lab.seed.status = "complete";
      lab.seed.completedAt = new Date().toISOString();
    } catch (error) {
      lab.seed.status = "failed";
      throw error;
    } finally {
      writeJson(manifestPath, lab);
    }
    console.log(`Seeded lab ${name}: ${lab.appUrl}; mail: ${lab.mailUrl}`);
  } else if (command === "status") {
    console.log(
      `${lab.name}: ${lab.appUrl}; source ${lab.sourceCommit}; seed ${lab.seed?.status ?? "not-run"}`,
    );
    await run("docker", [...compose, "ps"]);
  } else if (command === "stop") {
    await run("docker", [...compose, "stop"]);
  } else if (command === "destroy") {
    await run("docker", [...compose, "down", "--volumes"]);
    rmSync(directory, { recursive: true });
    console.log(`Destroyed owned lab ${name}; locally built images remain in the Docker cache.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

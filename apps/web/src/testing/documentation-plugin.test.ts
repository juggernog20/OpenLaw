// SPDX-License-Identifier: AGPL-3.0-only
import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { Plugin } from "vite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentation } from "../../vite-documentation";
import {
  compileWorkspace,
  exportFiles,
  repository,
} from "../../../../scripts/documentation/build.mjs";

vi.mock("../../../../scripts/documentation/build.mjs", () => ({
  compileWorkspace: vi.fn(),
  exportFiles: vi.fn(),
  repository: "/workspace",
}));

function call(plugin: Plugin, name: keyof Plugin, ...args: unknown[]) {
  const hook = plugin[name];
  if (typeof hook !== "function") throw new Error(`Missing hook: ${name}`);
  return Reflect.apply(hook, {}, args);
}

function setup() {
  const plugin = documentation();
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
  const middleware = vi.fn();
  const moduleGraph = {
    getModuleById: vi.fn((id: string) => ({ id })),
    invalidateModule: vi.fn(),
  };
  call(plugin, "buildStart");
  call(plugin, "configureServer", {
    watcher,
    moduleGraph,
    ws: { send: vi.fn() },
    middlewares: { use: middleware },
  });
  return { plugin, watcher, middleware, moduleGraph };
}

function failRebuild(watcher: EventEmitter) {
  vi.mocked(compileWorkspace).mockImplementationOnce(() => {
    throw new Error("ENOENT: source file temporarily missing during checkout");
  });
  watcher.emit("change", join(repository, "docs/documentation/edition.json"));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(compileWorkspace).mockReturnValue({
    bundle: { articles: [], contexts: [], bindings: [] },
  } as unknown as ReturnType<typeof compileWorkspace>);
  vi.mocked(exportFiles).mockReturnValue(new Map([["index.html", "Recovered documentation"]]));
});

describe("documentation development build recovery", () => {
  it.each(["virtual:openlaw-documentation", "virtual:openlaw-help-metadata"])(
    "retries a failed build when %s is requested",
    (id) => {
      const { plugin, watcher, moduleGraph } = setup();
      failRebuild(watcher);
      expect(moduleGraph.invalidateModule).toHaveBeenCalledTimes(2);
      expect(call(plugin, "load", `\0${id}`)).toContain("export default");
      expect(compileWorkspace).toHaveBeenCalledTimes(3);
      call(plugin, "load", `\0${id}`);
      expect(compileWorkspace).toHaveBeenCalledTimes(3);
    },
  );

  it("keeps rejecting invalid documentation until compilation succeeds", () => {
    const { plugin, watcher } = setup();
    failRebuild(watcher);
    vi.mocked(compileWorkspace).mockImplementationOnce(() => {
      throw new Error("Invalid documentation");
    });
    expect(() => call(plugin, "load", "\0virtual:openlaw-documentation")).toThrow(
      "Invalid documentation",
    );
    expect(call(plugin, "load", "\0virtual:openlaw-documentation")).toContain("export default");
  });

  it("recovers the standalone export on the next request", () => {
    const { watcher, middleware } = setup();
    failRebuild(watcher);
    const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
    middleware.mock.calls[0]![0]({ url: "/documentation-export/" }, response, vi.fn());
    expect(response.statusCode).toBe(200);
    expect(response.end).toHaveBeenCalledWith("Recovered documentation");
    expect(compileWorkspace).toHaveBeenCalledTimes(3);
  });
});

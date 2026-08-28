// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DES-017 commit state machine on its own, without a screen around
 * it: the note moves saving, then saved or error; a refusal carries its
 * detail and type back to the caller; a text box commits only what
 * changed, reverts what is empty and required, and sends once when
 * Enter and blur both ask.
 */

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFieldCommit, useRowCommit, type CommitAnswer } from "./field-commit";

type Key = "title" | "description";

/** An answer the test releases by hand, to observe the in-flight state. */
function deferred<T>() {
  let resolve!: (answer: CommitAnswer<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<CommitAnswer<T>>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useFieldCommit", () => {
  it("notes saving during the request, then saved, and adopts the answer", async () => {
    const { result } = renderHook(() => useFieldCommit<Key>());
    const answer = deferred<{ title: string }>();
    const adopt = vi.fn();

    let outcome: Promise<unknown>;
    act(() => {
      outcome = result.current.commit("title", () => answer.promise, adopt);
    });
    expect(result.current.status.title).toBe("saving");

    await act(async () => {
      answer.resolve({ data: { title: "Renamed" } });
      await outcome;
    });
    expect(result.current.status.title).toBe("saved");
    expect(result.current.error.title).toBeUndefined();
    expect(adopt).toHaveBeenCalledWith({ title: "Renamed" });
    await expect(outcome!).resolves.toEqual({ ok: true });
  });

  it("notes a refusal beside the field and returns its detail and type", async () => {
    const { result } = renderHook(() => useFieldCommit<Key>());
    const adopt = vi.fn();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.commit(
        "title",
        async () => ({
          error: { type: "urn:openlaw:problem:soft-gate", detail: "Two approvals are pending." },
        }),
        adopt,
      );
    });
    expect(result.current.status.title).toBe("error");
    expect(result.current.error.title).toBe("Two approvals are pending.");
    expect(adopt).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: false,
      detail: "Two approvals are pending.",
      type: "urn:openlaw:problem:soft-gate",
    });
  });

  it("treats a rejected request as an error with no detail", async () => {
    const { result } = renderHook(() => useFieldCommit<Key>());

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.commit("title", () => Promise.reject(new Error("offline")));
    });
    expect(result.current.status.title).toBe("error");
    expect(result.current.error.title).toBeUndefined();
    expect(outcome).toEqual({ ok: false, detail: undefined, type: undefined });
  });

  it("treats an answer with no body and no error (a 204) as saved", async () => {
    const { result } = renderHook(() => useFieldCommit<Key>());
    await act(async () => {
      await result.current.commit("title", async () => ({}));
    });
    expect(result.current.status.title).toBe("saved");
  });

  it("keeps one field's note apart from another's", async () => {
    const { result } = renderHook(() => useFieldCommit<Key>());
    await act(async () => {
      await result.current.commit("title", async () => ({ data: {} }));
      await result.current.commit("description", async () => ({ error: { detail: "No." } }));
    });
    expect(result.current.status).toEqual({ title: "saved", description: "error" });
    expect(result.current.error).toEqual({ title: undefined, description: "No." });
  });

  it("lets a screen note a field by hand", () => {
    const { result } = renderHook(() => useFieldCommit<Key>());
    act(() => result.current.note("description", "error", "Enter this as a number."));
    expect(result.current.status.description).toBe("error");
    expect(result.current.error.description).toBe("Enter this as a number.");
    act(() => result.current.note("description", "idle"));
    expect(result.current.status.description).toBe("idle");
    expect(result.current.error.description).toBeUndefined();
  });

  describe("commitText", () => {
    it("sends the trimmed draft when it differs from the saved value", () => {
      const { result } = renderHook(() => useFieldCommit<Key>());
      const send = vi.fn();
      const reset = vi.fn();
      result.current.commitText("title", { draft: "  Renamed ", saved: "Old", reset, send });
      expect(send).toHaveBeenCalledWith("Renamed");
      expect(reset).not.toHaveBeenCalled();
    });

    it("reverts without sending when the draft matches the saved value", () => {
      const { result } = renderHook(() => useFieldCommit<Key>());
      const send = vi.fn();
      const reset = vi.fn();
      result.current.commitText("title", { draft: "Old ", saved: "Old", reset, send });
      expect(send).not.toHaveBeenCalled();
      expect(reset).toHaveBeenCalledWith("Old");
    });

    it("reverts an empty draft on a required field", () => {
      const { result } = renderHook(() => useFieldCommit<Key>());
      const send = vi.fn();
      const reset = vi.fn();
      result.current.commitText("title", {
        draft: "   ",
        saved: "Old",
        required: true,
        reset,
        send,
      });
      expect(send).not.toHaveBeenCalled();
      expect(reset).toHaveBeenCalledWith("Old");
    });

    it("sends an empty draft on an optional field", () => {
      const { result } = renderHook(() => useFieldCommit<Key>());
      const send = vi.fn();
      result.current.commitText("description", {
        draft: "",
        saved: "Some text",
        reset: vi.fn(),
        send,
      });
      expect(send).toHaveBeenCalledWith("");
    });

    it("does not send again while Enter's commit is still in flight", async () => {
      const { result } = renderHook(() => useFieldCommit<Key>());
      const answer = deferred<{ title: string }>();
      const request = vi.fn(() => answer.promise);
      const field = {
        draft: "Renamed",
        saved: "Old",
        reset: vi.fn(),
        send: () => result.current.commit("title", request),
      };

      // Enter, then the blur it causes, in the same tick: no re-render
      // between them.
      act(() => {
        result.current.commitText("title", field);
        result.current.commitText("title", field);
      });
      expect(request).toHaveBeenCalledTimes(1);

      await act(async () => {
        answer.resolve({ data: { title: "Renamed" } });
        await answer.promise;
      });
      // Once the request has answered, the field commits again.
      result.current.commitText("title", { ...field, draft: "Renamed again" });
      expect(request).toHaveBeenCalledTimes(2);
    });
  });

  it("revertText resets the box and clears the note", async () => {
    const { result } = renderHook(() => useFieldCommit<Key>());
    const reset = vi.fn();
    await act(async () => {
      await result.current.commit("title", async () => ({ error: { detail: "No." } }));
    });
    expect(result.current.status.title).toBe("error");

    act(() => {
      result.current.revertText("title", { draft: "x", saved: "Old", reset, send: vi.fn() });
    });
    expect(reset).toHaveBeenCalledWith("Old");
    expect(result.current.status.title).toBe("idle");
    expect(result.current.error.title).toBeUndefined();
  });
});

describe("useRowCommit", () => {
  it("keys the note by row id", async () => {
    const { result } = renderHook(() => useRowCommit());
    await act(async () => {
      await result.current.commit("u1", async () => ({}));
      await result.current.commit("u2", async () => ({
        error: { detail: "The last Administrator cannot be demoted." },
      }));
    });
    expect(result.current.status).toEqual({ u1: "saved", u2: "error" });
    expect(result.current.error.u2).toBe("The last Administrator cannot be demoted.");
  });

  it("carries no text-box helpers", () => {
    const { result } = renderHook(() => useRowCommit());
    expect(Object.keys(result.current).sort()).toEqual(["commit", "error", "note", "status"]);
  });
});

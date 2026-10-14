import { describe, expect, it } from "vitest";
import type { Program } from "../../core/types";
import { InMemoryProgramRepository } from "./repository";

describe("InMemoryProgramRepository", () => {
  const createProgram = (): Program => ({
    id: "program-1",
    name: "Test Program",
    description: "Test description",
    status: "active",
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
  });

  it("creates and finds a program", async () => {
    const repository = new InMemoryProgramRepository();
    const program = createProgram();

    await repository.create(program);

    const result = await repository.findById(program.id);

    expect(result).toEqual(program);
  });

  it("does not expose stored state through create or find results", async () => {
    const repository = new InMemoryProgramRepository();
    const program = createProgram();

    const created = await repository.create(program);
    created.name = "Changed outside repository";
    program.description = "Changed input object";

    const found = await repository.findById(program.id);

    expect(found?.name).toBe("Test Program");
    expect(found?.description).toBe("Test description");

    found!.name = "Changed fetched object";

    const fetchedAgain = await repository.findById(program.id);
    expect(fetchedAgain?.name).toBe("Test Program");
  });

  it("updates an existing program and refreshes updatedAt", async () => {
    const repository = new InMemoryProgramRepository();
    const program = createProgram();

    await repository.create(program);

    const result = await repository.update(program.id, {
      name: "Updated Program",
    });

    expect(result).toMatchObject({
      id: program.id,
      name: "Updated Program",
      description: program.description,
      status: program.status,
      createdAt: program.createdAt,
    });
    expect(result?.updatedAt).not.toBe(program.updatedAt);
    expect(result?.updatedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(result!.updatedAt))).toBe(false);
  });

  it("returns null when updating a non-existent program", async () => {
    const repository = new InMemoryProgramRepository();

    const result = await repository.update("missing-id", {
      name: "Updated Program",
    });

    expect(result).toBeNull();
  });
});

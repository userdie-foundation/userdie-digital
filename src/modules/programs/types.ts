import type { Program, ID } from "../../core/types";

export type CreateProgramInput = {
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
};

export type UpdateProgramInput = {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
};

export type ProgramRepository = {
  create(
    program: Program,
  ): Promise<Program>;

  findById(
    id: ID,
  ): Promise<Program | null>;

  update(
    id: ID,
    input: UpdateProgramInput,
  ): Promise<Program>;
};
export class DomainError extends Error {
  public readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);

    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(
  error: unknown,
): error is DomainError {
  return error instanceof DomainError;
}
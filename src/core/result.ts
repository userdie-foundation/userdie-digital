export type Result<T> =
  | Success<T>
  | Failure;

export interface Success<T> {
  success: true;
  data: T;
}

export interface Failure {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export function ok<T>(data: T): Success<T> {
  return {
    success: true,
    data,
  };
}

export function fail(
  code: string,
  message: string,
): Failure {
  return {
    success: false,
    error: {
      code,
      message,
    },
  };
}
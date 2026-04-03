export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = { success: false; error: string };

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function fail(error: string): ApiFailure {
  return { success: false, error };
}

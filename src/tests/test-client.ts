type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  token?: string;
  body?: unknown;
  formData?: FormData;
};

type ApiResult<T> = {
  status: number;
  ok: boolean;
  data: T;
};

const BASE_URL = process.env.SMOKE_TEST_BASE_URL ?? "http://localhost:4000";

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers = new Headers();

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  let body: BodyInit | undefined;

  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : (undefined as T);

  return {
    status: response.status,
    ok: response.ok,
    data,
  };
}

export function createTextUploadForm(filename: string, content: string) {
  const formData = new FormData();
  const blob = new Blob([content], { type: "text/plain" });
  formData.append("files", blob, filename);
  return formData;
}

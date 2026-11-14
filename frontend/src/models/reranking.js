import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function request(path, settings) {
  const response = await fetch(`${API_BASE}/system/${path}`, {
    method: settings ? "POST" : "GET",
    headers: { ...baseHeaders(), "Content-Type": "application/json" },
    ...(settings ? { body: JSON.stringify(settings) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Rerank request failed.");
  return data;
}

export default {
  get: () => request("rerank-settings"),
  save: (settings) => request("rerank-settings", settings),
  test: (settings) => request("rerank-test", settings),
};

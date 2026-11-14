import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function request(path = "", method = "GET", body) {
  const response = await fetch(`${API_BASE}/system/${path}`, {
    method,
    headers: { ...baseHeaders(), "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Model request failed.");
  return data;
}

export default {
  list: () => request("local-models"),
  remove: (id) => request(`local-models/${id}`, "DELETE"),
  test: (id) => request(`local-models/${id}/test`, "POST"),
  testEmbedding: (body) => request("embedding-test", "POST", body),
  import: (form, onProgress) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/system/local-models/import`);
      for (const [key, value] of Object.entries(baseHeaders()))
        if (value !== null) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => reject(new Error("Model upload failed."));
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data.error || "Model upload failed."));
        } catch {
          reject(new Error("Model upload failed."));
        }
      };
      xhr.send(form);
    }),
};

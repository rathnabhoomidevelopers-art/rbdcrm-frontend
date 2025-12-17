import axios from "axios";

/**
 * ✅ Works for CRA builds (REACT_APP_*)
 * ⚠️ If your project is Vite, see note below for VITE_* env.
 */
const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  process.env.VITE_API_URL || // fallback if your build injects it
  "http://localhost:3000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.clear();
      window.location.href = "/userlogin";
    }
    return Promise.reject(err);
  }
);

/**
 * ✅ apiWithRetry wrapper
 * - Retries network/timeouts
 * - Adds useful flags: isNetworkError / isTimeout / isCorsError
 */
export async function apiWithRetry(config, retries = 3, backoffMs = 800) {
  let attempt = 0;
  let lastErr = null;

  while (attempt <= retries) {
    try {
      const res = await api.request(config);
      return res;
    } catch (err) {
      lastErr = err;

      const isTimeout =
        err.code === "ECONNABORTED" ||
        (typeof err.message === "string" && err.message.toLowerCase().includes("timeout"));

      const isNetworkError = !err.response; // axios: no response means network/CORS/server down
      const isCorsError =
        isNetworkError &&
        typeof err.message === "string" &&
        err.message.toLowerCase().includes("network error");

      // decorate error for your UserPage logging
      err.isTimeout = isTimeout;
      err.isNetworkError = isNetworkError;
      err.isCorsError = isCorsError;
      err.status = err.response?.status;
      err.data = err.response?.data;

      // retry only for network/timeout errors
      const shouldRetry = attempt < retries && (isNetworkError || isTimeout);

      if (!shouldRetry) throw err;

      // simple backoff
      const wait = backoffMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, wait));

      attempt += 1;
    }
  }

  throw lastErr;
}

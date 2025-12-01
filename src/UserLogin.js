import { useFormik } from "formik";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useState } from "react";
import { api } from "./api";

export default function UserLogin() {
  const navigate = useNavigate();
  const [apiError, setApiError] = useState("");
  const formik = useFormik({
    initialValues: {
      user_name: "",
      password: "",
    },
    validateOnBlur: true,
    validateOnChange: false,
    validate: (values) => {
      const errors = {};
      const user_name = values.user_name.trim();
      const password = values.password;

      if (!user_name) {
        errors.user_name = "User name is required";
      }

      if (!password) {
        errors.password = "Password is required";
      } else if (password.length < 4) {
        errors.password = "Password must be at least 4 characters";
      }

      return errors;
    },
    onSubmit: async (values, { setSubmitting }) => {
      setApiError("");
      try {
        const trimmedName = values.user_name.trim();

        const res = await api.post("/auth/user-login", {
          user_name: trimmedName,
          password: values.password,
        });

        const {
          token,
          role,
          user_name: nameFromApi,
          user_id,
        } = res.data || {};

        if (!token) {
          throw new Error("No token returned from server");
        }

        localStorage.removeItem("token");
        localStorage.removeItem("role");
        localStorage.removeItem("username");
        localStorage.removeItem("user_id");
        localStorage.removeItem("admin_id");

        const safeUserName = (
          nameFromApi ||
          trimmedName ||
          ""
        )
          .toString()
          .trim()
          .toLowerCase();

        localStorage.setItem("token", token);
        localStorage.setItem("role", role || "user");
        localStorage.setItem("username", safeUserName);
        if (user_id) {
          localStorage.setItem("user_id", user_id);
        }

        toast.success("Login successful");
        navigate("/userdashboard");
      } catch (err) {
        console.error("User login error:", err);
        const msg =
          err.response?.data?.message ||
          "Unable to connect to server. Please try again.";
        setApiError(msg);
        toast.error(msg);
      } finally {
        setSubmitting(false);
      }
    },
  });

  const {
    values,
    errors,
    touched,
    handleChange,
    handleSubmit,
    isSubmitting,
  } = formik;

  return (
    <div
      className="
        min-h-screen 
        flex items-center justify-center 
        bg-slate-950 
        bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800
        px-4
        overflow-hidden
      "
    >
      <div className="w-full max-w-md">
        <div
          className="
            bg-white/95 backdrop-blur 
            rounded-3xl 
            shadow-2xl 
            border border-slate-200/80
            px-6 py-7
          "
        >
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <h1 className="text-2xl md:text-3xl font-semibold text-center mb-1">
              User Login
            </h1>
            <p className="text-sm text-center text-slate-400">
              Sign in to access your leads and dashboard.
            </p>

            <div>
              <label
                htmlFor="user_name"
                className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide"
              >
                User Name
              </label>
              <input
                type="text"
                id="user_name"
                name="user_name"
                autoComplete="username"
                autoFocus
                onChange={handleChange}
                value={values.user_name}
                className={`
                  form-control
                  text-sm
                  rounded-2xl
                  border
                  ${
                    errors.user_name && touched.user_name
                      ? "border-red-400"
                      : "border-slate-300"
                  }
                  focus:border-indigo-500
                  focus:ring-0
                  shadow-sm
                `}
                placeholder="Enter your user name"
              />
              {errors.user_name && touched.user_name && (
                <p className="mt-1 text-xs text-red-500">{errors.user_name}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide"
              >
                Password
              </label>
              <input
                type="password"
                id="password"
                name="password"
                autoComplete="current-password"
                onChange={handleChange}
                value={values.password}
                className={`
                  form-control
                  text-sm
                  rounded-2xl
                  border
                  ${
                    errors.password && touched.password
                      ? "border-red-400"
                      : "border-slate-300"
                  }
                  focus:border-indigo-500
                  focus:ring-0
                  shadow-sm
                `}
                placeholder="Enter your password"
              />
              {errors.password && touched.password && (
                <p className="mt-1 text-xs text-red-500">{errors.password}</p>
              )}
            </div>

            {apiError && (
              <div className="text-xs text-red-500 mt-1">{apiError}</div>
            )}

            <div className="pt-3 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className={`
                  w-full 
                  inline-flex justify-center items-center
                  rounded-full 
                  bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400
                  text-white text-sm font-semibold
                  py-2.5
                  shadow-md shadow-indigo-500/40
                  hover:from-indigo-400 hover:via-blue-400 hover:to-cyan-300
                  hover:shadow-lg
                  transition-all duration-200
                  border-0
                  ${isSubmitting ? "opacity-80 cursor-not-allowed" : ""}
                `}
              >
                {isSubmitting ? "Logging in..." : "Login"}
              </button>
            </div>
          </form>

          <div className="mt-4 text-center">
            <p className="text-[11px] text-slate-400">
              Having trouble logging in? Contact your admin or support team.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

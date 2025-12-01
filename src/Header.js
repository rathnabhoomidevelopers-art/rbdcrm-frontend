import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();

  const role = localStorage.getItem("role");
  const isAdmin = role === "admin";
  const isUser = role === "user";

  let links = [];

  if (isAdmin) {
    links = [
      { to: "/homepage", label: "Report Updates" },
      { to: "/userdashboard", label: "Dashboard" },
      { to: "/followupdashboard", label: "Leads History" },
    ];
  } else if (isUser) {
    links = [
      { to: "/userdashboard", label: "Dashboard" },
      { to: "/leadstable", label: "Leads Table" },
      { to: "/statusdashboard", label: "Status Dashboard" },
      { to: "/followupdashboard", label: "Leads History" },
    ];
  }

  const closeOffcanvas = () => {
    const offcanvasEl = document.getElementById("mainOffcanvas");
    if (!offcanvasEl || !window.bootstrap) return;

    const existingInstance = window.bootstrap.Offcanvas.getInstance(offcanvasEl);
    const offcanvas =
      existingInstance || new window.bootstrap.Offcanvas(offcanvasEl);
    offcanvas.hide();
  };

  const handleLogout = () => {
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    localStorage.removeItem("admin_id");
    closeOffcanvas();
    navigate("/userlogin");
  };

  const isActive = (path) => location.pathname === path;

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="w-full top-0 z-50"
      >
        <div
          className="
            bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900
            border-b border-white/10
            shadow-xl backdrop-blur-md
          "
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="h-14 md:h-20 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Link
                  to="/"
                  className="block leading-none"
                  onClick={closeOffcanvas}
                >
                  <img
                    src="/images/rbd-logo.png"
                    alt="RBD Logo"
                    className="h-10 md:h-16 w-auto object-contain"
                  />
                </Link>

                <div className="hidden sm:block">
                  <div className="text-[10px] sm:text-xs tracking-[0.18em] text-slate-300 uppercase">
                    Rathna Bhoomi Developers
                  </div>
                </div>
              </div>

              <nav className="hidden md:flex items-center gap-6 lg:gap-10">
                {links.map((l) => (
                  <Link
                    key={l.label}
                    to={l.to}
                    onClick={closeOffcanvas}
                    className={`
                      relative text-sm lg:text-base font-medium
                      transition-all duration-300
                      ${
                        isActive(l.to)
                          ? "text-white"
                          : "text-slate-200 hover:text-white"
                      }
                      md:px-1
                      before:content-[''] before:absolute before:left-0 before:-bottom-1
                      before:h-[2px] before:w-0
                      before:bg-gradient-to-r before:from-cyan-400 before:to-blue-400
                      before:transition-all before:duration-300
                      hover:before:w-full
                      ${isActive(l.to) ? "before:w-full" : ""}
                    `}
                  >
                    {l.label}
                  </Link>
                ))}

                <div className="flex items-center gap-3 ms-4">
                  {!role && (
                    <>
                      <Link
                        to="/userlogin"
                        onClick={closeOffcanvas}
                        className="
                          px-3.5 py-1.5 rounded-full
                          text-xs md:text-sm font-medium 
                          text-slate-50
                          bg-white/5
                          border border-2 border-white/30
                          backdrop-blur-sm
                          shadow-sm shadow-slate-900/40
                          hover:bg-white/15 hover:border-white/60
                          hover:shadow-md
                          transition-all duration-200
                        "
                      >
                        User Login
                      </Link>

                      <Link
                        to="/adminlogin"
                        onClick={closeOffcanvas}
                        className="
                          px-4 py-1.5 rounded-full 
                          text-xs md:text-sm font-semibold
                          text-slate-900
                          bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400
                          shadow-md shadow-orange-500/40
                          hover:from-amber-300 hover:via-orange-300 hover:to-rose-300
                          hover:shadow-lg
                          transition-all duration-200
                        "
                      >
                        Admin Login
                      </Link>
                    </>
                  )}

                  {role && (
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="
                        px-3.5 py-1.5 rounded-full 
                        text-xs md:text-sm font-semibold
                        text-white
                        border border-2 border-slate-100
                        shadow-sm shadow-rose-900/50
                        hover:brightness-200 
                        hover:bg-slate-800
                        transition-all duration-150
                      "
                    >
                      Logout
                    </button>
                  )}
                </div>
              </nav>

              <button
                type="button"
                className="md:hidden inline-flex items-center justify-center rounded-full border border-white/20 p-2 text-slate-100 hover:bg-white/10 transition"
                data-bs-toggle="offcanvas"
                data-bs-target="#mainOffcanvas"
                aria-controls="mainOffcanvas"
              >
                <span className="sr-only">Open main menu</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </motion.header>

      <div
        className="offcanvas offcanvas-end bg-slate-900 text-white"
        tabIndex="-1"
        id="mainOffcanvas"
        aria-labelledby="mainOffcanvasLabel"
      >
        <div className="offcanvas-header border-b border-white/10">
          <h5
            className="offcanvas-title text-sm font-semibold"
            id="mainOffcanvasLabel"
          >
            RBD Navigation
          </h5>
          <button
            type="button"
            className="btn-close btn-close-white text-reset"
            data-bs-dismiss="offcanvas"
            aria-label="Close"
          ></button>
        </div>
        <div className="offcanvas-body d-flex flex-column gap-3">
          <div className="mb-3 text-xs text-slate-300 uppercase tracking-[0.2em]">
            Menu
          </div>

          {links.map((l) => (
            <Link
              key={l.label}
              to={l.to}
              onClick={closeOffcanvas}
              className={`
                py-2 px-2 rounded-md text-sm font-medium
                ${
                  isActive(l.to)
                    ? "bg-slate-800 text-white"
                    : "text-slate-200 hover:bg-slate-800 hover:text-white"
                }
              `}
            >
              {l.label}
            </Link>
          ))}

          <hr className="border-slate-700 my-3" />

          {!role && (
            <div className="d-flex flex-column gap-2">
              <Link
                to="/userlogin"
                onClick={closeOffcanvas}
                className="
                  w-full text-center
                  px-3 py-2 rounded-full
                  text-sm font-medium 
                  text-slate-50
                  bg-white/10
                  border border-white/30
                  hover:bg:white/20 hover:border-white/60
                  transition-all duration-150
                "
              >
                User Login
              </Link>

              <Link
                to="/adminlogin"
                onClick={closeOffcanvas}
                className="
                  w-full text-center
                  px-3 py-2 rounded-full 
                  text-sm font-semibold
                  text-slate-900
                  bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400
                  shadow-md shadow-orange-500/40
                  hover:from-amber-300 hover:via-orange-300 hover:to-rose-300
                  hover:shadow-lg
                  transition-all duration-150
                "
              >
                Admin Login
              </Link>
            </div>
          )}

          {role && (
            <button
              type="button"
              onClick={handleLogout}
              className="
                mt-2 w-full
                px-3 py-2 rounded-full 
                text-sm font-semibold
                text-white
                border border-2 border-slate-100
                hover:bg-slate-800
                transition-all duration-150
              "
            >
              Logout
            </button>
          )}
        </div>
      </div>
    </>
  );
}

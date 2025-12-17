import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api } from "./api";

const TRACKED_STATUSES = [
  "Visit Scheduled",
  "NR/SF",
  "RNR",
  "Details_shared",
  "Site Visited",
  "Booked",
  "Invalid",
  "Not Interested",
  "Location Issue",
  "CP",
  "Budget Issue",
  "Visit Postponed",
  "Closed",
  "Busy",
];

const PROJECT_OPTIONS = ["Northern Lights", "Gruhakalpa", "Nandi Hill View"];

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function formatStatusLabel(status) {
  if (status === "Details_shared") return "Details Shared";
  return status || "";
}

export function FollowUpDashboard() {
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [leadIndex, setLeadIndex] = useState({});
  const [mobileFilter, setMobileFilter] = useState("");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [assignedFilter, setAssignedFilter] = useState("All");
  const [projectFilter, setProjectFilter] = useState("All");
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);

  const role = localStorage.getItem("role");
  const username = (localStorage.getItem("username") || "")
    .toString()
    .trim()
    .toLowerCase();

  const resetFilters = () => {
    setMobileFilter("");
    setFromDateFilter("");
    setToDateFilter("");
    setStatusFilter("All");
    setAssignedFilter("All");
    setProjectFilter("All");
    setCurrentGroupIndex(0);
  };

  const fetchFollowUps = async () => {
    try {
      setLoading(true);

      const [fuRes, leadsRes] = await Promise.all([
        api.get("/follow-ups"),
        api.get("/leads"),
      ]);

      let fuData = fuRes.data || [];
      const allLeads = leadsRes.data || [];
      const idx = {};
      allLeads.forEach((l) => {
        const key = l.lead_id || l._id;
        if (key) idx[key] = l;
      });
      setLeadIndex(idx);

      if (role === "user") {
        const myLeadIds = new Set(
          allLeads
            .filter(
              (l) =>
                (l.Assigned_to || "").toString().trim().toLowerCase() ===
                username
            )
            .map((l) => l.lead_id || l._id)
        );

        fuData = fuData.filter((fu) => {
          const key = fu.followup_id || fu.lead_id || fu._id;
          return key && myLeadIds.has(key);
        });
      }

      fuData = fuData.map((fu) => {
        let status = fu.status;
        if (status === "Follow Up" || status === "Follow-up") {
          status = "Visit Scheduled";
        }
        return { ...fu, status };
      });

      setFollowUps(fuData);
      setCurrentGroupIndex(0);
    } catch (err) {
      console.error("Error fetching follow-up history", {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });

      if (err.response?.status === 401) {
        toast.error("Session expired. Please login again.");
      } else {
        toast.error("Failed to load follow-up history");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!active) return;
      await fetchFollowUps();
    };

    load();

    const handleLeadsUpdated = () => {
      load();
    };

    window.addEventListener("leads-updated", handleLeadsUpdated);

    return () => {
      active = false;
      window.removeEventListener("leads-updated", handleLeadsUpdated);
    };
  }, [role, username]);

  const assignedOptions = Array.from(
    new Set(
      followUps
        .map((fu) => {
          const leadKey = fu.followup_id || fu.lead_id;
          const lead =
            leadKey && leadIndex[leadKey] ? leadIndex[leadKey] : null;
          const raw = (
            (lead && lead.Assigned_to) ||
            fu.Assigned_to ||
            ""
          )
            .toString()
            .trim();
          return raw;
        })
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const projectOptions = ["All", ...PROJECT_OPTIONS];
  const filteredFollowUps = followUps.filter((fu) => {
    const leadKey = fu.followup_id || fu.lead_id;
    const lead = leadKey && leadIndex[leadKey] ? leadIndex[leadKey] : null;

    if (assignedFilter !== "All") {
      const assignedRaw = (
        (lead && lead.Assigned_to) ||
        fu.Assigned_to ||
        ""
      )
        .toString()
        .trim();

      if (!assignedRaw || assignedRaw !== assignedFilter) return false;
    }

    if (projectFilter !== "All") {
      const projectRaw = (
        fu.project ||
        (lead && lead.project) ||
        ""
      )
        .toString()
        .trim();

      if (!projectRaw || projectRaw !== projectFilter) return false;
    }

    if (statusFilter !== "All") {
      if (fu.status !== statusFilter) return false;
    }

    if (mobileFilter.trim()) {
      const mob = String(fu.mobile || "");
      if (!mob.includes(mobileFilter.trim())) return false;
    }

    if ((fromDateFilter || toDateFilter) && fu.date) {
      const recordDate = new Date(fu.date);

      if (fromDateFilter) {
        const from = new Date(fromDateFilter);
        if (recordDate < from) return false;
      }

      if (toDateFilter) {
        const to = new Date(toDateFilter);
        if (recordDate > to) return false;
      }
    }

    return true;
  });

  const groupedByLead = filteredFollowUps.reduce((acc, fu) => {
    const key =
      fu.followup_id ||
      fu.lead_id ||
      (fu.mobile ? `Mobile-${fu.mobile}` : `FU-${fu._id || "Unknown"}`);

    if (!acc[key]) acc[key] = [];
    acc[key].push(fu);
    return acc;
  }, {});

  const sortedGroups = Object.entries(groupedByLead).sort((a, b) => {
    const aLatest = a[1].reduce((max, fu) => {
      const t = fu.date ? new Date(fu.date).getTime() : 0;
      return t > max ? t : max;
    }, 0);
    const bLatest = b[1].reduce((max, fu) => {
      const t = fu.date ? new Date(fu.date).getTime() : 0;
      return t > max ? t : max;
    }, 0);
    return bLatest - aLatest;
  });

  useEffect(() => {
    setCurrentGroupIndex(0);
  }, [
    statusFilter,
    mobileFilter,
    fromDateFilter,
    toDateFilter,
    assignedFilter,
    projectFilter,
  ]);

  if (loading) {
    return (
      <div
        className="d-flex align-items-center justify-content-center"
        style={{
          minHeight: "100vh",
          backgroundColor: "#f3f4f6",
        }}
      >
        <div className="text-center">
          <div className="spinner-border text-secondary mb-2" role="status" />
          <div className="small text-muted">Loading follow-up history...</div>
        </div>
      </div>
    );
  }

  if (!followUps.length) {
    return (
      <div
        className="d-flex align-items-center justify-content-center"
        style={{
          minHeight: "100vh",
          backgroundColor: "#f3f4f6",
        }}
      >
        <div className="card shadow-sm border-0" style={{ maxWidth: 420 }}>
          <div className="card-body text-center">
            <div
              className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
              style={{
                width: 44,
                height: 44,
                backgroundColor: "#e5f3ff",
                color: "#0d6efd",
                fontSize: 22,
              }}
            >
              📚
            </div>
            <h5 className="card-title mb-1 fw-semibold">
              No follow-up history found
            </h5>
            <p className="card-text small text-muted mb-0">
              Once you start updating follow-ups from the Call Status Dashboard,
              all past entries will appear here grouped by lead.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!sortedGroups.length) {
    return (
      <div
        className="d-flex align-items-center justify-content-center"
        style={{
          minHeight: "100vh",
          backgroundColor: "#f3f4f6",
        }}
      >
        <div className="card shadow-sm border-0" style={{ maxWidth: 420 }}>
          <div className="card-body text-center">
            <h5 className="card-title mb-1 fw-semibold">
              No history matches the filters
            </h5>
            <p className="card-text small text-muted mb-2">
              Try clearing some filters to see more follow-up entries.
            </p>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={resetFilters}
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>
    );
  }

  let safeIndex = currentGroupIndex;
  if (safeIndex < 0) safeIndex = 0;
  if (safeIndex > sortedGroups.length - 1) safeIndex = sortedGroups.length - 1;

  const [groupKey, items] = sortedGroups[safeIndex];
  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < sortedGroups.length - 1;

  const sortedByDateAsc = [...items].sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    return ta - tb;
  });

  const latest = sortedByDateAsc[sortedByDateAsc.length - 1] || {};
  const leadName = latest.name || "";
  const source = latest.source || "";
  const latestStatus = latest.status || "";
  const followupId = latest.followup_id || latest.lead_id || "";
  const mobileDisplay = latest.mobile || "";

  const leadForHeader = followupId && leadIndex[followupId]
    ? leadIndex[followupId]
    : null;

  const assignedTo =
    (leadForHeader &&
      (leadForHeader.Assigned_to || "").toString().trim()) ||
    (latest.Assigned_to || "").toString().trim() ||
    "";

  const projectName =
    (leadForHeader &&
      (leadForHeader.project || "").toString().trim()) ||
    (latest.project || "").toString().trim() ||
    "";

  return (
    <div
      className="py-4"
      style={{
        minHeight: "100vh",
        backgroundColor: "#f3f4f6",
      }}
    >
      <div className="container-xl">
        <div className="row mb-3">
          <div className="col-12">
            <div
              className="card border-0 shadow-sm rounded-3"
              style={{ borderLeft: "4px solid #0d6efd" }}
            >
              <div className="card-body d-flex flex-wrap align-items-center justify-content-between gap-3">
                <div className="d-flex align-items-center gap-3">
                  <div
                    className="d-flex align-items-center justify-content-center rounded-circle"
                    style={{
                      width: 44,
                      height: 44,
                      backgroundColor: "#e5f3ff",
                      color: "#0d6efd",
                      fontSize: 22,
                    }}
                  >
                    📚
                  </div>
                  <div>
                    <h3
                      className="fw-semibold mb-1"
                      style={{ fontSize: "1.4rem" }}
                    >
                      Follow-Up History
                    </h3>
                    <p className="mb-0 small text-muted">
                      Read-only timeline of{" "}
                      <strong>all past follow-up entries</strong>, grouped by
                      lead. Navigate lead-by-lead.
                    </p>
                  </div>
                </div>

                <div className="d-flex flex-wrap gap-4">
                  <div className="text-end">
                    <div className="small text-muted">Unique Leads</div>
                    <div className="fw-bold" style={{ fontSize: "1.2rem" }}>
                      {sortedGroups.length}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="small text-muted">Current Lead</div>
                    <div className="fw-bold" style={{ fontSize: "1.1rem" }}>
                      {safeIndex + 1} / {sortedGroups.length}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="row mb-3">
          <div className="col-12">
            <div className="card border-0 shadow-sm rounded-3">
              <div className="card-body py-3">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <div>
                    <h6 className="mb-0 fw-semibold text-muted text-uppercase small">
                      Filters
                    </h6>
                    <div className="small text-muted">
                      Refine history by status, mobile, date/time
                      {role === "admin"
                        ? ", Assigned To and Project."
                        : " and Project."}{" "}
                      Card view will update accordingly.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={resetFilters}
                  >
                    Reset
                  </button>
                </div>

                <div className="mb-3">
                  <div className="small text-muted mb-2 fw-semibold text-uppercase">
                    Status Filter
                  </div>

                  <div className="d-flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`btn btn-sm rounded-pill px-3 py-1 ${
                        statusFilter === "All"
                          ? "btn-dark shadow-sm"
                          : "btn-outline-secondary"
                      }`}
                      onClick={() => setStatusFilter("All")}
                    >
                      All
                    </button>

                    {TRACKED_STATUSES.map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={`btn btn-sm rounded-pill px-3 py-1 ${
                          statusFilter === status
                            ? "btn-primary shadow-sm"
                            : "btn-outline-primary"
                        }`}
                        onClick={() => setStatusFilter(status)}
                      >
                        {formatStatusLabel(status)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="row g-3">
                  <div className="col-12 col-md-3">
                    <label className="form-label mb-1 small text-muted">
                      Mobile
                    </label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="Search by mobile..."
                      value={mobileFilter}
                      onChange={(e) => setMobileFilter(e.target.value)}
                    />
                  </div>

                  <div className="col-12 col-md-3">
                    <label className="form-label mb-1 small text-muted">
                      From (Date &amp; Time)
                    </label>
                    <input
                      type="datetime-local"
                      className="form-control form-control-sm"
                      value={fromDateFilter}
                      onChange={(e) => setFromDateFilter(e.target.value)}
                    />
                  </div>

                  <div className="col-12 col-md-3">
                    <label className="form-label mb-1 small text-muted">
                      To (Date &amp; Time)
                    </label>
                    <input
                      type="datetime-local"
                      className="form-control form-control-sm"
                      value={toDateFilter}
                      onChange={(e) => setToDateFilter(e.target.value)}
                    />
                  </div>

                  {role === "admin" && (
                    <div className="col-12 col-md-3">
                      <label className="form-label mb-1 small text-muted">
                        Assigned To
                      </label>
                      <select
                        className="form-select form-select-sm"
                        value={assignedFilter}
                        onChange={(e) => setAssignedFilter(e.target.value)}
                      >
                        <option value="All">All</option>
                        {assignedOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="row g-3 mt-2">
                  <div className="col-12 col-md-3">
                    <label className="form-label mb-1 small text-muted">
                      Project
                    </label>
                    <select
                      className="form-select form-select-sm"
                      value={projectFilter}
                      onChange={(e) => setProjectFilter(e.target.value)}
                    >
                      {projectOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {(mobileFilter ||
                  fromDateFilter ||
                  toDateFilter ||
                  statusFilter !== "All" ||
                  assignedFilter !== "All" ||
                  projectFilter !== "All") && (
                  <div className="mt-2 small text-muted">
                    Showing{" "}
                    <strong>
                      {filteredFollowUps.length} / {followUps.length}
                    </strong>{" "}
                    history rows based on active filters.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="row">
          <div className="col-12">
            <div
              className="card border-0 shadow-sm rounded-3 mb-3 d-flex flex-column"
              style={{ height: "480px" }}
            >
              <div className="card-header bg-white border-bottom d-flex flex-wrap justify-content-between align-items-center">
                <div>
                  <div className="small text-muted text-uppercase">
                    Lead / Mobile
                  </div>
                  <div className="fw-semibold">
                    {mobileDisplay || groupKey}{" "}
                  </div>
                  {leadName && (
                    <div className="small text-muted">
                      Name: <strong>{leadName}</strong>
                    </div>
                  )}
                  {source && (
                    <div className="small text-muted">
                      Source: <strong>{source}</strong>
                    </div>
                  )}
                  {assignedTo && (
                    <div className="small text-muted">
                      Assigned To: <strong>{assignedTo}</strong>
                    </div>
                  )}
                  {projectName && (
                    <div className="small text-muted">
                      Project: <strong>{projectName}</strong>
                    </div>
                  )}
                </div>

                <div className="text-end">
                  <div className="small text-muted">Latest Status</div>
                  <div className="fw-semibold">
                    {formatStatusLabel(latestStatus)}
                  </div>
                  <div className="small text-muted">
                    Entries: <strong>{sortedByDateAsc.length}</strong>
                  </div>
                </div>
              </div>

              <div className="card-body p-3 flex-grow-1 overflow-auto">
                <div className="small text-muted mb-2">
                  Follow-up Timeline (Read-only)
                </div>
                <div
                  className="border rounded bg-light p-2"
                  style={{ fontSize: "0.85rem" }}
                >
                  {sortedByDateAsc.map((fu, i) => (
                    <div
                      key={
                        (fu._id || fu.followup_id || fu.lead_id || "") + i
                      }
                    >
                      <div className="fw-semibold text-muted">
                        {fu.date ? formatDateTime(fu.date) : "No date"}{" "}
                        {fu.status
                          ? `• ${formatStatusLabel(fu.status)}`
                          : ""}
                      </div>
                      <div className="text-body">
                        {fu.remarks ? (
                          fu.remarks
                        ) : (
                          <span className="text-muted">— No remark —</span>
                        )}
                      </div>
                      {i !== sortedByDateAsc.length - 1 && (
                        <hr className="my-1" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card-footer bg-white border-top-0 py-2 small text-muted d-flex justify-content-between align-items-center">
                <div>
                  Read-only history from <code>follow-ups</code> collection.
                </div>
                <div className="d-flex gap-2">
                  <button
                    type="button"
                    className={`btn btn-sm btn-outline-secondary ${
                      !hasPrev ? "disabled" : ""
                    }`}
                    disabled={!hasPrev}
                    onClick={() => {
                      if (hasPrev) {
                        setCurrentGroupIndex((prev) => prev - 1);
                      }
                    }}
                  >
                    ← Previous Lead
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm btn-outline-primary ${
                      !hasNext ? "disabled" : ""
                    }`}
                    disabled={!hasNext}
                    onClick={() => {
                      if (hasNext) {
                        setCurrentGroupIndex((prev) => prev + 1);
                      }
                    }}
                  >
                    Next Lead →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FollowUpDashboard;
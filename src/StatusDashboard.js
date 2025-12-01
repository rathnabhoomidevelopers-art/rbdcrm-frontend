import { useEffect, useState, useRef } from "react";
import toast from "react-hot-toast";
import { api } from "./api";

const LAST_LEAD_KEY = "statusDashboardLastLeadId";

const TARGET_STATUSES = [
  "Details_shared",
  "Visit Scheduled",
  "NR/SF",
  "RNR",
  "Site Visited",
  "Booked",
  "Invalid",
  "Not Interested",
];

const FOLLOW_UP_STATUSES = [
  "Visit Scheduled",
  "NR/SF",
  "RNR",
  "Details_shared",
  "Site Visited",
  "Booked",
];

const AUTO_24H_STATUSES = ["NR/SF", "RNR", "Details_shared", "Site Visited"];
const HARD_LOCK_STATUSES = ["NR/SF", "RNR"];
// Only these statuses should trigger auto-transfer
const TRANSFER_STATUSES = ["NR/SF", "RNR"];

function getConsecutiveSameStatusCount(history, newStatus) {
  if (!newStatus) return 0;

  let count = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const st = (history[i].status || "").trim();
    if (st === newStatus) {
      count++;
    } else {
      break;
    }
  }
  // +1 for the current attempt we are about to save
  return count + 1;
}

function getRowBackground(status) {
  const s = (status || "").toString().trim().toLowerCase();

  switch (s) {
    case "details_shared":
    case "details shared":
      return {
        backgroundColor: "#d1e7dd",
        color: "#0f5132",
      };

    case "booked":
      return {
        backgroundColor: "#94afa5",
        color: "#0f5132",
      };

    case "not interested":
      return {
        backgroundColor: "#f8d7da",
        color: "#842029",
      };

    case "invalid":
      return {
        backgroundColor: "#e2e3e5",
        color: "#41464b",
      };

    case "nr/sf":
      return {
        backgroundColor: "#fff3cd",
        color: "#664d03",
      };

    case "rnr":
      return {
        backgroundColor: "#ffe5b4",
        color: "#7c4a03",
      };

    case "site visited":
      return {
        backgroundColor: "#cfe2ff",
        color: "#084298",
      };

    default:
      return {
        backgroundColor: "#eef2ff",
        color: "#3730a3",
      };
  }
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const mins = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

function formatDateForInput(value) {
  if (!value) return "";
  if (typeof value === "string" && value.length >= 16 && value.includes("T")) {
    return value.slice(0, 16);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return toLocalInputValue(d);
}

function formatDateTimeDisplay(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function getNowPlus24ForInput() {
  const d = new Date();
  d.setHours(d.getHours() + 24);
  return toLocalInputValue(d);
}

export function StatusDashboard() {
  const [rows, setRows] = useState([]);
  const [originalRows, setOriginalRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const [users, setUsers] = useState([]);

  const hasRestoredRef = useRef(false);

  const [mobileFilter, setMobileFilter] = useState("");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const role = localStorage.getItem("role");
  const username = (localStorage.getItem("username") || "")
    .toString()
    .trim()
    .toLowerCase();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [jumpToLeadId, setJumpToLeadId] = useState(null);
  const [followUpHistory, setFollowUpHistory] = useState({});
  const [newRemarkByLead, setNewRemarkByLead] = useState({});

  const fetchStatusRows = async () => {
    try {
      setLoading(true);

      const [leadsRes, fuRes] = await Promise.all([
        api.get("/leads"),
        api.get("/follow-ups"),
      ]);

      let data = leadsRes.data || [];
      const fuData = fuRes.data || [];

      if (role === "user") {
        data = data.filter(
          (lead) =>
            (lead.Assigned_to || "").toString().trim().toLowerCase() ===
            username
        );
      }

      data = data.map((lead) => {
        let status = lead.status;
        if (status === "Follow Up" || status === "Follow-up") {
          status = "Visit Scheduled";
        }
        return { ...lead, status };
      });

      const filteredByStatus = data.filter((lead) =>
        TARGET_STATUSES.includes(lead.status)
      );

      const mapped = filteredByStatus.map((lead) => ({
        ...lead,
        date: lead.dob || null,
        project: lead.project || "",
      }));

      setRows(mapped);

      // include project in snapshot so project-only edits can be saved
      const snapshot = mapped.map((row) => ({
        lead_id: row.lead_id,
        status: row.status || "",
        date: row.date ? formatDateForInput(row.date) : "",
        remarks: row.remarks || "",
        project: row.project || "",
      }));
      setOriginalRows(snapshot);

      const leadIdsSet = new Set(mapped.map((r) => r.lead_id));
      const historyMap = {};

      fuData.forEach((fu) => {
        const id = fu.followup_id;
        if (!id || !leadIdsSet.has(id)) return;

        if (!historyMap[id]) historyMap[id] = [];
        historyMap[id].push(fu);
      });

      Object.keys(historyMap).forEach((id) => {
        historyMap[id].sort((a, b) => {
          const ta = a.date ? new Date(a.date).getTime() : 0;
          const tb = b.date ? new Date(b.date).getTime() : 0;
          return ta - tb;
        });
      });

      setFollowUpHistory(historyMap);
    } catch (err) {
      console.error("Error fetching status dashboard rows", {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      toast.error("Failed to load status dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      if (!active) return;
      await fetchStatusRows();
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get("/users")
      .then((res) => {
        if (!active) return;
        setUsers(res.data || []);
      })
      .catch((err) => {
        console.error("Error fetching users for transfer logic", {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
        });
      });
    return () => {
      active = false;
    };
  }, []);

  const handleFieldChange = (leadId, field, value) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.lead_id !== leadId) return row;

        const updated = { ...row };

        if (field === "status") {
          updated.status = value;

          if (value === "NR/SF" || value === "RNR") {
            updated.date = getNowPlus24ForInput();
          } else if (
            value === "Details_shared" ||
            value === "Visit Scheduled" ||
            value === "Site Visited"
          ) {
            updated.date = "";
          }
        } else if (field === "date") {
          if (HARD_LOCK_STATUSES.includes(updated.status)) {
            return row;
          }
          updated.date = value || "";
        } else {
          // for "project" and any other editable field
          updated[field] = value;
        }

        return updated;
      })
    );
  };

  const hasChangesComparedToOriginal = (current, newRemarkForLead = "") => {
    const snapshot = originalRows.find((o) => o.lead_id === current.lead_id);
    if (!snapshot) return true;

    const currentStatus = current.status || "";
    const currentDate = current.date
      ? typeof current.date === "string"
        ? current.date.slice(0, 16)
        : formatDateForInput(current.date)
      : "";
    const currentRemarks = current.remarks || "";
    const currentProject = current.project || "";
    const hasNewRemark =
      newRemarkForLead && newRemarkForLead.toString().trim() !== "";

    return (
      snapshot.status !== currentStatus ||
      snapshot.date !== currentDate ||
      snapshot.remarks !== currentRemarks ||
      snapshot.project !== currentProject ||
      hasNewRemark
    );
  };

  const handleSave = async (row, nextLeadId = null) => {
    if (!row) return;
    setSavingId(row.lead_id);

    try {
      const updatedRow = { ...row };
      const isFollowUpStatus = FOLLOW_UP_STATUSES.includes(
        updatedRow.status || ""
      );

      const newRemark = (newRemarkByLead[updatedRow.lead_id] || "").trim();

      if (newRemark) {
        updatedRow.date = toLocalInputValue(new Date());
      }

      if (
        updatedRow.status === "Visit Scheduled" &&
        (!updatedRow.date || updatedRow.date === "")
      ) {
        toast.error("Please select visit date & time before saving.");
        setSavingId(null);
        return;
      }

      if (
        !newRemark &&
        AUTO_24H_STATUSES.includes(updatedRow.status) &&
        (!updatedRow.date || updatedRow.date === "")
      ) {
        updatedRow.date = getNowPlus24ForInput();
      }

      const changed = hasChangesComparedToOriginal(updatedRow, newRemark);
      if (!changed) {
        toast("No changes to save", {
          icon: "ℹ️",
          position: "top-right",
        });
        setSavingId(null);
        return;
      }

      const remarkToSave = newRemark || updatedRow.remarks || "";

      let newAssignedTo = updatedRow.Assigned_to || null;
      let transferredTo = null;

      // Auto-transfer logic for NR/SF and RNR with 7-attempt threshold + round-robin
      if (
        role === "user" &&
        TRANSFER_STATUSES.includes(updatedRow.status || "")
      ) {
        const history = followUpHistory[updatedRow.lead_id] || [];
        const consecutiveCount = getConsecutiveSameStatusCount(
          history,
          updatedRow.status
        );

        if (consecutiveCount >= 7) {
          const currentAssigned = (updatedRow.Assigned_to || "")
            .toString()
            .trim()
            .toLowerCase();

          // Build a round-robin pool of normal "user" accounts
          const roundRobinPool = (users || []).filter((u) => {
            const uname =
              u.user_name && u.user_name.toString().trim().toLowerCase();
            // if role field exists, use only "user" type; otherwise include all
            const roleOk = !u.role || u.role === "user";
            return uname && roleOk;
          });

          if (roundRobinPool.length > 1) {
            const currentIdx = roundRobinPool.findIndex(
              (u) =>
                u.user_name &&
                u.user_name.toString().trim().toLowerCase() === currentAssigned
            );

            let nextUser = null;
            if (currentIdx === -1) {
              // current assigned not in pool, just take first user
              nextUser = roundRobinPool[0];
            } else {
              const nextIdx = (currentIdx + 1) % roundRobinPool.length;
              nextUser = roundRobinPool[nextIdx];
            }

            if (
              nextUser &&
              nextUser.user_name &&
              nextUser.user_name.toString().trim().toLowerCase() !==
                currentAssigned
            ) {
              newAssignedTo = nextUser.user_name;
              transferredTo = newAssignedTo;
            }
          }
        }
      }

      if (isFollowUpStatus) {
        await api.post("/add-follow_up", {
          followup_id: updatedRow.lead_id,
          date: updatedRow.date || null,
          name: updatedRow.name || null,
          mobile: updatedRow.mobile,
          source: updatedRow.source || null,
          status: updatedRow.status || null,
          job_role: updatedRow.job_role || null,
          budget: updatedRow.budget || null,
          project: updatedRow.project || null,
          remarks: remarkToSave || null,
        });

        await api.put(`/edit-lead/${updatedRow.lead_id}`, {
          name: updatedRow.name || null,
          source: updatedRow.source || null,
          status: updatedRow.status || null,
          job_role: updatedRow.job_role || null,
          budget: updatedRow.budget || null,
          project: updatedRow.project || null,
          remarks: remarkToSave || null,
          dob: updatedRow.date || null,
          Assigned_to: newAssignedTo || null,
        });

        await fetchStatusRows();
        window.dispatchEvent(new Event("leads-updated"));

        toast.success("Status updated and follow-up history entry created.", {
          duration: 2500,
          position: "top-right",
        });
      } else {
        await api.put(`/edit-lead/${updatedRow.lead_id}`, {
          name: updatedRow.name || null,
          source: updatedRow.source || null,
          status: updatedRow.status || null,
          job_role: updatedRow.job_role || null,
          budget: updatedRow.budget || null,
          project: updatedRow.project || null,
          remarks: remarkToSave || null,
          dob: updatedRow.date || null,
          Assigned_to: newAssignedTo || null,
        });

        try {
          await api.delete(`/delete-follow_up/${updatedRow.lead_id}`);
        } catch (err) {
          if (err.response?.status !== 404) throw err;
        }

        await fetchStatusRows();
        window.dispatchEvent(new Event("leads-updated"));

        toast.success("Status updated in Leads.", {
          duration: 2000,
          position: "top-right",
        });
      }

      if (transferredTo) {
        toast.success(
          `Lead auto-assigned to ${transferredTo} after 7 "${updatedRow.status}" attempts (round-robin).`,
          {
            duration: 3000,
            position: "top-right",
          }
        );
      }

      setNewRemarkByLead((prev) => ({
        ...prev,
        [updatedRow.lead_id]: "",
      }));

      if (nextLeadId) {
        setJumpToLeadId(nextLeadId);
      }
    } catch (err) {
      console.error("Error updating status / lead", {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      toast.error("Failed to update status / lead");
    } finally {
      setSavingId(null);
    }
  };

  const filteredRows = rows.filter((row) => {
    if (statusFilter !== "All") {
      if (!row.status || row.status !== statusFilter) return false;
    }

    if (mobileFilter.trim()) {
      const mob = String(row.mobile || "");
      if (!mob.includes(mobileFilter.trim())) return false;
    }

    if ((fromDateFilter || toDateFilter) && row.date) {
      const recordDate = new Date(row.date);

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

  useEffect(() => {
    setCurrentIndex(0);
  }, [statusFilter, mobileFilter, fromDateFilter, toDateFilter]);

  useEffect(() => {
    if (!filteredRows.length) {
      setCurrentIndex(0);
      return;
    }
    setCurrentIndex((prev) => {
      if (prev < 0 || prev >= filteredRows.length) return 0;
      return prev;
    });
  }, [filteredRows.length]);

  useEffect(() => {
    if (hasRestoredRef.current) return;
    if (!filteredRows.length) return;

    const savedLeadId = localStorage.getItem(LAST_LEAD_KEY);
    if (!savedLeadId) {
      hasRestoredRef.current = true;
      return;
    }

    const idx = filteredRows.findIndex(
      (row) => String(row.lead_id) === savedLeadId
    );

    if (idx !== -1) {
      setCurrentIndex(idx);
    }

    hasRestoredRef.current = true;
  }, [filteredRows]);

  useEffect(() => {
    if (!filteredRows.length) return;
    const current = filteredRows[currentIndex];
    if (current && current.lead_id != null) {
      localStorage.setItem(LAST_LEAD_KEY, String(current.lead_id));
    }
  }, [currentIndex, filteredRows]);

  useEffect(() => {
    if (!jumpToLeadId) return;
    if (!filteredRows.length) {
      setJumpToLeadId(null);
      return;
    }

    const idx = filteredRows.findIndex((row) => row.lead_id === jumpToLeadId);
    if (idx !== -1) {
      setCurrentIndex(idx);
    }
    setJumpToLeadId(null);
  }, [filteredRows, jumpToLeadId]);

  if (loading) {
    return (
      <div
        className="d-flex align-items-center justify-content-center"
        style={{ minHeight: "100vh" }}
      >
        <div className="text-center">
          <div
            className="spinner-border mb-3"
            role="status"
            style={{ width: "3rem", height: "3rem", color: "#0d6efd" }}
          />
          <div className="fw-semibold" style={{ color: "#1f2933" }}>
            Preparing call status dashboard...
          </div>
          <div className="small text-muted mt-1">
            Fetching latest leads and follow-up history.
          </div>
        </div>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div
        className="d-flex align-items-center justify-content-center"
        style={{ minHeight: "100vh" }}
      >
        <div
          className="card shadow-sm border-0"
          style={{
            maxWidth: 460,
            borderRadius: "1.5rem",
            boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
          }}
        >
          <div className="card-body text-center p-4 p-md-5">
            <h5 className="card-title mb-2 fw-semibold">
              No status records found
            </h5>
            <p className="card-text small text-muted mb-0">
              Leads with statuses{" "}
              <strong>
                Details_shared, Visit Scheduled, NR/SF, RNR, Site Visited,
                Booked, Invalid, Not Interested
              </strong>{" "}
              will automatically appear here once updated from the main leads
              page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!filteredRows.length) {
    return (
      <div
        className="d-flex align-items-center justify-content-center"
        style={{ minHeight: "100vh" }}
      >
        <div
          className="card shadow-sm border-0"
          style={{
            maxWidth: 460,
            borderRadius: "1.5rem",
            boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
          }}
        >
          <div className="card-body text-center p-4 p-md-5">
            <h5 className="card-title mb-2 fw-semibold">
              No records match the selected filters
            </h5>
            <p className="card-text small text-muted mb-3">
              Try clearing some filters to see more leads.
            </p>
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              onClick={() => {
                setMobileFilter("");
                setFromDateFilter("");
                setToDateFilter("");
                setStatusFilter("All");
              }}
            >
              Clear all filters
            </button>
          </div>
        </div>
      </div>
    );
  }

  let safeIndex = currentIndex;
  if (safeIndex < 0) safeIndex = 0;
  if (safeIndex > filteredRows.length - 1) safeIndex = filteredRows.length - 1;

  const currentRow = filteredRows[safeIndex];
  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < filteredRows.length - 1;

  if (!currentRow) {
    return (
      <div
        className="d-flex align-items-center justify-content-center"
        style={{ minHeight: "100vh" }}
      >
        <div
          className="card shadow-sm border-0"
          style={{
            maxWidth: 460,
            borderRadius: "1.5rem",
            boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
          }}
        >
          <div className="card-body text-center p-4 p-md-5">
            <h5 className="card-title mb-2 fw-semibold">
              No current record to display
            </h5>
            <p className="card-text small text-muted mb-3">
              Please adjust filters or go back to the first record.
            </p>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setCurrentIndex(0)}
            >
              Go to first record
            </button>
          </div>
        </div>
      </div>
    );
  }

  const historyForCurrent = followUpHistory[currentRow.lead_id] || [];
  const newRemarkValue = newRemarkByLead[currentRow.lead_id] || "";

  const requiresVisitDate = currentRow.status === "Visit Scheduled";
  const hasStatus = !!(currentRow.status && currentRow.status !== "");
  const hasDate = !!currentRow.date;
  const canSave =
    hasStatus &&
    (!requiresVisitDate || hasDate) &&
    savingId !== currentRow.lead_id;

  const statusPillStyle = getRowBackground(currentRow.status);

  // Compute NR/SF or RNR streak count badge
  let nsrBadgeLabel = "";
  if (currentRow.status === "NR/SF" || currentRow.status === "RNR") {
    const streakCount = getConsecutiveSameStatusCount(
      historyForCurrent,
      currentRow.status
    );
    nsrBadgeLabel = `${currentRow.status} count: ${streakCount}`;
  }

  return (
    <div className="py-4 py-md-5">
      <div className="container-xl" style={{ maxWidth: "1500px" }}>
        <div className="row mb-3 mb-md-4">
          <div className="col-12">
            <div
              className="card border-0 shadow-sm"
              style={{
                borderRadius: "1.5rem",
                overflow: "hidden",
                boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
                border: "1px solid rgba(148,163,184,0.25)",
              }}
            >
              <div
                style={{
                  background:
                    "linear-gradient(120deg, #0d6efd 0%, #2563eb 45%, #4f46e5 100%)",
                  color: "#fff",
                  padding: "14px 20px",
                  boxShadow: "0 10px 30px rgba(37,99,235,0.35)",
                }}
              >
                <div className="d-flex flex-wrap justify-content-between align-items-center gap-3">
                  <div>
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <div
                        className="d-inline-flex align-items-center justify-content-center rounded-circle"
                        style={{
                          width: 40,
                          height: 40,
                          backgroundColor: "rgba(255,255,255,0.16)",
                          fontSize: 18,
                        }}
                      >
                        CS
                      </div>
                      <div>
                        <h3
                          className="fw-semibold mb-0"
                          style={{ fontSize: "1.5rem", letterSpacing: "0.01em" }}
                        >
                          Call Status &amp; Follow-Up Dashboard
                        </h3>
                        <div
                          className="small"
                          style={{ opacity: 0.9, maxWidth: 520 }}
                        >
                          Process one lead at a time with complete call history
                          and structured status updates.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="d-flex flex-wrap gap-3">
                    <div className="text-end">
                      <div
                        className="text-uppercase small"
                        style={{ opacity: 0.7 }}
                      >
                        Total Records
                      </div>
                      <div
                        className="fw-bold"
                        style={{ fontSize: "1.35rem", lineHeight: 1.1 }}
                      >
                        {rows.length}
                      </div>
                    </div>
                    <div className="text-end">
                      <div
                        className="text-uppercase small"
                        style={{ opacity: 0.7 }}
                      >
                        Filtered
                      </div>
                      <div
                        className="fw-bold"
                        style={{ fontSize: "1.35rem", lineHeight: 1.1 }}
                      >
                        {filteredRows.length}
                      </div>
                    </div>
                    <div className="text-end">
                      <div
                        className="text-uppercase small"
                        style={{ opacity: 0.7 }}
                      >
                        Current
                      </div>
                      <div
                        className="fw-bold"
                        style={{ fontSize: "1.05rem", lineHeight: 1.1 }}
                      >
                        {safeIndex + 1} / {filteredRows.length}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-3 py-2 border-bottom bg-white">
                <div className="d-flex flex-wrap align-items-center gap-3 small text-muted">
                  <span className="fw-semibold text-secondary me-1">
                    Status Legend:
                  </span>

                  <span className="d-inline-flex align-items-center gap-1">
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        backgroundColor: "#d1e7dd",
                        border: "1px solid #bcd0c7",
                      }}
                    />
                    <span>Details_shared</span>
                  </span>

                  <span className="d-inline-flex align-items-center gap-1">
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        backgroundColor: "#94afa5",
                        border: "1px solid #6f9184",
                      }}
                    />
                    <span>Booked</span>
                  </span>

                  <span className="d-inline-flex align-items-center gap-1">
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        backgroundColor: "#fff3cd",
                        border: "1px solid #ffec99",
                      }}
                    />
                    <span>NR/SF</span>
                  </span>

                  <span className="d-inline-flex align-items-center gap-1">
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        backgroundColor: "#ffe5b4",
                        border: "1px solid #ffc97a",
                      }}
                    />
                    <span>RNR</span>
                  </span>

                  <span className="d-inline-flex align-items-center gap-1">
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        backgroundColor: "#cfe2ff",
                        border: "1px solid #9ec5fe",
                      }}
                    />
                    <span>Site Visited</span>
                  </span>

                  <span className="d-inline-flex align-items-center gap-1">
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        backgroundColor: "#f8d7da",
                        border: "1px solid #f5c2c7",
                      }}
                    />
                    <span>Not Interested</span>
                  </span>

                  <span className="d-inline-flex align-items-center gap-1">
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        backgroundColor: "#e2e3e5",
                        border: "1px solid #c4c4c6",
                      }}
                    />
                    <span>Invalid</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters Card */}
        <div className="row mb-3 mb-md-4">
          <div className="col-12">
            <div
              className="card border-0 shadow-sm"
              style={{
                borderRadius: "1.25rem",
                boxShadow: "0 14px 35px rgba(15,23,42,0.06)",
                border: "1px solid rgba(148,163,184,0.25)",
              }}
            >
              <div className="card-body py-3 py-md-4">
                <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                  <div>
                    <h6 className="mb-0 fw-semibold text-muted text-uppercase small">
                      Filters
                    </h6>
                    <div className="small text-muted">
                      Refine by status, mobile number, and call date. The card
                      view updates instantly.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => {
                      setMobileFilter("");
                      setFromDateFilter("");
                      setToDateFilter("");
                      setStatusFilter("All");
                    }}
                  >
                    Reset All
                  </button>
                </div>

                <div className="row g-3">
                  <div className="col-12 col-md-3">
                    <label className="form-label mb-1 small text-muted">
                      Status
                    </label>
                    <select
                      className="form-select form-select-sm"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="All">All</option>
                      <option value="Details_shared">Details_shared</option>
                      <option value="Visit Scheduled">Visit Scheduled</option>
                      <option value="NR/SF">NR/SF</option>
                      <option value="RNR">RNR</option>
                      <option value="Site Visited">Site Visited</option>
                      <option value="Booked">Booked</option>
                      <option value="Invalid">Invalid</option>
                      <option value="Not Interested">Not Interested</option>
                    </select>
                  </div>

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
                </div>

                {(mobileFilter ||
                  fromDateFilter ||
                  toDateFilter ||
                  statusFilter !== "All") && (
                  <div className="mt-3 small text-muted">
                    Showing{" "}
                    <strong>
                      {filteredRows.length} / {rows.length}
                    </strong>{" "}
                    records based on active filters.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Lead Card */}
        <div className="row">
          <div className="col-12 col-lg-8 mx-auto">
            <div
              className="card border-0 shadow-sm"
              style={{
                borderRadius: "1.5rem",
                boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
                border: "1px solid rgba(148,163,184,0.25)",
                overflow: "hidden",
              }}
            >
              <div className="card-header bg-white border-bottom-0 rounded-top-3">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <div className="d-flex align-items-center gap-3">
                    <div
                      className="rounded-circle d-flex align-items-center justify-content-center"
                      style={{
                        width: 40,
                        height: 40,
                        background:
                          "radial-gradient(circle at 30% 20%, #e0f2fe, #0d6efd20)",
                        color: "#0f172a",
                        fontWeight: 600,
                        fontSize: "0.95rem",
                        textTransform: "uppercase",
                      }}
                    >
                      {(currentRow.name && currentRow.name[0]) ||
                        (currentRow.mobile &&
                          currentRow.mobile.toString().slice(-2)) ||
                        "L"}
                    </div>
                    <div>
                      <div className="small text-lg text-muted text-uppercase fw-semibold">
                        Lead Details
                      </div>
                      <div className="fw-semibold text-lg">
                        {currentRow.name || "Unnamed Lead"}
                      </div>
                    </div>
                  </div>

                  <div className="text-end">
                    <span
                      className="badge rounded-pill px-3 py-2"
                      style={{
                        fontSize: "0.7rem",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        ...statusPillStyle,
                        boxShadow: "0 0 0 1px rgba(148,163,184,0.25)",
                      }}
                    >
                      {currentRow.status || "No Status"}
                    </span>

                    {/* NR/SF / RNR streak badge */}
                    {nsrBadgeLabel && (
                      <div className="mt-1">
                        <span
                          className="badge rounded-pill"
                          style={{
                            fontSize: "0.65rem",
                            backgroundColor: "#f3f4ff",
                            color: "#4338ca",
                            border: "1px solid rgba(129,140,248,0.6)",
                          }}
                        >
                          {nsrBadgeLabel}
                        </span>
                      </div>
                    )}

                    <div className="small text-muted mt-1">
                      Record {safeIndex + 1} of {filteredRows.length} (Filtered)
                    </div>
                  </div>
                </div>
              </div>

              <div className="card-body pt-2 pb-3 pb-md-4">
                <hr className="mt-0 mb-3" />
                <div className="row g-3 g-md-4">
                  <div className="col-12 col-md-6">
                    <label className="form-label small text-muted">
                      Mobile
                    </label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={currentRow.mobile || ""}
                      readOnly
                    />

                    <label className="form-label small text-muted mt-3">
                      Name
                    </label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={currentRow.name || ""}
                      readOnly
                    />

                    <label className="form-label small text-muted mt-3">
                      Source
                    </label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={currentRow.source || ""}
                      readOnly
                    />

                    <label className="form-label small text-muted mt-3">
                      Project
                    </label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={currentRow.project || ""}
                      onChange={(e) =>
                        handleFieldChange(
                          currentRow.lead_id,
                          "project",
                          e.target.value
                        )
                      }
                    />
                    <div className="form-text small text-muted">
                      You can update the project even after the lead is saved.
                    </div>

                    {currentRow.Assigned_to && (
                      <>
                        <label className="form-label small text-muted mt-3">
                          Assigned To
                        </label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={currentRow.Assigned_to}
                          readOnly
                        />
                      </>
                    )}
                  </div>

                  <div className="col-12 col-md-6">
                    <label className="form-label small text-muted">
                      Status
                    </label>
                    <select
                      className="form-select form-select-sm"
                      value={currentRow.status || ""}
                      onChange={(e) =>
                        handleFieldChange(
                          currentRow.lead_id,
                          "status",
                          e.target.value
                        )
                      }
                    >
                      <option disabled value="">
                        Select status
                      </option>
                      <option value="Details_shared">Details_shared</option>
                      <option value="Visit Scheduled">Visit Scheduled</option>
                      <option value="NR/SF">NR/SF</option>
                      <option value="RNR">RNR</option>
                      <option value="Site Visited">Site Visited</option>
                      <option value="Booked">Booked</option>
                      <option value="Invalid">Invalid</option>
                      <option value="Not Interested">Not Interested</option>
                    </select>

                    <label className="form-label small text-muted mt-3">
                      Call / Visit Date &amp; Time
                    </label>
                    <input
                      type="datetime-local"
                      className="form-control form-control-sm"
                      value={formatDateForInput(currentRow.date)}
                      disabled={HARD_LOCK_STATUSES.includes(
                        currentRow.status
                      )}
                      onChange={(e) =>
                        handleFieldChange(
                          currentRow.lead_id,
                          "date",
                          e.target.value
                        )
                      }
                    />
                    <div className="form-text small">
                      {currentRow.status === "NR/SF" ||
                      currentRow.status === "RNR"
                        ? "Date is auto-set to now + 24 hours and locked."
                        : currentRow.status === "Visit Scheduled"
                        ? "For Visit Scheduled, please select exact date & time before saving."
                        : "For other follow-up statuses, leaving this empty will auto-set now + 24 hours on save."}
                    </div>
                  </div>

                  <div className="col-12">
                    <label className="form-label small text-muted">
                      Previous Remarks (Read-Only)
                    </label>
                    <div
                      className="border rounded p-2 bg-light"
                      style={{
                        maxHeight: "220px",
                        overflowY: "auto",
                        fontSize: "0.8rem",
                        background:
                          "linear-gradient(135deg,#f9fafb 0%,#f3f4f6 100%)",
                      }}
                    >
                      {historyForCurrent && historyForCurrent.length ? (
                        historyForCurrent.map((fu, idx) => (
                          <div key={(fu._id || fu.followup_id || "") + idx}>
                            <div className="fw-semibold text-muted">
                              {fu.date
                                ? formatDateTimeDisplay(fu.date)
                                : "No date"}{" "}
                              {fu.status ? `• ${fu.status}` : ""}
                            </div>
                            <div className="text-body">
                              {fu.remarks ? (
                                fu.remarks
                              ) : (
                                <span className="text-muted">
                                  — No remark —
                                </span>
                              )}
                            </div>
                            {idx !== historyForCurrent.length - 1 && (
                              <hr className="my-1" />
                            )}
                          </div>
                        ))
                      ) : currentRow.remarks ? (
                        <div>
                          <div className="fw-semibold text-muted">
                            Latest Remark (from Lead)
                          </div>
                          <div>{currentRow.remarks}</div>
                        </div>
                      ) : (
                        <div className="text-muted">
                          No previous remarks found for this lead.
                        </div>
                      )}
                    </div>

                    <label className="form-label small text-muted mt-3">
                      Add New Remark
                    </label>
                    <textarea
                      rows={3}
                      className="form-control form-control-sm"
                      value={newRemarkValue}
                      onChange={(e) =>
                        setNewRemarkByLead((prev) => ({
                          ...prev,
                          [currentRow.lead_id]: e.target.value,
                        }))
                      }
                      placeholder="Type only the new remark here. Old remarks will remain unchanged above."
                    />
                    <div className="form-text small text-muted">
                      Previous remarks are read-only. When you click{" "}
                      <strong>Save</strong>, this new remark will be stored in
                      follow-up history and on the lead record. The call date
                      &amp; time will be set to the current time automatically
                      when a new remark is added.
                    </div>
                  </div>
                </div>
              </div>

              <div className="card-footer bg-white border-top-0 py-3">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    disabled={!hasPrev}
                    onClick={() => {
                      if (hasPrev) setCurrentIndex((prev) => prev - 1);
                    }}
                  >
                    ← Previous
                  </button>

                  <div className="d-flex gap-2 align-items-center flex-wrap justify-content-end">
                    {!hasStatus ? (
                      <span className="small text-muted me-2">
                        Select status to enable Save
                      </span>
                    ) : requiresVisitDate && !hasDate ? (
                      <span className="small text-warning me-2">
                        Select visit date &amp; time to enable Save
                      </span>
                    ) : null}

                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      disabled={!hasNext}
                      onClick={() => {
                        if (hasNext) setCurrentIndex((prev) => prev + 1);
                      }}
                    >
                      Next →
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm px-4"
                      disabled={!canSave}
                      style={{
                        background:
                          "linear-gradient(120deg,#0d6efd 0%,#2563eb 45%,#4f46e5 100%)",
                        border: "none",
                        color: "#fff",
                        opacity: canSave ? 1 : 0.7,
                      }}
                      onClick={() => {
                        const nextLead = filteredRows[safeIndex + 1] || null;
                        const nextLeadId = nextLead ? nextLead.lead_id : null;
                        handleSave(currentRow, nextLeadId);
                      }}
                    >
                      {savingId === currentRow.lead_id
                        ? "Saving..."
                        : hasNext
                        ? "Save & Next"
                        : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
export default StatusDashboard;
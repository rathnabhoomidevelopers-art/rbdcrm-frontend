// src/UserDashboard.js
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Users,
  ClipboardList,
  MapPinCheck,
  PhoneCall,
  RefreshCw,
  CircleXIcon,
} from "lucide-react";
import { api } from "./api";

/* ===================== CONSTANTS ===================== */
const AUTO_24H_STATUSES = ["NR/SF", "RNR", "Details_shared", "Site Visited"];
const HARD_LOCK_STATUSES = ["NR/SF", "RNR"];

const DASHBOARD_FOLLOWUP_STATUSES = [
  "Follow Up",
  "Follow-up",
  "Visit Scheduled",
  "NR/SF",
  "RNR",
  "Details_shared",
  "Site Visited",
];

/* ===================== HELPERS ===================== */
const toLocalInputValue = (date) => {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
};

const getNowPlus24Hours = () => {
  const d = new Date();
  d.setHours(d.getHours() + 24);
  return toLocalInputValue(d);
};

const normalizeAndValidateMobile = (raw) => {
  if (!raw) {
    return { ok: false, error: "Mobile number is required", normalized: "" };
  }

  let digits = raw.toString().replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (digits.length !== 10) {
    return {
      ok: false,
      error: "Mobile must be 10 digits after removing country/0 prefix",
      normalized: digits,
    };
  }

  if (!/^[6-9]\d{9}$/.test(digits)) {
    return {
      ok: false,
      error: "Enter a valid mobile number",
      normalized: digits,
    };
  }

  if (/^(\d)\1{9}$/.test(digits)) {
    return {
      ok: false,
      error: "Mobile number looks invalid (repeated digits)",
      normalized: digits,
    };
  }

  return { ok: true, error: null, normalized: digits };
};

/* ===================== COMPONENT ===================== */
export function UserDashboard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [stats, setStats] = useState({
    totalLeads: 0,
    totalFollowUps: 0,
    totalSiteVisits: 0,
    totalBooked: 0,
  });

  const [followUpAlerts, setFollowUpAlerts] = useState({
    overdue: [],
    today: [],
    tomorrow: [],
  });

  const [lastUpdated, setLastUpdated] = useState(null);

  const [leadsData, setLeadsData] = useState([]);
  const [followUpsData, setFollowUpsData] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalRows, setModalRows] = useState([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newLead, setNewLead] = useState({
    name: "",
    mobile: "",
    source: "",
    status: "",
    job_role: "",
    budget: "",
    remarks: "",
    dob: "",
    Assigned_to: "",
    project: "",
  });

  // Edit state for rows inside modal
  const [editingRowId, setEditingRowId] = useState(null); // stores LEAD ID
  const [editRowData, setEditRowData] = useState(null); // editable data for that row

  const role = localStorage.getItem("role");
  const username = (localStorage.getItem("username") || "")
    .toString()
    .trim()
    .toLowerCase();

  const formatDateTime = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  };

  /* ===================== FETCH STATS (FIXED) ===================== */
  const fetchStats = async ({ showFullScreenLoader = false } = {}) => {
    try {
      if (showFullScreenLoader) setLoading(true);
      setRefreshing(!showFullScreenLoader);

      const [leadsRes, followUpsRes] = await Promise.all([
        api.get("/leads"),
        api.get("/follow-ups"),
      ]);

      let leads = leadsRes.data || [];
      let followUpsAll = followUpsRes.data || [];

      // ✅ USER FILTER (fix: use lead_id consistently)
      if (role === "user") {
        leads = leads.filter(
          (l) =>
            (l.Assigned_to || "").toString().trim().toLowerCase() === username
        );

        const myLeadIds = new Set(leads.map((l) => l.lead_id || l._id));
        followUpsAll = followUpsAll.filter((fu) =>
          myLeadIds.has(fu.lead_id || fu.followup_id)
        );
      }

      // ✅ Lead map
      const leadMap = {};
      leads.forEach((l) => {
        const k = l.lead_id || l._id;
        if (k) leadMap[k] = l;
      });

      // ✅ Latest follow-up per LEAD (group by fu.lead_id)
      const latestByLead = {};
      const getTime = (item) => {
        if (!item || !item.date) return 0;
        const t = new Date(item.date).getTime();
        return Number.isNaN(t) ? 0 : t;
      };

      followUpsAll.forEach((fu) => {
        const leadKey = fu.lead_id; // ✅ IMPORTANT
        if (!leadKey) return;

        const existing = latestByLead[leadKey];
        if (!existing || getTime(fu) >= getTime(existing)) {
          latestByLead[leadKey] = fu;
        }
      });

      // ✅ Effective follow-ups: lead.status overrides followup.status
      const latestFollowUps = Object.values(latestByLead);
      const effectiveFollowUps = latestFollowUps.map((fu) => {
        const lead = leadMap[fu.lead_id];
        return {
          ...fu,
          __effectiveStatus: (lead && lead.status) || fu.status || "",
        };
      });

      const onlyFollowUps = effectiveFollowUps.filter((fu) =>
        DASHBOARD_FOLLOWUP_STATUSES.includes(fu.__effectiveStatus)
      );

      const totalLeads = leads.length;
      const totalFollowUps = onlyFollowUps.length;
      const totalSiteVisits = leads.filter((l) => l.status === "Site Visited")
        .length;
      const totalBooked = leads.filter((l) => l.status === "Booked").length;

      // date buckets
      const now = new Date();
      const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0
      );
      const startOfTomorrow = new Date(startOfToday);
      startOfTomorrow.setDate(startOfToday.getDate() + 1);
      const startOfDayAfterTomorrow = new Date(startOfToday);
      startOfDayAfterTomorrow.setDate(startOfToday.getDate() + 2);

      const overdue = [];
      const today = [];
      const tomorrow = [];

      onlyFollowUps.forEach((fu) => {
        if (!fu.date) return;
        const d = new Date(fu.date);
        if (Number.isNaN(d.getTime())) return;

        if (d < startOfToday) overdue.push(fu);
        else if (d >= startOfToday && d < startOfTomorrow) today.push(fu);
        else if (d >= startOfTomorrow && d < startOfDayAfterTomorrow)
          tomorrow.push(fu);
      });

      const sortByDate = (arr) =>
        arr.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

      setStats({ totalLeads, totalFollowUps, totalSiteVisits, totalBooked });

      setFollowUpAlerts({
        overdue: sortByDate(overdue),
        today: sortByDate(today),
        tomorrow: sortByDate(tomorrow),
      });

      setLastUpdated(new Date().toISOString());
      setLeadsData(leads);
      setFollowUpsData(onlyFollowUps);
    } catch (err) {
      console.error("Error fetching dashboard stats", {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      toast.error("Failed to load dashboard summary");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  /* ===================== INIT ===================== */
  useEffect(() => {
    let active = true;

    const init = async () => {
      if (!active) return;
      await fetchStats({ showFullScreenLoader: true });
    };
    init();

    const handler = () => fetchStats({ showFullScreenLoader: false });
    window.addEventListener("leads-updated", handler);

    return () => {
      active = false;
      window.removeEventListener("leads-updated", handler);
    };
  }, []);

  /* ===================== LEAD INDEX ===================== */
  const leadIndex = {};
  (leadsData || []).forEach((l) => {
    const key = l.lead_id || l._id;
    if (key) leadIndex[key] = l;
  });

  /* ===================== GROUPING ===================== */
  const buildUserStatusGroups = (items) => {
    const result = {};
    (items || []).forEach((fu) => {
      const key = fu.lead_id || fu.followup_id || fu._id; // ✅ prefer lead_id
      const lead = leadIndex[key];

      const assignedRaw =
        lead && lead.Assigned_to ? lead.Assigned_to : "Unassigned";
      const assigned = assignedRaw.trim() || "Unassigned";

      const st = (lead && lead.status) || fu.__effectiveStatus || fu.status || "Unknown";

      if (!result[assigned]) result[assigned] = {};
      if (!result[assigned][st]) result[assigned][st] = [];
      result[assigned][st].push({ fu, lead });
    });
    return result;
  };

  const overdueUserGroups = buildUserStatusGroups(followUpAlerts.overdue);
  const todayUserGroups = buildUserStatusGroups(followUpAlerts.today);
  const tomorrowUserGroups = buildUserStatusGroups(followUpAlerts.tomorrow);

  /* ===================== MODALS ===================== */
  const openModal = (type) => {
    let title = "";
    let rows = [];

    if (type === "leads") {
      title = "All Leads";
      rows = (leadsData || []).map((l) => ({
        id: l.lead_id || l._id,
        leadKey: l.lead_id || l._id,
        name: l.name || "",
        mobile: l.mobile || "",
        status: l.status || "",
        source: l.source || "",
        date: l.dob || null,
        remarks: l.remarks || "",
        Assigned_to: l.Assigned_to || "",
        project: l.project || "",
      }));
    } else if (type === "followups") {
      title = "Follow-Up Leads";
      rows = (followUpsData || []).map((fu) => {
        const key = fu.lead_id || fu.followup_id || fu._id; // ✅ prefer lead_id
        const lead = leadIndex[key];

        const leadKey =
          (lead && (lead.lead_id || lead._id)) ||
          fu.lead_id ||
          fu.followup_id ||
          fu._id;

        return {
          id: fu.followup_id || fu._id,
          leadKey,
          name: fu.name || (lead && lead.name) || "",
          mobile: fu.mobile || (lead && lead.mobile) || "",
          status: (lead && lead.status) || fu.__effectiveStatus || fu.status || "",
          source: fu.source || (lead && lead.source) || "",
          date: fu.date || (lead && lead.dob) || null,
          remarks: fu.remarks || (lead && lead.remarks) || "",
          Assigned_to: (lead && lead.Assigned_to) || fu.Assigned_to || "",
          project: fu.project || (lead && lead.project) || "",
        };
      });
    } else if (type === "sitevisits") {
      title = "Site Visit Leads";
      const filtered = (leadsData || []).filter((l) => l.status === "Site Visited");
      rows = filtered.map((l) => ({
        id: l.lead_id || l._id,
        leadKey: l.lead_id || l._id,
        name: l.name || "",
        mobile: l.mobile || "",
        status: l.status || "",
        source: l.source || "",
        date: l.dob || null,
        remarks: l.remarks || "",
        Assigned_to: l.Assigned_to || "",
        project: l.project || "",
      }));
    } else if (type === "booked") {
      title = "Booked Leads";
      const filtered = (leadsData || []).filter((l) => l.status === "Booked");
      rows = filtered.map((l) => ({
        id: l.lead_id || l._id,
        leadKey: l.lead_id || l._id,
        name: l.name || "",
        mobile: l.mobile || "",
        status: l.status || "",
        source: l.source || "",
        date: l.dob || null,
        remarks: l.remarks || "",
        Assigned_to: l.Assigned_to || "",
        project: l.project || "",
      }));
    }

    setModalTitle(title);
    setModalRows(rows);
    setModalOpen(true);
    setEditingRowId(null);
    setEditRowData(null);
  };

  const openGroupModal = (bucketLabel, assignedTo, status, items) => {
    const title = `${bucketLabel} – ${assignedTo} – ${status}`;
    const rows = (items || []).map(({ fu, lead }) => {
      const leadKey =
        (lead && (lead.lead_id || lead._id)) ||
        fu.lead_id ||
        fu.followup_id ||
        fu._id;

      return {
        id: fu.followup_id || fu._id,
        leadKey,
        name: fu.name || (lead && lead.name) || "",
        mobile: fu.mobile || (lead && lead.mobile) || "",
        status: (lead && lead.status) || fu.__effectiveStatus || fu.status || "",
        source: fu.source || (lead && lead.source) || "",
        date: fu.date || (lead && lead.dob) || null,
        remarks: fu.remarks || (lead && lead.remarks) || "",
        Assigned_to: (lead && lead.Assigned_to) || fu.Assigned_to || "",
        project: fu.project || (lead && lead.project) || "",
      };
    });

    setModalTitle(title);
    setModalRows(rows);
    setModalOpen(true);
    setEditingRowId(null);
    setEditRowData(null);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalRows([]);
    setModalTitle("");
    setEditingRowId(null);
    setEditRowData(null);
  };

  /* ===================== ADD LEAD ===================== */
  const openAddLeadModal = () => {
    setNewLead({
      name: "",
      mobile: "",
      source: "",
      status: "",
      job_role: "",
      budget: "",
      remarks: "",
      dob: "",
      Assigned_to: username || "",
      project: "",
    });
    setShowAddModal(true);
  };

  const closeAddLeadModal = () => setShowAddModal(false);

  const handleNewLeadChange = (field, value) => {
    setNewLead((prev) => {
      const updated = { ...prev };

      if (field === "status") {
        updated.status = value;

        if (value === "NR/SF" || value === "RNR") {
          updated.dob = getNowPlus24Hours();
        } else if (value === "Visit Scheduled" || value === "Details_shared") {
          updated.dob = "";
        }
      } else if (field === "dob") {
        if (HARD_LOCK_STATUSES.includes(prev.status)) return prev;
        updated.dob = value || "";
      } else {
        updated[field] = value;
      }

      return updated;
    });
  };

  const handleAddLeadSubmit = async (e) => {
    e.preventDefault();

    const { ok, error, normalized } = normalizeAndValidateMobile(newLead.mobile);
    if (!ok) {
      toast.error(error);
      return;
    }

    const trimmedMobile = normalized;

    const existingLocal = (leadsData || []).find(
      (l) => (l.mobile || "").toString().trim() === trimmedMobile
    );
    if (existingLocal) {
      toast.error(
        `This mobile already exists for lead ${existingLocal.name || existingLocal.lead_id}`
      );
      return;
    }

    try {
      let statusToSave = newLead.status || "";
      let dobToSave = newLead.dob || "";

      if (statusToSave === "Visit Scheduled" && (!dobToSave || dobToSave === "")) {
        toast.error("Please select visit date & time before saving lead.");
        return;
      }

      if (AUTO_24H_STATUSES.includes(statusToSave) && (!dobToSave || dobToSave === "")) {
        dobToSave = getNowPlus24Hours();
      }

      await api.post("/add-lead", {
        name: newLead.name || null,
        mobile: trimmedMobile,
        source: newLead.source || null,
        status: statusToSave,
        job_role: newLead.job_role || null,
        budget: newLead.budget || null,
        remarks: newLead.remarks || null,
        dob: dobToSave || null,
        Assigned_to: newLead.Assigned_to || null,
        project: newLead.project || null,
      });

      toast.success("Lead added successfully");

      window.dispatchEvent(new Event("leads-updated"));
      await fetchStats({ showFullScreenLoader: false });

      setShowAddModal(false);
    } catch (err) {
      console.error("Error adding lead", {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      toast.error("Failed to add lead");
    }
  };

  /* ===================== EDIT IN MODAL ===================== */
  const startEditRow = (row) => {
    const rowId = row.leadKey || row.id;
    setEditingRowId(rowId);
    setEditRowData({
      ...row,
      leadKey: rowId,
      date: row.date ? toLocalInputValue(row.date) : "",
    });
  };

  const cancelEditRow = () => {
    setEditingRowId(null);
    setEditRowData(null);
  };

  const handleEditRowChange = (field, value) => {
    setEditRowData((prev) => {
      const next = { ...prev, [field]: value };

      if (field === "status") {
        if (AUTO_24H_STATUSES.includes(value) && (!prev.date || prev.date === "")) {
          next.date = getNowPlus24Hours();
        }
      }

      if (field === "date") {
        if (HARD_LOCK_STATUSES.includes(prev.status)) return prev;
      }

      return next;
    });
  };

  const handleSaveEditRow = async () => {
    if (!editRowData || !editingRowId) return;

    try {
      const payload = {
        status: editRowData.status || null,
        remarks: editRowData.remarks || null,
        project: editRowData.project || null,
        dob: editRowData.date || null,
        Assigned_to: editRowData.Assigned_to || null,
      };

      await api.put(`/edit-lead/${editingRowId}`, payload);

      toast.success("Lead updated successfully");
      setModalRows((prev) =>
        prev.map((r) =>
          (r.leadKey || r.id) === editingRowId ? { ...r, ...editRowData } : r
        )
      );

      window.dispatchEvent(new Event("leads-updated"));
      await fetchStats({ showFullScreenLoader: false });

      cancelEditRow();
    } catch (err) {
      console.error("Error updating lead", {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      toast.error("Failed to update lead");
    }
  };

  /* ===================== LOADING ===================== */
  if (loading) {
    return (
      <div
        className="d-flex align-items-center justify-content-center"
        style={{
          minHeight: "100vh",
          background:
            "radial-gradient(circle at top, #e0f2ff 0, #f3f4f6 45%, #eef1f4 100%)",
        }}
      >
        <div className="text-center">
          <div className="spinner-border text-primary mb-3" role="status" />
          <div className="fw-semibold text-muted" style={{ fontSize: "1.1rem" }}>
            Preparing your dashboard…
          </div>
        </div>
      </div>
    );
  }

  /* ===================== UI ===================== */
  return (
    <div
      className="py-4"
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, #e0f2ff 0, #f3f4f6 45%, #eef1f4 100%)",
      }}
    >
      <div className="container-xl" style={{ maxWidth: "1500px" }}>
        <div className="row mb-4">
          <div className="col-12">
            <div
              className="card border-0 shadow-sm"
              style={{
                borderRadius: "1.4rem",
                overflow: "hidden",
                boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div
                style={{
                  background:
                    "linear-gradient(120deg, #0d6efd 0%, #0b5ed7 35%, #2563eb 70%, #1d4ed8 100%)",
                  color: "#fff",
                  padding: "22px 26px",
                }}
              >
                <div className="d-flex flex-wrap justify-content-between align-items-center gap-3">
                  <div>
                    <div className="d-flex align-items-center gap-3 mb-2">
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-circle"
                        style={{
                          width: 48,
                          height: 48,
                          backgroundColor: "rgba(255,255,255,0.14)",
                          fontSize: 24,
                        }}
                      >
                        📊
                      </span>
                      <div>
                        <h2 className="fw-semibold mb-1" style={{ fontSize: "2rem" }}>
                          {role === "admin"
                            ? "Admin Follow-up Dashboard"
                            : "User Performance Dashboard"}
                        </h2>
                        <div style={{ opacity: 0.9, maxWidth: 520, fontSize: "1rem" }}>
                          Stay on top of your{" "}
                          <strong>leads, follow-ups, site visits</strong> and{" "}
                          <strong>bookings</strong> at a glance.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="d-flex flex-column align-items-end gap-2">
                    <div className="d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-light d-flex align-items-center gap-2 px-4 py-2 shadow-sm rounded-pill"
                        onClick={() => fetchStats({ showFullScreenLoader: false })}
                        disabled={refreshing}
                        style={{ fontSize: "0.95rem", fontWeight: 600 }}
                      >
                        <RefreshCw size={16} className={refreshing ? "spin" : ""} />
                        <span>{refreshing ? "Refreshing…" : "Refresh Data"}</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-warning d-flex align-items-center gap-2 px-4 py-2 shadow-sm rounded-pill"
                        onClick={openAddLeadModal}
                        style={{ fontSize: "0.95rem", fontWeight: 600 }}
                      >
                        <span style={{ fontSize: 18 }}>＋</span>
                        <span>Add Lead</span>
                      </button>
                    </div>
                    {lastUpdated && (
                      <small style={{ opacity: 0.8, fontSize: "0.8rem" }}>
                        Last updated: {formatDateTime(lastUpdated)}
                      </small>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Follow-up Alerts Section */}
        <div className="row g-3 mb-4">
          {followUpAlerts.overdue.length === 0 &&
          followUpAlerts.today.length === 0 &&
          followUpAlerts.tomorrow.length === 0 ? (
            <div className="col-12">
              <div
                className="card border-0 shadow-sm"
                style={{ borderRadius: "1.1rem", minHeight: 120 }}
              >
                <div className="card-body d-flex align-items-center gap-3 py-4 px-4">
                  <div
                    className="d-inline-flex align-items-center justify-content-center rounded-circle"
                    style={{
                      width: 48,
                      height: 48,
                      backgroundColor: "#e7f9ed",
                      color: "#16794c",
                      fontSize: 24,
                    }}
                  >
                    ✅
                  </div>
                  <div>
                    <div
                      className="fw-semibold text-success mb-1"
                      style={{ fontSize: "1.1rem" }}
                    >
                      You&apos;re all caught up!
                    </div>
                    <div style={{ fontSize: "0.98rem", color: "#6c757d" }}>
                      No pending follow-up calls scheduled for today or tomorrow.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Overdue */}
              <div className="col-12">
                <div
                  className="card h-100 border-0 shadow-sm"
                  style={{
                    borderRadius: "1.1rem",
                    borderLeft: "4px solid #dc3545",
                    minHeight: 210,
                  }}
                >
                  <div className="card-body py-4 px-4">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <span
                        className="badge rounded-pill"
                        style={{
                          backgroundColor: "#f8d7da",
                          color: "#842029",
                          fontSize: "0.9rem",
                        }}
                      >
                        Overdue
                      </span>
                      <span className="fw-bold text-danger" style={{ fontSize: "1.4rem" }}>
                        {followUpAlerts.overdue.length}
                      </span>
                    </div>
                    {followUpAlerts.overdue.length === 0 ? (
                      <div style={{ fontSize: "0.95rem", color: "#6c757d" }}>
                        No overdue follow-ups.
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: "0.95rem",
                            color: "#6c757d",
                            marginBottom: "0.4rem",
                          }}
                        >
                          Overdue follow-ups by user &amp; status:
                        </div>
                        <div style={{ fontSize: "0.9rem", maxHeight: 140, overflowY: "auto" }}>
                          {Object.entries(overdueUserGroups).map(
                            ([assignedTo, statusMap], idxUser) => (
                              <div key={`${assignedTo}-${idxUser}`} className="mb-2">
                                <div className="fw-semibold">{assignedTo}</div>
                                <div className="ms-2 d-flex flex-wrap gap-2 mt-1">
                                  {Object.entries(statusMap).map(([status, list], idxStatus) => (
                                    <button
                                      key={`${assignedTo}-${status}-${idxStatus}`}
                                      type="button"
                                      className="btn btn-sm rounded-pill px-2 py-1 btn-outline-danger"
                                      onClick={() =>
                                        openGroupModal("Overdue", assignedTo, status, list)
                                      }
                                    >
                                      {status}: <strong>{list.length}</strong>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Today */}
              <div className="col-12">
                <div
                  className="card h-100 border-0 shadow-sm"
                  style={{
                    borderRadius: "1.1rem",
                    borderLeft: "4px solid #ffc107",
                    minHeight: 210,
                  }}
                >
                  <div className="card-body py-4 px-4">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <span
                        className="badge rounded-pill"
                        style={{
                          backgroundColor: "#fff3cd",
                          color: "#856404",
                          fontSize: "0.9rem",
                        }}
                      >
                        Today
                      </span>
                      <span className="fw-bold text-warning" style={{ fontSize: "1.4rem" }}>
                        {followUpAlerts.today.length}
                      </span>
                    </div>
                    {followUpAlerts.today.length === 0 ? (
                      <div style={{ fontSize: "0.95rem", color: "#6c757d" }}>
                        No follow-up calls scheduled for today.
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: "0.95rem",
                            color: "#6c757d",
                            marginBottom: "0.4rem",
                          }}
                        >
                          Today&apos;s follow-ups by user &amp; status:
                        </div>
                        <div style={{ fontSize: "0.9rem", maxHeight: 140, overflowY: "auto" }}>
                          {Object.entries(todayUserGroups).map(([assignedTo, statusMap], idxUser) => (
                            <div key={`${assignedTo}-today-${idxUser}`} className="mb-2">
                              <div className="fw-semibold">{assignedTo}</div>
                              <div className="ms-2 d-flex flex-wrap gap-2 mt-1">
                                {Object.entries(statusMap).map(([status, list], idxStatus) => (
                                  <button
                                    key={`${assignedTo}-today-${status}-${idxStatus}`}
                                    type="button"
                                    className="btn btn-sm rounded-pill px-2 py-1 btn-outline-warning"
                                    onClick={() =>
                                      openGroupModal("Today", assignedTo, status, list)
                                    }
                                  >
                                    {status}: <strong>{list.length}</strong>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Tomorrow */}
              <div className="col-12">
                <div
                  className="card h-100 border-0 shadow-sm"
                  style={{
                    borderRadius: "1.1rem",
                    borderLeft: "4px solid #0dcaf0",
                    minHeight: 210,
                  }}
                >
                  <div className="card-body py-4 px-4">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <span
                        className="badge rounded-pill"
                        style={{
                          backgroundColor: "#cff4fc",
                          color: "#055160",
                          fontSize: "0.9rem",
                        }}
                      >
                        Tomorrow
                      </span>
                      <span className="fw-bold text-info" style={{ fontSize: "1.4rem" }}>
                        {followUpAlerts.tomorrow.length}
                      </span>
                    </div>
                    {followUpAlerts.tomorrow.length === 0 ? (
                      <div style={{ fontSize: "0.95rem", color: "#6c757d" }}>
                        No follow-up calls scheduled for tomorrow.
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            fontSize: "0.95rem",
                            color: "#6c757d",
                            marginBottom: "0.4rem",
                          }}
                        >
                          Tomorrow&apos;s follow-ups by user &amp; status:
                        </div>
                        <div style={{ fontSize: "0.9rem", maxHeight: 140, overflowY: "auto" }}>
                          {Object.entries(tomorrowUserGroups).map(
                            ([assignedTo, statusMap], idxUser) => (
                              <div key={`${assignedTo}-tomorrow-${idxUser}`} className="mb-2">
                                <div className="fw-semibold">{assignedTo}</div>
                                <div className="ms-2 d-flex flex-wrap gap-2 mt-1">
                                  {Object.entries(statusMap).map(([status, list], idxStatus) => (
                                    <button
                                      key={`${assignedTo}-tomorrow-${status}-${idxStatus}`}
                                      type="button"
                                      className="btn btn-sm rounded-pill px-2 py-1 btn-outline-info"
                                      onClick={() =>
                                        openGroupModal("Tomorrow", assignedTo, status, list)
                                      }
                                    >
                                      {status}: <strong>{list.length}</strong>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Summary Cards */}
        <div className="row g-3">
          <div className="col-12 col-md-6 col-xl-3">
            <div
              className="card border-0 shadow-sm h-100"
              onClick={() => openModal("leads")}
              style={{
                borderRadius: "1.15rem",
                background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
                minHeight: 180,
                cursor: "pointer",
                transition: "transform 0.1s ease, box-shadow 0.1s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 16px 32px rgba(15, 23, 42, 0.18)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.12)";
              }}
            >
              <div className="card-body d-flex align-items-center gap-3 py-4 px-4">
                <div
                  className="d-inline-flex align-items-center justify-content-center rounded-circle"
                  style={{ width: 52, height: 52, backgroundColor: "#e5f3ff", color: "#0d6efd" }}
                >
                  <Users size={26} />
                </div>
                <div>
                  <div className="text-muted text-uppercase mb-1" style={{ fontSize: "0.95rem", letterSpacing: "0.04em" }}>
                    Total Leads
                  </div>
                  <div className="fw-bold" style={{ fontSize: "2.1rem", lineHeight: 1.1 }}>
                    {stats.totalLeads}
                  </div>
                  <div style={{ fontSize: "0.98rem", color: "#6c757d" }}>
                    All leads currently in the system.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Follow-ups */}
          <div className="col-12 col-md-6 col-xl-3">
            <div
              className="card border-0 shadow-sm h-100"
              onClick={() => openModal("followups")}
              style={{
                borderRadius: "1.15rem",
                background: "linear-gradient(135deg, #fffaf0 0%, #fff7e6 100%)",
                minHeight: 180,
                cursor: "pointer",
                transition: "transform 0.1s ease, box-shadow 0.1s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 16px 32px rgba(15, 23, 42, 0.18)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.12)";
              }}
            >
              <div className="card-body d-flex align-items-center gap-3 py-4 px-4">
                <div
                  className="d-inline-flex align-items-center justify-content-center rounded-circle"
                  style={{ width: 52, height: 52, backgroundColor: "#fff3cd", color: "#664d03" }}
                >
                  <ClipboardList size={26} />
                </div>
                <div>
                  <div className="text-muted text-uppercase mb-1" style={{ fontSize: "0.95rem", letterSpacing: "0.04em" }}>
                    Total Follow Ups
                  </div>
                  <div className="fw-bold" style={{ fontSize: "2.1rem", lineHeight: 1.1 }}>
                    {stats.totalFollowUps}
                  </div>
                  <div style={{ fontSize: "0.98rem", color: "#6c757d" }}>
                    Leads with planned follow-up actions.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Site Visits */}
          <div className="col-12 col-md-6 col-xl-3">
            <div
              className="card border-0 shadow-sm h-100"
              onClick={() => openModal("sitevisits")}
              style={{
                borderRadius: "1.15rem",
                background: "linear-gradient(135deg, #ecfdf3 0%, #daf5e6 100%)",
                minHeight: 180,
                cursor: "pointer",
                transition: "transform 0.1s ease, box-shadow 0.1s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 16px 32px rgba(15, 23, 42, 0.18)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.12)";
              }}
            >
              <div className="card-body d-flex align-items-center gap-3 py-4 px-4">
                <div
                  className="d-inline-flex align-items-center justify-content-center rounded-circle"
                  style={{ width: 52, height: 52, backgroundColor: "#e0f7ed", color: "#0f5132" }}
                >
                  <MapPinCheck size={26} />
                </div>
                <div>
                  <div className="text-muted text-uppercase mb-1" style={{ fontSize: "0.95rem", letterSpacing: "0.04em" }}>
                    Site Visits
                  </div>
                  <div className="fw-bold" style={{ fontSize: "2.1rem", lineHeight: 1.1 }}>
                    {stats.totalSiteVisits}
                  </div>
                  <div style={{ fontSize: "0.98rem", color: "#6c757d" }}>
                    Leads that have already visited the site.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Booked */}
          <div className="col-12 col-md-6 col-xl-3">
            <div
              className="card border-0 shadow-sm h-100"
              onClick={() => openModal("booked")}
              style={{
                borderRadius: "1.15rem",
                background: "linear-gradient(135deg, #c4f0d2 0%, #9fdfb8 100%)",
                minHeight: 180,
                cursor: "pointer",
                transition: "transform 0.1s ease, box-shadow 0.1s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 16px 32px rgba(15, 23, 42, 0.18)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.12)";
              }}
            >
              <div className="card-body d-flex align-items-center gap-3 py-4 px-4">
                <div
                  className="d-inline-flex align-items-center justify-content-center rounded-circle"
                  style={{ width: 52, height: 52, backgroundColor: "#e0f7ed", color: "#0f5132" }}
                >
                  <PhoneCall size={26} />
                </div>
                <div>
                  <div className="text-muted text-uppercase mb-1" style={{ fontSize: "0.95rem", letterSpacing: "0.04em" }}>
                    Booked
                  </div>
                  <div className="fw-bold" style={{ fontSize: "2.1rem", lineHeight: 1.1 }}>
                    {stats.totalBooked}
                  </div>
                  <div style={{ fontSize: "0.98rem", color: "#6c757d" }}>
                    Leads that are already booked.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal for rows */}
        {modalOpen && (
          <>
            <div
              className="modal fade show"
              style={{ display: "block", backgroundColor: "rgba(15,23,42,0.45)" }}
            >
              <div
                className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable"
                style={{ maxWidth: "1100px", width: "95vw" }}
              >
                <div
                  className="modal-content border-0 shadow-lg rounded-3"
                  style={{ maxHeight: "90vh", display: "flex", flexDirection: "column" }}
                >
                  <div className="modal-header bg-light border-bottom">
                    <h5 className="modal-title fw-semibold">{modalTitle}</h5>
                    <button type="button" className="btn-close" onClick={closeModal} />
                  </div>
                  <div
                    className="modal-body"
                    style={{ flex: "1 1 auto", overflowY: "auto", padding: "0.75rem" }}
                  >
                    {modalRows.length === 0 ? (
                      <div className="p-4 text-center text-muted small">No records available.</div>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-sm table-hover mb-0 align-middle">
                          <thead className="table-light">
                            <tr className="small text-muted">
                              <th style={{ width: "14%" }}>Mobile</th>
                              <th style={{ width: "16%" }}>Name</th>
                              <th style={{ width: "16%" }}>Project</th>
                              <th style={{ width: "14%" }}>Status</th>
                              <th style={{ width: "24%" }}>Remarks</th>
                              <th style={{ width: "18%" }}>Date &amp; Time</th>
                              <th style={{ width: "18%" }}>Assigned to</th>
                              <th style={{ width: "12%" }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {modalRows.map((row, idx) => {
                              const rowKey = row.leadKey || row.id;
                              const isEditing =
                                editingRowId && editingRowId === rowKey && editRowData;

                              return (
                                <tr key={`row-${idx}-${row.id || row.mobile || "no-id"}`}>
                                  <td className="fw-semibold text-primary">{row.mobile || "—"}</td>
                                  <td>{row.name || "—"}</td>

                                  <td>
                                    {isEditing ? (
                                      <input
                                        type="text"
                                        className="form-control form-control-sm"
                                        value={editRowData.project || ""}
                                        onChange={(e) =>
                                          handleEditRowChange("project", e.target.value)
                                        }
                                      />
                                    ) : (
                                      row.project || "—"
                                    )}
                                  </td>

                                  <td>
                                    {isEditing ? (
                                      <select
                                        className="form-select form-select-sm"
                                        value={editRowData.status || ""}
                                        onChange={(e) =>
                                          handleEditRowChange("status", e.target.value)
                                        }
                                      >
                                        <option value="">Select status</option>
                                        <option value="Details_shared">Details_shared</option>
                                        <option value="NR/SF">NR/SF</option>
                                        <option value="Visit Scheduled">Visit Scheduled</option>
                                        <option value="RNR">RNR</option>
                                        <option value="Site Visited">Site Visited</option>
                                        <option value="Booked">Booked</option>
                                        <option value="Invalid">Invalid</option>
                                        <option value="Not Interested">Not Interested</option>
                                      </select>
                                    ) : (
                                      <span className="small text-dark">{row.status || "—"}</span>
                                    )}
                                  </td>

                                  <td>
                                    {isEditing ? (
                                      <textarea
                                        rows={2}
                                        className="form-control form-control-sm"
                                        value={editRowData.remarks || ""}
                                        onChange={(e) =>
                                          handleEditRowChange("remarks", e.target.value)
                                        }
                                      />
                                    ) : (
                                      <span className="small text-muted">{row.remarks || "—"}</span>
                                    )}
                                  </td>

                                  <td>
                                    {isEditing ? (
                                      <input
                                        type="datetime-local"
                                        className="form-control form-control-sm"
                                        value={editRowData.date || ""}
                                        onChange={(e) =>
                                          handleEditRowChange("date", e.target.value)
                                        }
                                        disabled={HARD_LOCK_STATUSES.includes(editRowData.status)}
                                      />
                                    ) : (
                                      <span className="small fw-semibold">
                                        {row.date ? formatDateTime(row.date) : "—"}
                                      </span>
                                    )}
                                  </td>

                                  <td>
                                    <span className="small text-dark">{row.Assigned_to || "—"}</span>
                                  </td>

                                  <td>
                                    {isEditing ? (
                                      <div className="d-flex flex-column gap-1">
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-success"
                                          onClick={handleSaveEditRow}
                                        >
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-outline-secondary"
                                          onClick={cancelEditRow}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-outline-primary"
                                        onClick={() => startEditRow(row)}
                                      >
                                        Edit
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="modal-footer bg-light border-top">
                    <div className="me-auto small text-muted">
                      Showing <strong>{modalRows.length}</strong> record(s)
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={closeModal}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div
              className="modal-backdrop fade show"
              onClick={closeModal}
              style={{ cursor: "pointer" }}
            />
          </>
        )}

        {/* Add Lead Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 d-flex align-items-center justify-content-center bg-black bg-opacity-25">
            <div className="position-relative w-100" style={{ maxWidth: 720 }}>
              <div
                className="rounded-4 bg-white border border-slate-200 shadow-2xl"
                style={{ maxHeight: "80vh", overflowY: "auto" }}
              >
                <div className="d-flex align-items-center justify-content-between px-4 py-3 border-bottom">
                  <h5 className="mb-0 fw-semibold d-flex align-items-center gap-2">
                    <span
                      className="d-inline-flex align-items-center justify-content-center rounded-circle"
                      style={{
                        width: 28,
                        height: 28,
                        backgroundColor: "#e0f2fe",
                        color: "#0d6efd",
                        fontSize: 14,
                      }}
                    >
                      ➕
                    </span>
                    Add New Lead
                  </h5>
                  <button
                    type="button"
                    className="btn btn-link p-0 text-muted"
                    onClick={closeAddLeadModal}
                  >
                    <CircleXIcon size={22} />
                  </button>
                </div>

                <form onSubmit={handleAddLeadSubmit} className="px-4 py-3">
                  <div className="row g-2 small">
                    <div className="col-12 col-sm-6">
                      <label className="text-muted mb-1">Name</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={newLead.name}
                        onChange={(e) => handleNewLeadChange("name", e.target.value)}
                      />
                    </div>

                    <div className="col-12 col-sm-6">
                      <label className="text-muted mb-1">
                        Mobile <span className="text-danger">*</span>
                      </label>
                      <input
                        type="tel"
                        className="form-control form-control-sm"
                        value={newLead.mobile}
                        onChange={(e) => handleNewLeadChange("mobile", e.target.value)}
                        required
                      />
                    </div>

                    <div className="col-12 col-sm-6">
                      <label className="text-muted mb-1">Source</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={newLead.source}
                        onChange={(e) => handleNewLeadChange("source", e.target.value)}
                      />
                    </div>

                    <div className="col-12 col-sm-6">
                      <label className="text-muted mb-1">Project</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={newLead.project}
                        onChange={(e) => handleNewLeadChange("project", e.target.value)}
                        placeholder="Project name / code"
                      />
                    </div>

                    <div className="col-12 col-sm-6">
                      <label className="text-muted mb-1">Status</label>
                      <select
                        className="form-select form-select-sm"
                        value={newLead.status}
                        onChange={(e) => handleNewLeadChange("status", e.target.value)}
                      >
                        <option value="">Select status</option>
                        <option value="Details_shared">Details_shared</option>
                        <option value="NR/SF">NR/SF</option>
                        <option value="Visit Scheduled">Visit Scheduled</option>
                        <option value="RNR">RNR</option>
                        <option value="Site Visited">Site Visited</option>
                        <option value="Booked">Booked</option>
                        <option value="Invalid">Invalid</option>
                        <option value="Not Interested">Not Interested</option>
                      </select>
                    </div>

                    <div className="col-12 col-sm-6">
                      <label className="text-muted mb-1">Job Role</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={newLead.job_role}
                        onChange={(e) => handleNewLeadChange("job_role", e.target.value)}
                      />
                    </div>

                    <div className="col-12 col-sm-6">
                      <label className="text-muted mb-1">Budget</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={newLead.budget}
                        onChange={(e) => handleNewLeadChange("budget", e.target.value)}
                      />
                    </div>

                    <div className="col-12 col-sm-6">
                      <label className="text-muted mb-1">Assigned To</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={newLead.Assigned_to}
                        onChange={(e) => handleNewLeadChange("Assigned_to", e.target.value)}
                      />
                    </div>

                    <div className="col-12">
                      <label className="text-muted mb-1">Call Date &amp; Time</label>
                      <input
                        type="datetime-local"
                        className="form-control form-control-sm"
                        value={newLead.dob || ""}
                        onChange={(e) => handleNewLeadChange("dob", e.target.value)}
                        disabled={HARD_LOCK_STATUSES.includes(newLead.status)}
                      />
                    </div>

                    <div className="col-12 mt-2">
                      <label className="text-muted mb-1">Remarks / Notes</label>
                      <textarea
                        rows={3}
                        className="form-control form-control-sm"
                        value={newLead.remarks}
                        onChange={(e) => handleNewLeadChange("remarks", e.target.value)}
                        placeholder="Add remarks about this lead..."
                      />
                    </div>
                  </div>

                  <div className="d-flex justify-content-end gap-2 mt-3 pt-2 border-top">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm rounded-pill px-3"
                      onClick={closeAddLeadModal}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm rounded-pill px-3">
                      Save Lead
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UserDashboard;

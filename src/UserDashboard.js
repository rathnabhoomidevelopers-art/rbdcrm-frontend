// src/UserDashboard.js
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Users,
  ClipboardList,
  MapPinCheck,
  PhoneCall,
  RefreshCw,
  CircleXIcon,
  MessageSquareText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api } from "./api";

// Source dropdown options (edit this list anytime)
const SOURCE_OPTIONS = [
  "Google Ads",
  "Meta Ads",
  "WhatsApp",
  "Facebook",
  "Instagram",
  "Website",
  "Walk-in",
  "Referral",
  "99acres",
  "Shilpa K Leads",
  "Roopa Leads",
  "Shilpa G Leads",
  "Sreyash Leads",
];

const PROJECT_OPTIONS = [
  "Northern Lights",
  "Gk hill view",
  "Novara farmland",
  "Konig villa homes",
  "Sattva lumino",
  "Godrej woods",
  "Ranka ankura",
  "Vajram vivera",
  "SLV golden towers",
];

const AUTO_24H_STATUSES = ["NR/SF", "RNR", "Details_shared", "Site Visited", "Busy"];

// Change: RNR should NOT lock date in edit (and even in add, your request is mainly edit)
// We'll lock only NR/SF and Busy.
const HARD_LOCK_STATUSES = ["NR/SF", "Busy"];

const DASHBOARD_FOLLOWUP_STATUSES = [
  "Follow Up",
  "Follow-up",
  "Visit Scheduled",
  "NR/SF",
  "RNR",
  "Details_shared",
  "Site Visited",
  "Location Issue",
  "CP",
  "Budget Issue",
  "Visit Postponed",
  "Busy",
  "Closed",
];

/* helpers */
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

// ✅ NEW: if user selects only date (or time not selected), set time to 09:00 AM
const ensureTime0900 = (val) => {
  if (!val) return "";

  const s = String(val);

  // If user somehow provides only date (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T09:00`;
  }

  // If user provides incomplete datetime like "YYYY-MM-DDT"
  if (/^\d{4}-\d{2}-\d{2}T$/.test(s)) {
    return `${s}09:00`;
  }

  // If datetime-local returns midnight by default (00:00), treat as "time not selected"
  if (/^\d{4}-\d{2}-\d{2}T00:00$/.test(s)) {
    return s.replace("T00:00", "T09:00");
  }

  return s;
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
      error: "Enter a valid mobile number starting with 6-9",
      normalized: digits,
    };
  }

  return { ok: true, error: null, normalized: digits };
};

// ✅ Global/mobile matching helpers
const normalizeDigits = (v) => String(v || "").replace(/\D/g, "");
const mobileMatches = (mobileValue, query) => {
  const m = normalizeDigits(mobileValue);
  const q = normalizeDigits(query);
  if (!q) return true;
  return m.includes(q);
};

export function UserDashboard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [stats, setStats] = useState({
    totalLeads: 0,
    totalFollowUps: 0,
    totalSiteVisits: 0,
    totalBooked: 0,
    addedToday: 0,
    updatedToday: 0,
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

  const [modalContext, setModalContext] = useState(null);

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

  const [editingRowId, setEditingRowId] = useState(null);
  const [editRowData, setEditRowData] = useState(null);

  // ✅ Toggle for showing previous remarks (only for the currently edited row)
  const [showPrevRemarks, setShowPrevRemarks] = useState(false);

  // ✅ NEW: Global search input (header) + modal filter input
  const [globalMobileSearch, setGlobalMobileSearch] = useState("");
  const [modalMobileSearch, setModalMobileSearch] = useState("");

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

      if (role === "user") {
        leads = leads.filter(
          (l) => (l.Assigned_to || "").toString().trim().toLowerCase() === username
        );

        const myLeadIds = new Set(leads.map((l) => l.lead_id));
        followUpsAll = followUpsAll.filter((fu) =>
          myLeadIds.has(fu.followup_id || fu.lead_id)
        );
      }

      const totalLeads = leads.length;

      const latestByLead = {};
      const getTime = (item) => {
        if (!item || !item.date) return 0;
        const t = new Date(item.date).getTime();
        return Number.isNaN(t) ? 0 : t;
      };

      followUpsAll.forEach((fu) => {
        const key = fu.followup_id || fu.lead_id || fu._id;
        if (!key) return;

        const existing = latestByLead[key];
        if (!existing || getTime(fu) >= getTime(existing)) {
          latestByLead[key] = fu;
        }
      });

      const latestFollowUps = Object.values(latestByLead);

      const onlyFollowUps = latestFollowUps.filter((fu) =>
        DASHBOARD_FOLLOWUP_STATUSES.includes(fu.status)
      );

      const totalFollowUps = onlyFollowUps.length;
      const totalSiteVisits = leads.filter((l) => l.status === "Site Visited").length;
      const totalBooked = leads.filter((l) => l.status === "Booked").length;

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
      // NEW: today range
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);

      // NEW: helper
      const isToday = (d) => {
        const dt = d ? new Date(d) : null;
        if (!dt || Number.isNaN(dt.getTime())) return false;
        return dt >= startOfToday && dt < endOfToday;
      };

      // NEW: counts
      const addedToday = leads.filter(
        (l) => isToday(l.createdAt) && (l.createdBy || "").toString().trim().toLowerCase() === username
      ).length;

      const updatedToday = leads.filter(
        (l) => isToday(l.updatedAt) && (l.updatedBy || "").toString().trim().toLowerCase() === username
      ).length;

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
        else if (d >= startOfTomorrow && d < startOfDayAfterTomorrow) tomorrow.push(fu);
      });

      const sortByDate = (arr) =>
        arr.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

      setStats({
        totalLeads,
        totalFollowUps,
        totalSiteVisits,
        totalBooked,

        // ✅ NEW
        addedToday,
        updatedToday,
      });


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

  const leadIndex = useMemo(() => {
    const idx = {};
    (leadsData || []).forEach((l) => {
      const key = l.lead_id || l._id;
      if (key) idx[key] = l;
    });
    return idx;
  }, [leadsData]);

  const buildUserStatusGroups = (items) => {
    const result = {};
    (items || []).forEach((fu) => {
      const key = fu.followup_id || fu.lead_id || fu._id;
      const lead = leadIndex[key];

      const assignedRaw = lead && lead.Assigned_to ? lead.Assigned_to : "Unassigned";
      const assigned = (assignedRaw || "").trim() || "Unassigned";

      const st = (lead && lead.status) || fu.status || "Unknown";

      if (!result[assigned]) result[assigned] = {};
      if (!result[assigned][st]) result[assigned][st] = [];
      result[assigned][st].push({ fu, lead });
    });
    return result;
  };

  const overdueUserGroups = buildUserStatusGroups(followUpAlerts.overdue);
  const todayUserGroups = buildUserStatusGroups(followUpAlerts.today);
  const tomorrowUserGroups = buildUserStatusGroups(followUpAlerts.tomorrow);

  // ✅ Build combined rows for a mobile query (checks BOTH leads + followups)
  const buildMobileSearchRows = (query) => {
    const q = (query || "").trim();
    if (!q) return [];

    // latest followup per lead
    const latestFUByLead = {};
    (followUpsData || []).forEach((fu) => {
      const key = fu.followup_id || fu.lead_id || fu._id;
      if (!key) return;
      const t = fu.date ? new Date(fu.date).getTime() : 0;
      const prev = latestFUByLead[key];
      const pt = prev?.date ? new Date(prev.date).getTime() : 0;
      if (!prev || t >= pt) latestFUByLead[key] = fu;
    });

    const combined = [];

    // 1) leads (authoritative)
    (leadsData || []).forEach((l) => {
      const leadKey = l.lead_id || l._id;
      const fu = leadKey ? latestFUByLead[leadKey] : null;

      combined.push({
        id: leadKey,
        leadKey,
        name: l.name || "",
        mobile: l.mobile || "",
        status: l.status || (fu?.status || ""),
        source: l.source || (fu?.source || ""),
        date: l.dob || fu?.date || null,
        remarks: l.remarks || fu?.remarks || "",
        Assigned_to: l.Assigned_to || "",
        project: l.project || fu?.project || "",
        verification_call: !!l.verification_call,
      });
    });

    // 2) followups that don’t have a lead row (fallback)
    Object.entries(latestFUByLead).forEach(([key, fu]) => {
      const existsInLeads = (leadsData || []).some((l) => (l.lead_id || l._id) === key);
      if (existsInLeads) return;

      combined.push({
        id: fu.followup_id || fu._id,
        leadKey: key, // try edit by this key
        name: fu.name || "",
        mobile: fu.mobile || "",
        status: fu.status || "",
        source: fu.source || "",
        date: fu.date || null,
        remarks: fu.remarks || "",
        Assigned_to: fu.Assigned_to || "",
        project: fu.project || "",
        verification_call: false,
      });
    });

    return combined.filter((row) => mobileMatches(row.mobile, q));
  };

  // ✅ Open mobile search modal
  const openMobileSearchModal = (searchValue) => {
    const q = (searchValue || "").trim();
    if (!q) {
      toast.error("Enter mobile number to search");
      return;
    }

    const results = buildMobileSearchRows(q);

    setModalContext({ kind: "mobileSearch", query: q });
    setModalTitle(`Mobile Search: ${q}`);
    setModalRows(results);
    setModalOpen(true);

    setEditingRowId(null);
    setEditRowData(null);
    setShowPrevRemarks(false);
    setModalMobileSearch(q);
  };

  const rebuildModalFromContext = () => {
    if (!modalOpen || !modalContext) return;

    // ✅ NEW: rebuild mobile search modal after refresh
    if (modalContext.kind === "mobileSearch") {
      const q = modalContext.query || "";
      setModalTitle(`Mobile Search: ${q}`);
      setModalRows(buildMobileSearchRows(q));
      setModalMobileSearch(q);
      return;
    }

    if (modalContext.kind === "summary") {
      const type = modalContext.type;

      if (type === "leads") {
        setModalTitle("All Leads");
        setModalRows(
          (leadsData || []).map((l) => ({
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
            verification_call: !!l.verification_call,
          }))
        );
        return;
      }

      if (type === "followups") {
        setModalTitle("Follow-Up Leads");
        setModalRows(
          (followUpsData || []).map((fu) => {
            const key = fu.followup_id || fu.lead_id || fu._id;
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
              status: (lead && lead.status) || fu.status || "",
              source: fu.source || (lead && lead.source) || "",
              date: fu.date || (lead && lead.dob) || null,
              remarks: fu.remarks || (lead && lead.remarks) || "",
              Assigned_to: (lead && lead.Assigned_to) || fu.Assigned_to || "",
              project: fu.project || (lead && lead.project) || "",
              verification_call: !!(lead && lead.verification_call),
            };
          })
        );
        return;
      }

      if (type === "sitevisits") {
        setModalTitle("Site Visit Leads");
        const filtered = (leadsData || []).filter((l) => l.status === "Site Visited");
        setModalRows(
          filtered.map((l) => ({
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
            verification_call: !!l.verification_call,
          }))
        );
        return;
      }

      if (type === "booked") {
        setModalTitle("Booked Leads");
        const filtered = (leadsData || []).filter((l) => l.status === "Booked");
        setModalRows(
          filtered.map((l) => ({
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
            verification_call: !!l.verification_call,
          }))
        );
        return;
      }
    }

    if (modalContext.kind === "group") {
      const { bucketLabel, assignedTo, status } = modalContext;

      const bucketArr =
        bucketLabel === "Overdue"
          ? followUpAlerts.overdue
          : bucketLabel === "Today"
          ? followUpAlerts.today
          : followUpAlerts.tomorrow;

      const groups = buildUserStatusGroups(bucketArr);
      const list = (groups?.[assignedTo]?.[status] || []).map(({ fu, lead }) => {
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
          status: (lead && lead.status) || fu.status || "",
          source: fu.source || (lead && lead.source) || "",
          date: fu.date || (lead && lead.dob) || null,
          remarks: fu.remarks || (lead && lead.remarks) || "",
          Assigned_to: (lead && lead.Assigned_to) || fu.Assigned_to || "",
          project: fu.project || (lead && lead.project) || "",
          verification_call: !!(lead && lead.verification_call),
        };
      });

      setModalTitle(`${bucketLabel} – ${assignedTo} – ${status}`);
      setModalRows(list);
    }
  };

  useEffect(() => {
    if (!modalOpen || !modalContext) return;
    rebuildModalFromContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    modalOpen,
    modalContext,
    leadsData,
    followUpsData,
    followUpAlerts.overdue,
    followUpAlerts.today,
    followUpAlerts.tomorrow,
  ]);

  const openModal = (type) => {
    setModalContext({ kind: "summary", type });

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
        verification_call: !!l.verification_call,
      }));
    } else if (type === "followups") {
      title = "Follow-Up Leads";
      rows = (followUpsData || []).map((fu) => {
        const key = fu.followup_id || fu.lead_id || fu._id;
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
          status: (lead && lead.status) || fu.status || "",
          source: fu.source || (lead && lead.source) || "",
          date: fu.date || (lead && lead.dob) || null,
          remarks: fu.remarks || (lead && lead.remarks) || "",
          Assigned_to: (lead && lead.Assigned_to) || fu.Assigned_to || "",
          project: fu.project || (lead && lead.project) || "",
          verification_call: !!(lead && lead.verification_call),
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
        verification_call: !!l.verification_call,
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
        verification_call: !!l.verification_call,
      }));
    }

    setModalTitle(title);
    setModalRows(rows);
    setModalOpen(true);
    setEditingRowId(null);
    setEditRowData(null);
    setShowPrevRemarks(false);
    setModalMobileSearch("");
  };

  const openGroupModal = (bucketLabel, assignedTo, status, items) => {
    setModalContext({ kind: "group", bucketLabel, assignedTo, status });

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
        status: (lead && lead.status) || fu.status || "",
        source: fu.source || (lead && lead.source) || "",
        date: fu.date || (lead && lead.dob) || null,
        remarks: fu.remarks || (lead && lead.remarks) || "",
        Assigned_to: (lead && lead.Assigned_to) || fu.Assigned_to || "",
        project: fu.project || (lead && lead.project) || "",
        verification_call: !!(lead && lead.verification_call),
      };
    });

    setModalTitle(title);
    setModalRows(rows);
    setModalOpen(true);
    setEditingRowId(null);
    setEditRowData(null);
    setShowPrevRemarks(false);
    setModalMobileSearch("");
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalRows([]);
    setModalTitle("");
    setEditingRowId(null);
    setEditRowData(null);
    setModalContext(null);
    setShowPrevRemarks(false);
    setModalMobileSearch("");
  };

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

        if (value === "NR/SF" || value === "RNR" || value === "Busy") {
          updated.dob = getNowPlus24Hours();
        } else if (
          value === "Visit Scheduled" ||
          value === "Details_shared" ||
          value === "Location Issue" ||
          value === "CP" ||
          value === "Budget Issue" ||
          value === "Visit Postponed"
        ) {
          updated.dob = "";
        }
      } else if (field === "dob") {
        if (HARD_LOCK_STATUSES.includes(prev.status)) return prev;

        // ✅ Ensure time = 09:00 if user selected only date / time not selected
        updated.dob = ensureTime0900(value || "");
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

      // ✅ Ensure 09:00 if date-only / time not selected
      dobToSave = ensureTime0900(dobToSave);

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

  // When clicking Edit: clear textarea + keep ALL previous remarks separately
  const startEditRow = (row) => {
    const rowId = row.leadKey || row.id;
    setEditingRowId(rowId);
    setShowPrevRemarks(false);

    setEditRowData({
      ...row,
      leadKey: rowId,
      date: row.date ? toLocalInputValue(row.date) : "",
      source: row.source || "",
      prevRemarks: row.remarks || "", // this should contain ALL previous remarks (as stored in DB)
      remarks: "", // textarea must start empty
    });
  };

  const cancelEditRow = () => {
    setEditingRowId(null);
    setEditRowData(null);
    setShowPrevRemarks(false);
  };

  const handleEditRowChange = (field, value) => {
    setEditRowData((prev) => {
      const next = { ...prev, [field]: value };

      if (field === "status") {
        // ✅ if date empty and status requires auto +24h, set it
        if (AUTO_24H_STATUSES.includes(value) && (!prev.date || prev.date === "")) {
          next.date = getNowPlus24Hours();
        }
      }

      if (field === "date") {
        // ✅ Ensure time = 09:00 if only date / time not selected
        const fixed = ensureTime0900(value);
        next.date = fixed;

        // ✅ Change: RNR must be editable (date should not be blocked)
        if (HARD_LOCK_STATUSES.includes(prev.status)) return prev;
      }

      return next;
    });
  };

  const handleSaveEditRow = async () => {
    if (!editRowData || !editingRowId) return;

    try {
      const newRemark = (editRowData.remarks || "").trim();

      // Append new remark to previous remarks so history is preserved
      const combinedRemarks = [editRowData.prevRemarks, newRemark]
        .filter(Boolean)
        .join("\n");

      // ✅ Ensure time = 09:00 if date-only / time not selected (edit save)
      const finalDob = ensureTime0900(editRowData.date || "");

      const payload = {
        status: editRowData.status || null,
        remarks: combinedRemarks ? combinedRemarks : null,
        project: editRowData.project || null,
        source: editRowData.source || null,
        dob: finalDob || null,
        Assigned_to: editRowData.Assigned_to || null,
      };

      const res = await api.put(`/edit-lead/${editingRowId}`, payload);

      toast.success("Lead updated successfully");

      if (res?.data?.transferredTo) {
        toast.success(
          `Lead transferred to ${res.data.transferredTo} (Verification Call)`,
          { duration: 3500, position: "top-right" }
        );
      }

      cancelEditRow();
      window.dispatchEvent(new Event("leads-updated"));
      await fetchStats({ showFullScreenLoader: false });
      rebuildModalFromContext();
    } catch (err) {
      console.error("Error updating lead", {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      toast.error("Failed to update lead");
    }
  };

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

  return (
    <div
      className="py-4"
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, #e0f2ff 0, #f3f4f6 45%, #eef1f4 100%)",
      }}
    >
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <div className="container-xl" style={{ maxWidth: "1500px" }}>
        <datalist id="source-options">
          {SOURCE_OPTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        {/* HEADER */}
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

                    {/* ✅ Global Mobile Search */}
                    <div className="d-flex gap-2 align-items-center flex-wrap mt-2">
                      <input
                        className="form-control form-control-sm"
                        style={{ width: 260 }}
                        placeholder="Search mobile (leads + followups)..."
                        value={globalMobileSearch}
                        onChange={(e) => setGlobalMobileSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") openMobileSearchModal(globalMobileSearch);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-light btn-sm"
                        onClick={() => openMobileSearchModal(globalMobileSearch)}
                      >
                        Search
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-light btn-sm"
                        onClick={() => {
                          setGlobalMobileSearch("");
                        }}
                      >
                        Clear
                      </button>
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

        {/* SUMMARY CARDS */}
        <div className="row g-3 mb-4">
          {/* Total Leads */}
          <div className="col-12 col-md-6 col-xl-3">
            <div
              className="card border-0 shadow-sm h-100"
              style={{ borderRadius: "1.1rem", cursor: "pointer" }}
              onClick={() => openModal("leads")}
            >
              <div className="card-body d-flex align-items-center gap-3">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center"
                  style={{ width: 46, height: 46, backgroundColor: "#e0f2fe" }}
                >
                  <Users size={20} />
                </div>
                <div>
                  <div className="small text-muted">Total Leads</div>
                  <div className="fw-bold" style={{ fontSize: "1.4rem" }}>
                    {stats.totalLeads}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Follow-Ups */}
          <div className="col-12 col-md-6 col-xl-3">
            <div
              className="card border-0 shadow-sm h-100"
              style={{ borderRadius: "1.1rem", cursor: "pointer" }}
              onClick={() => openModal("followups")}
            >
              <div className="card-body d-flex align-items-center gap-3">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center"
                  style={{ width: 46, height: 46, backgroundColor: "#fff3cd" }}
                >
                  <PhoneCall size={20} />
                </div>
                <div>
                  <div className="small text-muted">Follow-Ups</div>
                  <div className="fw-bold" style={{ fontSize: "1.4rem" }}>
                    {stats.totalFollowUps}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Site Visits */}
          <div className="col-12 col-md-6 col-xl-3">
            <div
              className="card border-0 shadow-sm h-100"
              style={{ borderRadius: "1.1rem", cursor: "pointer" }}
              onClick={() => openModal("sitevisits")}
            >
              <div className="card-body d-flex align-items-center gap-3">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center"
                  style={{ width: 46, height: 46, backgroundColor: "#cfe2ff" }}
                >
                  <MapPinCheck size={20} />
                </div>
                <div>
                  <div className="small text-muted">Site Visits</div>
                  <div className="fw-bold" style={{ fontSize: "1.4rem" }}>
                    {stats.totalSiteVisits}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Booked */}
          <div className="col-12 col-md-6 col-xl-3">
            <div
              className="card border-0 shadow-sm h-100"
              style={{ borderRadius: "1.1rem", cursor: "pointer" }}
              onClick={() => openModal("booked")}
            >
              <div className="card-body d-flex align-items-center gap-3">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center"
                  style={{ width: 46, height: 46, backgroundColor: "#d1e7dd" }}
                >
                  <ClipboardList size={20} />
                </div>
                <div>
                  <div className="small text-muted">Booked</div>
                  <div className="fw-bold" style={{ fontSize: "1.4rem" }}>
                    {stats.totalBooked}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ✅ Added Today */}
          <div className="col-12 col-md-6 col-xl-3">
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: "1.1rem" }}>
              <div className="card-body d-flex align-items-center gap-3">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center"
                  style={{ width: 46, height: 46, backgroundColor: "#e9d5ff" }}
                >
                  <Users size={20} />
                </div>
                <div>
                  <div className="small text-muted">Added Today</div>
                  <div className="fw-bold" style={{ fontSize: "1.4rem" }}>
                    {stats.addedToday}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ✅ Updated Today */}
          <div className="col-12 col-md-6 col-xl-3">
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: "1.1rem" }}>
              <div className="card-body d-flex align-items-center gap-3">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center"
                  style={{ width: 46, height: 46, backgroundColor: "#fee2e2" }}
                >
                  <RefreshCw size={20} />
                </div>
                <div>
                  <div className="small text-muted">Updated Today</div>
                  <div className="fw-bold" style={{ fontSize: "1.4rem" }}>
                    {stats.updatedToday}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>


        {/* FOLLOW-UP ALERTS SECTION */}
        <div className="row g-3 mb-4">
          {followUpAlerts.overdue.length === 0 &&
          followUpAlerts.today.length === 0 &&
          followUpAlerts.tomorrow.length === 0 ? (
            <div className="col-12">
              <div className="card border-0 shadow-sm" style={{ borderRadius: "1.1rem" }}>
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
                    <div className="fw-semibold text-success mb-1" style={{ fontSize: "1.1rem" }}>
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
              <div className="col-12 col-xl-4">
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
              <div className="col-12 col-xl-4">
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
                          {Object.entries(todayUserGroups).map(
                            ([assignedTo, statusMap], idxUser) => (
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
                            )
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Tomorrow */}
              <div className="col-12 col-xl-4">
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

        {/* Modal for rows */}
        {modalOpen && (
          <>
            <div
              className="modal fade show"
              style={{
                display: "block",
                backgroundColor: "rgba(15,23,42,0.45)",
              }}
            >
              <div
                className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable"
                style={{ maxWidth: "1100px", width: "95vw" }}
              >
                <div
                  className="modal-content border-0 shadow-lg rounded-3"
                  style={{
                    maxHeight: "90vh",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div className="modal-header bg-light border-bottom">
                    <h5 className="modal-title fw-semibold">{modalTitle}</h5>
                    <button type="button" className="btn-close" onClick={closeModal} />
                  </div>

                  <div
                    className="modal-body"
                    style={{
                      flex: "1 1 auto",
                      overflowY: "auto",
                      padding: "0.75rem",
                    }}
                  >
                    {/* mobile filter inside modal */}
                    <div className="d-flex gap-2 align-items-center mb-2">
                      <input
                        className="form-control form-control-sm"
                        placeholder="Filter mobile inside results..."
                        value={modalMobileSearch}
                        onChange={(e) => setModalMobileSearch(e.target.value)}
                      />
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => setModalMobileSearch("")}
                      >
                        Clear
                      </button>
                    </div>

                    {modalRows.length === 0 ? (
                      <div className="p-4 text-center text-muted small">No records available.</div>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-sm table-hover mb-0 align-middle">
                          <thead className="table-light">
                            <tr className="small text-muted">
                              <th style={{ width: "14%" }}>Mobile</th>
                              <th style={{ width: "14%" }}>Name</th>
                              <th style={{ width: "14%" }}>Source</th>
                              <th style={{ width: "16%" }}>Project</th>
                              <th style={{ width: "14%" }}>Status</th>
                              <th style={{ width: "24%" }}>Remarks</th>
                              <th style={{ width: "18%" }}>Date &amp; Time</th>
                              <th style={{ width: "18%" }}>Assigned to</th>
                              <th style={{ width: "12%" }}>Actions</th>
                            </tr>
                          </thead>

                          <tbody>
                            {modalRows
                              .filter((r) => mobileMatches(r.mobile, modalMobileSearch))
                              .map((row, idx) => {
                                const rowKey = row.leadKey || row.id;
                                const isEditing =
                                  editingRowId && editingRowId === rowKey && editRowData;

                                return (
                                  <tr
                                    key={`row-${idx}-${row.id || row.mobile || "no-id"}`}
                                    style={
                                      row.verification_call
                                        ? {
                                            backgroundColor: "#fff7ed",
                                            borderLeft: "4px solid #f97316",
                                          }
                                        : undefined
                                    }
                                  >
                                    <td className="fw-semibold text-primary">{row.mobile || "—"}</td>
                                    <td>{row.name || "—"}</td>

                                    <td>
                                      {isEditing ? (
                                        <input
                                          type="text"
                                          className="form-control form-control-sm"
                                          list="source-options"
                                          value={editRowData.source || ""}
                                          onChange={(e) =>
                                            handleEditRowChange("source", e.target.value)
                                          }
                                          placeholder="Select or type source"
                                        />
                                      ) : (
                                        <span className="small text-dark">{row.source || "—"}</span>
                                      )}
                                    </td>

                                    <td>
                                      {isEditing ? (
                                        <select
                                          className="form-select form-select-sm"
                                          value={editRowData.project || ""}
                                          onChange={(e) =>
                                            handleEditRowChange("project", e.target.value)
                                          }
                                        >
                                          <option value="">Select project</option>
                                          {PROJECT_OPTIONS.map((p) => (
                                            <option key={p} value={p}>
                                              {p}
                                            </option>
                                          ))}
                                        </select>
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
                                          <option value="Location Issue">Location Issue</option>
                                          <option value="CP">CP</option>
                                          <option value="Budget Issue">Budget Issue</option>
                                          <option value="Visit Postponed">Visit Postponed</option>
                                          <option value="Closed">Closed</option>
                                          <option value="Busy">Busy</option>
                                        </select>
                                      ) : (
                                        <div className="d-flex flex-column gap-1">
                                          <span className="small text-dark">{row.status || "—"}</span>
                                          {row.verification_call && (
                                            <span
                                              className="badge rounded-pill"
                                              style={{
                                                width: "fit-content",
                                                backgroundColor: "#f97316",
                                                color: "#fff",
                                                fontSize: "0.65rem",
                                              }}
                                            >
                                              Verification Call
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </td>

                                    {/* Remarks */}
                                    <td>
                                      {isEditing ? (
                                        <div className="d-flex flex-column gap-1">
                                          <textarea
                                            rows={2}
                                            className="form-control form-control-sm"
                                            value={editRowData.remarks || ""}
                                            onChange={(e) =>
                                              handleEditRowChange("remarks", e.target.value)
                                            }
                                            placeholder="Type new remark..."
                                          />

                                          <div className="d-flex justify-content-end">
                                            <button
                                              type="button"
                                              className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1"
                                              onClick={() => setShowPrevRemarks((v) => !v)}
                                              disabled={!editRowData?.prevRemarks}
                                              title="Show previous remarks"
                                            >
                                              <MessageSquareText size={14} />
                                              <span>Remarks</span>
                                              {showPrevRemarks ? (
                                                <ChevronUp size={14} />
                                              ) : (
                                                <ChevronDown size={14} />
                                              )}
                                            </button>
                                          </div>

                                          {showPrevRemarks && (
                                            <div
                                              className="small text-muted"
                                              style={{
                                                background: "#f8fafc",
                                                border: "1px solid #e2e8f0",
                                                borderRadius: 8,
                                                padding: "8px 10px",
                                                whiteSpace: "pre-wrap",
                                              }}
                                            >
                                              <div className="fw-semibold text-dark mb-1">
                                                Previous remarks
                                              </div>
                                              {editRowData?.prevRemarks ? (
                                                editRowData.prevRemarks
                                              ) : (
                                                <span className="text-muted">No previous remarks</span>
                                              )}
                                            </div>
                                          )}
                                        </div>
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
                                          onChange={(e) => handleEditRowChange("date", e.target.value)}
                                          // ✅ RNR is now editable (only NR/SF and Busy lock)
                                          disabled={HARD_LOCK_STATUSES.includes(editRowData.status)}
                                        />
                                      ) : (
                                        <span className="small fw-semibold">
                                          {row.date ? formatDateTime(row.date) : "—"}
                                        </span>
                                      )}
                                    </td>

                                    <td>
                                      <span className="small text-dark">
                                        {row.Assigned_to || "—"}
                                      </span>
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
                      Showing{" "}
                      <strong>
                        {modalRows.filter((r) => mobileMatches(r.mobile, modalMobileSearch)).length}
                      </strong>{" "}
                      record(s)
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
                        list="source-options"
                        value={newLead.source || ""}
                        onChange={(e) => handleNewLeadChange("source", e.target.value)}
                        placeholder="Select or type source"
                      />
                    </div>

                    <div className="col-12 col-sm-6">
                      <label className="text-muted mb-1">Project</label>
                      <select
                        className="form-select form-select-sm"
                        value={newLead.project || ""}
                        onChange={(e) => handleNewLeadChange("project", e.target.value)}
                      >
                        <option value="">Select project</option>
                        {PROJECT_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
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
                        <option value="Location Issue">Location Issue</option>
                        <option value="CP">CP</option>
                        <option value="Budget Issue">Budget Issue</option>
                        <option value="Visit Postponed">Visit Postponed</option>
                        <option value="Closed">Closed</option>
                        <option value="Busy">Busy</option>
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

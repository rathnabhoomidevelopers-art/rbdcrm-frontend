require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();

const connectionString = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const mongoClient = MongoClient;

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const PORT = process.env.PORT || 3000;

// ✅ Statuses that appear in dashboards and should create/update follow-up
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
  "Busy",
  "Closed",
];

// ✅ Statuses that should auto-set dob to tomorrow 9AM if dob missing/invalid
const AUTO_24H_STATUSES = ["NR/SF", "RNR", "Details_shared", "Site Visited", "Busy"];

const allowedOrigins = new Set([
  "https://www.rbdcrm.com",
  "https://rbdcrm.com",
  "http://localhost:3000",
  "http://localhost:3001",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  // allow server-to-server / Postman / curl (no origin header)
  if (!origin) return next();

  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
  }

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Simple request logger
app.use((req, res, next) => {
  console.log(
    `${new Date().toLocaleString()} Request made to ${req.method} ${req.originalUrl}`
  );
  next();
});

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function auth(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) return res.status(401).json({ message: "No token provided" });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;

      if (
        Array.isArray(allowedRoles) &&
        allowedRoles.length > 0 &&
        !allowedRoles.includes(decoded.role)
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }

      next();
    } catch (err) {
      console.error("JWT verify error:", err.message);
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  };
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

/* ======================================================
   ✅ ROUND ROBIN HELPERS
   Uses settings collection doc:
   { "_id": "rr_lead_assign", "lastIndex": 0 }
====================================================== */

async function getActiveUsers_(usersCol) {
  // You can add extra filter here if you maintain "isActive: true"
  const users = await usersCol
    .find({ role: "user" }, { projection: { user_name: 1 } })
    .sort({ user_name: 1 })
    .toArray();

  return users
    .map((u) => (u.user_name || "").toString().trim().toLowerCase())
    .filter(Boolean);
}

async function pickRoundRobinUser_(settingsCol, usersCol) {
  const users = await getActiveUsers_(usersCol);
  if (!users.length) return null;

  // read current index (create if missing)
  const rr = await settingsCol.findOne({ _id: "rr_lead_assign" });
  let lastIndex = typeof rr?.lastIndex === "number" ? rr.lastIndex : 0;

  // Next user index
  const nextIndex = lastIndex % users.length;
  const pickedUser = users[nextIndex];

  // update settings for next call
  const newLastIndex = (nextIndex + 1) % users.length;

  await settingsCol.updateOne(
    { _id: "rr_lead_assign" },
    { $set: { lastIndex: newLastIndex, updatedAt: new Date() } },
    { upsert: true }
  );

  return pickedUser;
}

/**
 * ✅ UPDATED:
 * - Treat null/""/"   " as unassigned
 * - Normalize existing Assigned_to to lowercase trimmed
 */
async function assignRoundRobinToLeads_(leads, settingsCol, usersCol) {
  const users = await getActiveUsers_(usersCol);
  if (!users.length) return leads;

  const rr = await settingsCol.findOne({ _id: "rr_lead_assign" });
  let lastIndex = typeof rr?.lastIndex === "number" ? rr.lastIndex : 0;

  let idx = lastIndex % users.length;

  for (const l of leads) {
    const current = (l.Assigned_to || "").toString().trim();

    // only assign if Assigned_to is empty/blank
    if (!current) {
      l.Assigned_to = users[idx];
      idx = (idx + 1) % users.length;
    } else {
      // normalize
      l.Assigned_to = current.toLowerCase();
    }
  }

  await settingsCol.updateOne(
    { _id: "rr_lead_assign" },
    { $set: { lastIndex: idx, updatedAt: new Date() } },
    { upsert: true }
  );

  return leads;
}

/* =========================
   AUTH
========================= */

app.post("/auth/admin-login", async (req, res) => {
  const { user_id, password } = req.body || {};
  if (!user_id || !password) {
    return res
      .status(400)
      .json({ message: "Admin ID and password are required" });
  }

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const usersCol = database.collection("users");

    const user = await usersCol.findOne({ user_id: user_id });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    let isMatch = false;
    if (user.password && user.password.startsWith("$2a$")) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = user.password === password;
    }
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const role = user.role || "admin";
    const normalizedUserName = (user.user_name || "")
      .toString()
      .trim()
      .toLowerCase();

    const token = signToken({
      userId: user._id.toString(),
      role,
      user_name: normalizedUserName,
      user_id: user.user_id || null,
    });

    return res.json({
      token,
      role,
      user_name: normalizedUserName,
      user_id: user.user_id || null,
    });
  } catch (err) {
    console.error("Admin login error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.post("/auth/user-login", async (req, res) => {
  const { user_name, password } = req.body || {};

  const rawName = (user_name || "").toString();
  const normalizedName = rawName.trim().toLowerCase();

  if (!normalizedName || !password) {
    return res
      .status(400)
      .json({ message: "User name and password are required" });
  }

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const usersCol = database.collection("users");

    const user = await usersCol.findOne({ user_name: normalizedName });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    let isMatch = false;
    if (user.password && user.password.startsWith("$2a$")) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = user.password === password;
    }
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const role = user.role || "user";
    const normalizedUserName = (user.user_name || normalizedName)
      .toString()
      .trim()
      .toLowerCase();

    const token = signToken({
      userId: user._id.toString(),
      role,
      user_name: normalizedUserName,
      user_id: user.user_id || null,
    });

    return res.json({
      token,
      role,
      user_name: normalizedUserName,
      user_id: user.user_id || null,
    });
  } catch (err) {
    console.error("User login error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   USERS
========================= */

app.post("/add-user", auth(["admin"]), async (req, res) => {
  let clientObj;
  try {
    const { user_id, user_name, password, email, mobile, role } = req.body;

    if (!user_id || !user_name || !password) {
      return res
        .status(400)
        .json({ message: "user_id, user_name, and password are required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const normalizedName = user_name.toString().trim().toLowerCase();

    const user = {
      user_id,
      user_name: normalizedName,
      password: hashedPassword,
      email: email || null,
      mobile: mobile || null,
      role: role || "user",
    };

    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    const existing = await database
      .collection("users")
      .findOne({ user_name: normalizedName });
    if (existing) {
      return res.status(409).json({ message: "User already exists" });
    }

    await database.collection("users").insertOne(user);
    return res.status(201).json({ message: "User added successfully" });
  } catch (err) {
    console.error("Add user error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/users", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const users = await database
      .collection("users")
      .find({}, { projection: { password: 0 } })
      .toArray();

    return res.status(200).json(users);
  } catch (err) {
    console.error("Users fetch error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   LEADS
========================= */

/**
 * ✅ UPDATED:
 * - If admin calls GET /leads, auto-assign any existing unassigned leads (Assigned_to null/""/missing)
 * - This fixes leads inserted directly via Mongo/n8n/Google Sheet that bypass /add-lead endpoints.
 */
app.get("/leads", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const collection = database.collection("leads");

    // ✅ Admin backfill auto-assign for any unassigned leads
    if (req.user.role === "admin") {
      const settingsCol = database.collection("settings");
      const usersCol = database.collection("users");

      // Get unassigned lead IDs
      const unassigned = await collection
        .find(
          {
            $or: [
              { Assigned_to: null },
              { Assigned_to: "" },
              { Assigned_to: { $exists: false } },
            ],
          },
          { projection: { _id: 1, Assigned_to: 1 } }
        )
        .sort({ createdAt: 1 })
        .toArray();

      if (unassigned.length) {
        // build temp objects for RR helper
        const temp = unassigned.map((x) => ({
          _id: x._id,
          Assigned_to: x.Assigned_to,
        }));

        await assignRoundRobinToLeads_(temp, settingsCol, usersCol);

        // persist to DB
        const bulk = collection.initializeUnorderedBulkOp();
        for (const t of temp) {
          bulk.find({ _id: t._id }).updateOne({
            $set: { Assigned_to: t.Assigned_to, assignedAt: new Date() },
          });
        }
        await bulk.execute();
      }
    }

    // Normal query behavior
    let query = {};
    if (req.user.role === "user" && req.user.user_name) {
      const normalized = req.user.user_name.toString().trim().toLowerCase();
      query = { Assigned_to: normalized };
    }

    const docs = await collection.find(query).toArray();
    const normalizedDocs = docs.map((doc) => ({
      ...doc,
      lead_id: doc.lead_id || (doc._id ? doc._id.toString() : undefined),
    }));

    return res.status(200).json(normalizedDocs);
  } catch (err) {
    console.error("Error fetching leads", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/lead/:id", auth(["admin", "user"]), async (req, res) => {
  const id = req.params.id;

  const orFilters = [{ lead_id: id }];
  if (ObjectId.isValid(id)) orFilters.push({ _id: new ObjectId(id) });

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const doc = await database.collection("leads").findOne({ $or: orFilters });
    if (!doc) return res.status(404).json({ message: "Lead not found" });
    return res.status(200).json(doc);
  } catch (err) {
    console.error("Error fetching lead", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/**
 * ✅ /add-lead
 * - If admin adds a lead without Assigned_to -> Round Robin assign
 * - If user adds a lead without Assigned_to -> assign to self (existing behavior)
 *
 * ✅ UPDATED (your requirement):
 * - Create follow-up ONLY if BOTH status + remarks are present (non-empty) AND status is TRACKED
 */
app.post("/add-lead", auth(["admin", "user"]), async (req, res) => {
  const mobile = (req.body.mobile || "").toString().trim();
  if (!mobile)
    return res.status(400).json({ message: "Mobile number is required" });

  // Mobile normalize/validate
  let digits = mobile.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length !== 10 || !/^[6-9]\d{9}$/.test(digits)) {
    return res.status(400).json({
      message: "Enter a valid 10-digit mobile number starting with 6-9",
    });
  }

  // ✅ UPDATED: treat spaces as empty
  let assignedTo = req.body.Assigned_to
    ? req.body.Assigned_to.toString().trim().toLowerCase()
    : null;
  if (assignedTo && !assignedTo.trim()) assignedTo = null;

  // ✅ Normalize status + remarks
  const status = req.body.status ? req.body.status.toString().trim() : null;
  const remarks = req.body.remarks ? req.body.remarks.toString().trim() : null;

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const leadsCol = database.collection("leads");
    const followUpsCol = database.collection("follow-ups");
    const usersCol = database.collection("users");
    const settingsCol = database.collection("settings");

    const existing = await leadsCol.findOne({ mobile: digits });
    if (existing) {
      return res.status(409).json({
        message: "Lead with this mobile number already exists",
        lead_id:
          existing.lead_id || (existing._id ? existing._id.toString() : null),
      });
    }

    // ✅ Assign rules:
    // - If user role and missing assigned -> self
    // - If admin role and missing assigned -> round robin
    if (!assignedTo) {
      if (req.user?.role === "user" && req.user?.user_name) {
        assignedTo = req.user.user_name.toString().trim().toLowerCase();
      } else if (req.user?.role === "admin") {
        assignedTo = await pickRoundRobinUser_(settingsCol, usersCol);
      }
    }

    // dob rules:
    // - Visit Scheduled requires dob
    // - AUTO_24H_STATUSES => tomorrow 9AM if dob missing/invalid
    let dob = req.body.dob ? new Date(req.body.dob) : null;
    if (dob && Number.isNaN(dob.getTime())) dob = null;

    if (status === "Visit Scheduled" && !dob) {
      return res.status(400).json({
        message: "Visit Scheduled requires a valid dob/date",
      });
    }

    if (AUTO_24H_STATUSES.includes(status) && !dob) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      dob = tomorrow;
    }
    const actor = (req.user?.user_name || "").toString().trim().toLowerCase();
    const lead = {
      lead_id: new ObjectId().toHexString(),
      name: req.body.name || null,
      mobile: digits,
      source: req.body.source || null,
      status: status || null,
      job_role: req.body.job_role || null,
      budget: req.body.budget || null,
      project: req.body.project || null,
      remarks: remarks || null,
      dob: dob,
      Assigned_to: assignedTo || null,
      createdAt: new Date(),
      updatedAt: new Date(), 
      createdBy: actor || null,
      updatedBy: actor || null, 
      verification_call: false,
      original_assigned: null,
      transfer_date: null,
    };

    await leadsCol.insertOne(lead);

    // ✅ FOLLOW-UP CREATION RULE (UPDATED):
    // Create follow-up ONLY if status is tracked AND remarks is present (non-empty)
    if (lead.status && TRACKED_STATUSES.includes(lead.status) && lead.remarks) {
      const followUpDate = lead.dob || new Date();
      const follow_up = {
        followup_id: lead.lead_id,
        date: followUpDate,
        name: lead.name || null,
        mobile: parseInt(lead.mobile, 10) || null,
        source: lead.source || null,
        status: lead.status || null,
        job_role: lead.job_role || null,
        budget: lead.budget || null,
        project: lead.project || null,
        remarks: lead.remarks || null,
        createdAt: new Date(),
      };
      await followUpsCol.insertOne(follow_up);
    }

    return res.status(201).json(lead);
  } catch (err) {
    console.error("DB error on add-lead", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.post("/add-leads-bulk", auth(["admin", "user"]), async (req, res) => {
  const items = Array.isArray(req.body?.leads) ? req.body.leads : [];

  if (!items.length) {
    return res.status(400).json({
      message: "No leads provided. Send { leads: [...] }",
    });
  }

  const normalizeMobile = (raw) => {
    if (raw === undefined || raw === null)
      return { ok: false, digits: "", error: "Mobile missing" };

    let digits = raw.toString().replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

    if (digits.length !== 10)
      return { ok: false, digits, error: "Mobile must be 10 digits" };
    if (!/^[6-9]\d{9}$/.test(digits))
      return {
        ok: false,
        digits,
        error: "Mobile must start with 6-9",
      };
    return { ok: true, digits, error: null };
  };

  const currentUser = (req.user?.user_name || "").toString().trim().toLowerCase();
  const isUser = req.user?.role === "user";
  const isAdmin = req.user?.role === "admin";

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const leadsCol = database.collection("leads");
    const followUpsCol = database.collection("follow-ups");
    const usersCol = database.collection("users");
    const settingsCol = database.collection("settings");
    

    const seenInFile = new Set();
    const valid = [];
    const invalid = [];

    for (let i = 0; i < items.length; i++) {
      const row = items[i] || {};
      const nm = normalizeMobile(row.mobile);

      if (!nm.ok) {
        invalid.push({ row: i + 1, mobile: row.mobile, reason: nm.error });
        continue;
      }

      if (seenInFile.has(nm.digits)) {
        invalid.push({
          row: i + 1,
          mobile: nm.digits,
          reason: "Duplicate mobile in uploaded file",
        });
        continue;
      }
      seenInFile.add(nm.digits);

      let assignedTo = row.Assigned_to
        ? row.Assigned_to.toString().trim().toLowerCase()
        : null;

      // UPDATED: treat spaces as empty
      if (assignedTo && !assignedTo.trim()) assignedTo = null;

      // user upload -> self if missing
      if (!assignedTo && isUser && currentUser) assignedTo = currentUser;

      // admin upload -> keep blank for now; we will assign RR in one pass after dedupe
      if (!assignedTo && isAdmin) assignedTo = null;

      // Normalize status + remarks (trim)
      const status = row.status ? row.status.toString().trim() : null;
      const remarks = row.remarks ? row.remarks.toString().trim() : null;

      // dob rules
      let dob = row.dob ? new Date(row.dob) : null;
      if (dob && Number.isNaN(dob.getTime())) dob = null;

      if (status === "Visit Scheduled" && !dob) {
        invalid.push({
          row: i + 1,
          mobile: nm.digits,
          reason: "Visit Scheduled requires valid dob/date",
        });
        continue;
      }

      if (AUTO_24H_STATUSES.includes(status) && !dob) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        dob = tomorrow;
      }
      const actor = (req.user?.user_name || "").toString().trim().toLowerCase();
      valid.push({
        lead_id: new ObjectId().toHexString(),
        name: row.name || null,
        mobile: nm.digits,
        source: row.source || null,
        status: status || null,
        job_role: row.job_role || null,
        budget: row.budget || null,
        project: row.project || null,
        remarks: remarks || null,
        dob: dob,
        Assigned_to: assignedTo,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: actor || null,
        updatedBy: actor || null,
        verification_call: false,
        original_assigned: null,
        transfer_date: null,
      });
    }

    if (!valid.length) {
      return res.status(400).json({
        message: "No valid leads to insert",
        inserted: 0,
        skippedExisting: 0,
        invalidCount: invalid.length,
        invalid,
      });
    }

    // Find existing mobiles
    const mobiles = valid.map((v) => v.mobile);
    const existingDocs = await leadsCol
      .find({ mobile: { $in: mobiles } }, { projection: { mobile: 1 } })
      .toArray();
    const existingSet = new Set(
      existingDocs.map((d) => (d.mobile || "").toString())
    );

    const toInsert = [];
    const skippedExisting = [];

    for (const v of valid) {
      if (existingSet.has(v.mobile)) skippedExisting.push(v.mobile);
      else toInsert.push(v);
    }

    if (!toInsert.length) {
      return res.status(200).json({
        message: "All uploaded leads already exist",
        inserted: 0,
        skippedExisting: skippedExisting.length,
        invalidCount: invalid.length,
        invalid,
      });
    }

    // ✅ Round Robin assign only for admin uploads, and only for rows still missing Assigned_to
    if (isAdmin) {
      await assignRoundRobinToLeads_(toInsert, settingsCol, usersCol);
    }

    const insertRes = await leadsCol.insertMany(toInsert, { ordered: false });

    // ✅ Follow-ups bulk (UPDATED RULE):
    // Create follow-up ONLY if status tracked AND remarks non-empty
    const followUps = toInsert
      .filter((l) => {
        const st = (l.status || "").toString().trim();
        const rm = (l.remarks || "").toString().trim();
        return st && rm && TRACKED_STATUSES.includes(st);
      })
      .map((l) => ({
        followup_id: l.lead_id,
        date: l.dob || new Date(),
        name: l.name || null,
        mobile: l.mobile ? parseInt(l.mobile, 10) : null,
        source: l.source || null,
        status: l.status || null,
        job_role: l.job_role || null,
        budget: l.budget || null,
        project: l.project || null,
        remarks: l.remarks || null,
        createdAt: new Date(),
      }));

    if (followUps.length) {
      await followUpsCol.insertMany(followUps, { ordered: false });
    }

    return res.status(201).json({
      message: "Bulk upload completed",
      received: items.length,
      valid: valid.length,
      inserted: Object.keys(insertRes.insertedIds || {}).length,
      skippedExisting: skippedExisting.length,
      invalidCount: invalid.length,
      invalid,
    });
  } catch (err) {
    console.error("Bulk add error:", err);
    return res.status(500).json({ message: "Bulk upload failed" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/**
 * ✅ /edit-lead
 * - true partial update
 * - Busy: sets tomorrow 9AM if date not given
 * - 3 consecutive Busy/NR-SF/RNR => transfer to another user + verification_call=true
 * - when verification_call lead updated to non-Busy => return to original_assigned
 *
 * ✅ UPDATED:
 * - Trim status/remarks when updating
 * - AUTO_24H_STATUSES => tomorrow 9AM if dob missing AND status is in list
 * - Visit Scheduled requires dob (reject if missing)
 */
app.put("/edit-lead/:id", auth(["admin", "user"]), async (req, res) => {
  const leadId = req.params.id;

  const update = {};
  if ("name" in req.body) update.name = req.body.name || null;
  if ("source" in req.body) update.source = req.body.source || null;

  if ("status" in req.body) {
    const st = req.body.status ? req.body.status.toString().trim() : null;
    update.status = st || null;
  }

  if ("job_role" in req.body) update.job_role = req.body.job_role || null;
  if ("budget" in req.body) update.budget = req.body.budget || null;
  if ("project" in req.body) update.project = req.body.project || null;

  if ("remarks" in req.body) {
    const rm = req.body.remarks ? req.body.remarks.toString().trim() : null;
    update.remarks = rm || null;
  }

  if ("dob" in req.body) update.dob = req.body.dob ? new Date(req.body.dob) : null;

  // only update Assigned_to if explicitly provided
  if ("Assigned_to" in req.body) {
    update.Assigned_to = req.body.Assigned_to
      ? req.body.Assigned_to.toString().trim().toLowerCase()
      : null;
  }

  const orFilters = [{ lead_id: leadId }];
  if (ObjectId.isValid(leadId)) orFilters.push({ _id: new ObjectId(leadId) });

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const leadsCol = database.collection("leads");
    const followUpsCol = database.collection("follow-ups");
    const usersCol = database.collection("users");

    const existingLead = await leadsCol.findOne({ $or: orFilters });
    if (!existingLead) return res.status(404).json({ message: "Lead not found" });

    const newStatus = update.status;
    const currentUser = (req.user?.user_name || "").toString().trim().toLowerCase();
    const responseData = { message: "Lead updated successfully" };

    update.updatedAt = new Date();
    update.updatedBy = currentUser || null; 
    // Helper: choose least-loaded user excluding current user
    async function pickNextUser(excludeUserName) {
      const allUsers = await usersCol
        .find({ role: "user", user_name: { $ne: excludeUserName } })
        .toArray();

      if (!allUsers.length) return null;

      const userLeadCounts = await Promise.all(
        allUsers.map(async (user) => {
          const count = await leadsCol.countDocuments({
            Assigned_to: user.user_name,
            verification_call: { $ne: true },
          });
          return { user, count };
        })
      );

      userLeadCounts.sort((a, b) => a.count - b.count);
      return userLeadCounts[0].user;
    }

    // ✅ Normalize dob if provided
    if ("dob" in update && update.dob && Number.isNaN(update.dob.getTime())) {
      update.dob = null;
    }

    // ✅ Visit Scheduled requires date (dob)
    if (newStatus === "Visit Scheduled") {
      const nextDob =
        "dob" in update ? update.dob : existingLead.dob ? new Date(existingLead.dob) : null;

      if (!nextDob) {
        return res.status(400).json({
          message: "Visit Scheduled requires a valid dob/date",
        });
      }
    }

    // ✅ AUTO_24H_STATUSES => tomorrow 9AM if dob missing
    if (newStatus && AUTO_24H_STATUSES.includes(newStatus)) {
      const nextDob =
        "dob" in update ? update.dob : existingLead.dob ? new Date(existingLead.dob) : null;

      if (!nextDob) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        update.dob = tomorrow;
      }
    }

    // ✅ Return-to-owner logic:
    // If currently verification_call=true and status is changing away from Busy -> return to original
    if (existingLead.verification_call && newStatus && newStatus !== "Busy") {
      const original = existingLead.original_assigned;
      if (original) {
        update.Assigned_to = original;
        update.verification_call = false;
        update.transfer_date = null;
        update.original_assigned = null;

        responseData.returnedTo = original;
        responseData.message = `Lead updated and returned to ${original}`;
      }
    }

    // Transfer logic for Busy / NR-SF / RNR (only if not already verification_call)
    const shouldTransferCheck =
      !existingLead.verification_call &&
      (newStatus === "Busy" || newStatus === "NR/SF" || newStatus === "RNR");

    if (shouldTransferCheck) {
      // "3 days" behavior implemented as "3 consecutive follow-ups with same status"
      const history = await followUpsCol
        .find({ followup_id: existingLead.lead_id, status: newStatus })
        .sort({ date: -1 })
        .limit(3)
        .toArray();

      const consecutiveCount = history.length + 1; // including current update

      if (consecutiveCount >= 3) {
        const nextUser = await pickNextUser(currentUser);
        if (nextUser) {
          update.Assigned_to = nextUser.user_name;
          update.verification_call = true;
          update.original_assigned = existingLead.Assigned_to || currentUser || null;
          update.transfer_date = new Date();

          responseData.transferredTo = nextUser.user_name;
          responseData.message = `Lead updated and transferred to ${nextUser.user_name} (Verification Call)`;
        }
      }
    }

    // Update lead
    await leadsCol.updateOne({ $or: orFilters }, { $set: update });

    const nextLead = { ...existingLead, ...update };
    const followupId = nextLead.lead_id || existingLead.lead_id;
    const nextStatus = nextLead.status || null;

    const isTracked = !!(nextStatus && TRACKED_STATUSES.includes(nextStatus));
    const hasRemarks = !!((nextLead.remarks || "").toString().trim());

    // Follow-up sync (UPDATED RULE):
    // - If NOT tracked OR NO remarks => remove follow-up
    // - Else upsert follow-up
    if (!isTracked || !hasRemarks) {
      await followUpsCol.deleteOne({ followup_id: followupId });
    } else {
      const fuUpdate = {
        status: nextStatus,
        date: nextLead.dob ? new Date(nextLead.dob) : null,
        name: nextLead.name || null,
        mobile: nextLead.mobile ? parseInt(nextLead.mobile, 10) : null,
        source: nextLead.source || null,
        job_role: nextLead.job_role || null,
        budget: nextLead.budget || null,
        project: nextLead.project || null,
        remarks: nextLead.remarks || null,
      };

      await followUpsCol.updateOne(
        { followup_id: followupId },
        {
          $set: fuUpdate,
          $setOnInsert: { followup_id: followupId, createdAt: new Date() },
        },
        { upsert: true }
      );
    }

    return res.status(200).json(responseData);
  } catch (err) {
    console.error("Error updating lead", err);
    return res.status(500).json({ message: "Error updating lead" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.delete("/delete-lead/:id", auth(["admin"]), async (req, res) => {
  const id = req.params.id;
  let clientObj;

  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const leadsCol = database.collection("leads");

    const result = await leadsCol.deleteOne({ lead_id: id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Lead not found" });
    }

    return res.status(200).json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("Delete lead error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* STATUS SETTINGS */

app.post("/statuslist", auth(["admin"]), async (req, res) => {
  const status = {
    Details_shared: req.body.Details_shared === "true",
    RNR: req.body.RNR === "true",
    Follow_up: req.body.Follow_up === "true",
    Not_interested: req.body.Not_interested === "true",
    Site_visited: req.body.Site_visited === "true",
    Booked: req.body.Booked === "true",
    Invalid: req.body.Invalid === "true",
    NR_SF: req.body.NR_SF === "true",
    Others: req.body.Others === "true",
    Location_Issue: req.body.Location_Issue === "true",
    CP: req.body.CP === "true",
    Budget_Issue: req.body.Budget_Issue === "true",
    Visit_Postponed: req.body.Visit_Postponed === "true",
    Busy: req.body.Busy === "true",
    Closed: req.body.Closed === "true",
  };

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    await database.collection("status").insertOne(status);
    return res.status(201).send();
  } catch (err) {
    console.error("Status update error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/status", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const docs = await database.collection("status").find({}).toArray();
    return res.status(200).json(docs);
  } catch (err) {
    console.error("Status fetch error", err);
    return res.status(500).json({ message: "Database connection failed!" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   FOLLOW-UPS
========================= */

app.post("/add-follow_up", auth(["admin", "user"]), async (req, res) => {
  const id = req.body.followup_id;

  const follow_up = {
    followup_id: id,
    date: req.body.date ? new Date(req.body.date) : null,
    name: req.body.name || null,
    mobile: req.body.mobile ? parseInt(req.body.mobile, 10) : null,
    source: req.body.source || null,
    status: req.body.status || null,
    job_role: req.body.job_role || null,
    budget: req.body.budget || null,
    project: req.body.project || null,
    remarks: req.body.remarks || null,
    createdAt: new Date(),
  };

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const result = await database.collection("follow-ups").insertOne(follow_up);

    return res.status(201).json({
      message: "Follow-up created successfully",
      insertedId: result.insertedId,
    });
  } catch (err) {
    console.error("DB error in add-follow_up", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.put("/edit-follow_up/:id", auth(["admin", "user"]), async (req, res) => {
  const id = req.params.id;

  const update = {
    date: req.body.date ? new Date(req.body.date) : null,
    name: req.body.name || null,
    mobile: req.body.mobile ? parseInt(req.body.mobile, 10) : null,
    source: req.body.source || null,
    status: req.body.status || null,
    job_role: req.body.job_role || null,
    budget: req.body.budget || null,
    project: req.body.project || null,
    remarks: req.body.remarks || null,
  };

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const result = await database
      .collection("follow-ups")
      .updateOne({ followup_id: id }, { $set: update });

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Follow-up not found" });
    }

    return res.status(200).json({ message: "Follow-up updated successfully" });
  } catch (err) {
    console.error("Update follow-up error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/follow-ups", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const docs = await database.collection("follow-ups").find({}).toArray();
    return res.status(200).json(docs);
  } catch (err) {
    console.error("Database err", err);
    return res.status(500).json({ message: "Database connection failed" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/follow-up/:id", auth(["admin", "user"]), async (req, res) => {
  const id = req.params.id;

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const doc = await database
      .collection("follow-ups")
      .findOne({ followup_id: id });

    if (!doc) return res.status(404).json({ message: "Follow-up not found" });
    return res.status(200).json(doc);
  } catch (err) {
    console.error("DB connection error", err);
    return res.status(500).json({ message: "Database connection failed" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.delete("/delete-follow_up/:id", auth(["admin"]), async (req, res) => {
  const id = req.params.id;

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    const result = await database
      .collection("follow-ups")
      .deleteOne({ followup_id: id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Follow-up not found" });
    }

    return res.status(200).json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("Delete follow-up error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   SITE VISITS
========================= */

app.post("/site_visit", auth(["admin", "user"]), async (req, res) => {
  const visit = {
    visit_id: req.body.visit_id,
    name: req.body.name,
    mobile: req.body.mobile ? parseInt(req.body.mobile, 10) : null,
    site_visit_date: req.body.site_visit_date
      ? new Date(req.body.site_visit_date)
      : null,
    Assigned_to: req.body.Assigned_to,
    created_by: req.body.created_by,
  };

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    await database.collection("site_visit").insertOne(visit);
    return res
      .status(201)
      .json({ message: "Site visit added successfully" });
  } catch (err) {
    console.error("Site visit add error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.put("/edit_site_visit/:id", auth(["admin", "user"]), async (req, res) => {
  const id = req.params.id;

  const visit = {
    visit_id: req.body.visit_id,
    name: req.body.name,
    mobile: req.body.mobile ? parseInt(req.body.mobile, 10) : null,
    site_visit_date: req.body.site_visit_date
      ? new Date(req.body.site_visit_date)
      : null,
    Assigned_to: req.body.Assigned_to,
    created_by: req.body.created_by,
  };

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    await database
      .collection("site_visit")
      .updateOne({ visit_id: id }, { $set: visit });
    return res.status(200).json({ message: "Site visit updated" });
  } catch (err) {
    console.error("Site visit update error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/site_visits", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const docs = await database.collection("site_visit").find({}).toArray();
    return res.status(200).json(docs);
  } catch (err) {
    console.error("Site visits fetch error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/site_visits/:id", auth(["admin", "user"]), async (req, res) => {
  const id = req.params.id;

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    const doc = await database
      .collection("site_visit")
      .findOne({ visit_id: id });
    if (!doc) return res.status(404).json({ message: "Site visit not found" });

    return res.status(200).json(doc);
  } catch (err) {
    console.error("Site visit fetch error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.delete("/delete/site_visit/:id", auth(["admin"]), async (req, res) => {
  const id = req.params.id;

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    const result = await database
      .collection("site_visit")
      .deleteOne({ visit_id: id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Site visit not found" });
    }

    return res.status(200).json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("Site visit delete error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   ROOT + ERRORS
========================= */

app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "RBD CRM backend is running",
    time: new Date().toISOString(),
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
    path: req.originalUrl,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
    console.log(`Health check: http://127.0.0.1:${PORT}/health`);
  });
}

module.exports = app;

require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
const connectionString = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const mongoClient = MongoClient;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const PORT = process.env.PORT || 3000;

const logRequest = (req, res, next) => {
  console.log(
    `${new Date().toLocaleString()} Request made to ${req.method} ${req.originalUrl}`
  );
  next();
};

app.use(logRequest);
app.use(
  cors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function auth(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

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

app.post("/auth/admin-login", async (req, res) => {
  const { user_id, password } = req.body || {};
  if (!user_id || !password) {
    return res
      .status(400)
      .json({ message: "Admin ID and password are required" });
  }

  try {
    const clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const usersCol = database.collection("users");

    const user = await usersCol.findOne({ user_id: user_id });
    await clientObj.close();

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    let isMatch = false;
    if (user.password && user.password.startsWith("$2a$")) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = user.password === password;
    }

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

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

  try {
    const clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const usersCol = database.collection("users");

    const user = await usersCol.findOne({ user_name: normalizedName });
    await clientObj.close();

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    let isMatch = false;
    if (user.password && user.password.startsWith("$2a$")) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = user.password === password;
    }

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

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
  }
});

app.post("/add-user", auth(["admin"]), async (req, res) => {
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

    const clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    await database.collection("users").insertOne(user);
    await clientObj.close();

    console.log("User added successfully!..");
    return res.status(201).json({ message: "User added successfully" });
  } catch (err) {
    console.error("Add user error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

app.get("/users", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("users")
        .find({}, { projection: { password: 0 } })
        .toArray()
        .then((document) => {
          res.status(200).json(document);
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Users fetch error", err);
      return res.status(500).json({ message: "Internal Server Error" });
    });
});

app.get("/leads", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    console.log(">>> /leads called, req.user =", req.user);

    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const collection = database.collection("leads");

    let query = {};

    if (req.user.role === "user" && req.user.user_name) {
      const normalized = req.user.user_name.toString().trim().toLowerCase();
      console.log(">>> Normalized username for query:", normalized);

      query = { Assigned_to: normalized };
    }

    console.log(">>> Leads query:", JSON.stringify(query));

    const docs = await collection.find(query).toArray();
    console.log(">>> Leads returned:", docs.length);

    const normalizedDocs = docs.map((doc) => ({
      ...doc,
      lead_id: doc.lead_id || (doc._id ? doc._id.toString() : undefined),
    }));

    return res.status(200).json(normalizedDocs);
  } catch (err) {
    console.error("Error fetching leads", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) {
      await clientObj.close();
    }
  }
});

app.get("/lead/:id", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      database
        .collection("leads")
        .findOne({ lead_id: req.params.id })
        .then((document) => {
          if (!document) {
            return res.status(404).json({ message: "Lead not found" });
          }
          res.send(document);
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Error fetching lead", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.post("/add-lead", auth(["admin", "user"]), async (req, res) => {
  const assignedRaw = req.body.Assigned_to || null;
  const mobile = (req.body.mobile || "").toString().trim();

  if (!mobile) {
    return res.status(400).json({ message: "Mobile number is required" });
  }

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const leadsCol = database.collection("leads");
    const existing = await leadsCol.findOne({ mobile });
    if (existing) {
      return res.status(409).json({
        message: "Lead with this mobile number already exists",
        lead_id: existing.lead_id || (existing._id ? existing._id.toString() : null),
      });
    }

    const lead = {
      lead_id: new ObjectId().toHexString(),
      name: req.body.name || null,
      mobile,
      source: req.body.source || null,
      status: req.body.status || null,
      job_role: req.body.job_role || null,
      budget: req.body.budget || null,
      project: req.body.project || null,
      remarks: req.body.remarks || null,
      dob: req.body.dob ? new Date(req.body.dob) : null,
      Assigned_to: assignedRaw
        ? assignedRaw.toString().trim().toLowerCase()
        : null,
      createdAt: new Date(),
    };

    await leadsCol.insertOne(lead);

    console.log("Lead added successfully!..");
    return res.status(201).json(lead);
  } catch (err) {
    console.error("DB error on add-lead", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) {
      await clientObj.close();
    }
  }
});

app.put("/edit-lead/:id", auth(["admin", "user"]), (req, res) => {
  const leadId = req.params.id;
  const assignedRaw = req.body.Assigned_to || null;

  const update = {
    name: req.body.name || null,
    source: req.body.source || null,
    status: req.body.status || null,
    job_role: req.body.job_role || null,
    budget: req.body.budget || null,
    project: req.body.project || null,
    remarks: req.body.remarks || null,
    dob: req.body.dob ? new Date(req.body.dob) : null,
    Assigned_to: assignedRaw
      ? assignedRaw.toString().trim().toLowerCase()
      : null,
  };

  const orFilters = [];

  orFilters.push({ lead_id: leadId });

  const asNumber = Number(leadId);
  if (!Number.isNaN(asNumber)) {
    orFilters.push({ lead_id: asNumber });
  }

  if (ObjectId.isValid(leadId)) {
    orFilters.push({ _id: new ObjectId(leadId) });
  }

  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("leads")
        .updateOne({ $or: orFilters }, { $set: update })
        .then((result) => {
          console.log("edit-lead result:", result);

          if (result.matchedCount === 0) {
            console.log("Lead not found for id:", leadId);
            return res.status(404).json({ message: "Lead not found" });
          }

          console.log("Lead updated successfully!..");
          return res
            .status(200)
            .json({ message: "Lead updated successfully" });
        })
        .catch((err) => {
          console.error("Error updating lead", err);
          return res.status(500).json({ message: "Error updating lead" });
        })
        .finally(() => {
          clientObj.close();
        });
    })
    .catch((err) => {
      console.error("Database connection error", err);
      return res.status(500).json({ message: "Database connection error" });
    });
});

app.delete("/delete-lead/:id", auth(["admin"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("leads")
        .deleteOne({ lead_id: req.params.id })
        .then((result) => {
          if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Lead not found" });
          }
          console.log("Deleted the Lead successfully!..");
          res.status(200).json({ message: "Deleted successfully" });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Delete lead error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.post("/statuslist", auth(["admin"]), (req, res) => {
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
  };

  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("status")
        .insertOne(status)
        .then(() => {
          console.log("Updated the status!..");
          res.status(201).send();
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Status update error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.get("/status", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("status")
        .find({})
        .toArray()
        .then((document) => res.status(200).json(document))
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Status fetch error", err);
      return res.status(500).json({ message: "Database connection failed!" });
    });
});

app.post("/add-follow_up", auth(["admin", "user"]), (req, res) => {
  const id = req.body.followup_id;

  const follow_up = {
    followup_id: id,
    date: req.body.date ? new Date(req.body.date) : null,
    name: req.body.name || null,
    mobile: req.body.mobile ? parseInt(req.body.mobile) : null,
    source: req.body.source || null,
    status: req.body.status || null,
    job_role: req.body.job_role || null,
    budget: req.body.budget || null,
    project: req.body.project || null,
    remarks: req.body.remarks || null,
    createdAt: new Date(),
  };

  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");

      return database
        .collection("follow-ups")
        .insertOne(follow_up)
        .then((result) => {
          console.log("Follow-up inserted for", id);
          res.status(201).json({
            message: "Follow-up created successfully",
            insertedId: result.insertedId,
          });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("DB error in add-follow_up", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.put("/edit-follow_up/:id", auth(["admin", "user"]), (req, res) => {
  const id = req.params.id;

  const update = {
    date: req.body.date ? new Date(req.body.date) : null,
    name: req.body.name || null,
    mobile: req.body.mobile ? parseInt(req.body.mobile) : null,
    source: req.body.source || null,
    status: req.body.status || null,
    job_role: req.body.job_role || null,
    budget: req.body.budget || null,
    project: req.body.project || null,
    remarks: req.body.remarks || null,
  };

  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("follow-ups")
        .updateOne({ followup_id: id }, { $set: update })
        .then((result) => {
          if (result.matchedCount === 0) {
            return res.status(404).json({ message: "Follow-up not found" });
          }
          console.log("updated the follow up !..");
          res.status(200).json({ message: "Follow-up updated successfully" });
        })
        .catch((err) => {
          console.error("Update error", err);
          res.status(500).json({ message: "Internal Server Error" });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("DB Connect error", err);
      res.status(500).json({ message: "Database connection failed" });
    });
});

app.get("/follow-ups", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("follow-ups")
        .find({})
        .toArray()
        .then((document) => res.status(200).json(document))
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Database err", err);
      return res.status(500).json({ message: "Database connection failed" });
    });
});

app.get("/follow-up/:id", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("follow-ups")
        .findOne({ followup_id: req.params.id })
        .then((document) => {
          if (!document) {
            return res.status(404).json({ message: "Follow-up not found" });
          }
          return res.status(200).json(document);
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("DB connection error", err);
      return res.status(500).json({ message: "Database connection failed" });
    });
});

app.delete("/delete-follow_up/:id", auth(["admin"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("follow-ups")
        .deleteOne({ followup_id: req.params.id })
        .then((result) => {
          if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Follow-up not found" });
          }
          console.log("Deleted the Follow-up successfully!..");
          return res.status(200).json({ message: "Deleted successfully" });
        })
        .catch((err) => {
          console.log("Delete error", err);
          return res.status(500).json({ message: "Internal Server Error" });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("DB Connect error", err);
      return res.status(500).json({ message: "Database connection failed" });
    });
});

app.post("/site_visit", auth(["admin", "user"]), (req, res) => {
  const visit = {
    visit_id: req.body.visit_id,
    name: req.body.name,
    mobile: req.body.mobile ? parseInt(req.body.mobile) : null,
    site_visit_date: new Date(req.body.site_visit_date),
    Assigned_to: req.body.Assigned_to,
    created_by: req.body.created_by,
  };
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("site_visit")
        .insertOne(visit)
        .then(() => {
          console.log("Site visit added successfully!..");
          res.status(201).json({ message: "Site visit added successfully" });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Site visit add error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.put("/edit_site_visit/:id", auth(["admin", "user"]), (req, res) => {
  const visit = {
    visit_id: req.body.visit_id,
    name: req.body.name,
    mobile: req.body.mobile ? parseInt(req.body.mobile) : null,
    site_visit_date: new Date(req.body.site_visit_date),
    Assigned_to: req.body.Assigned_to,
    created_by: req.body.created_by,
  };
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("site_visit")
        .updateOne({ visit_id: req.params.id }, { $set: visit })
        .then((document) => {
          res.status(200).json({ message: "Site visit updated", document });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Site visit update error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.get("/site_visits", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("site_visit")
        .find({})
        .toArray()
        .then((document) => {
          res.send(document);
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Site visits fetch error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.get("/site_visits/:id", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("site_visit")
        .findOne({ visit_id: req.params.id })
        .then((document) => {
          if (!document) {
            return res.status(404).json({ message: "Site visit not found" });
          }
          res.send(document);
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Site visit fetch error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.delete("/delete/site_visit/:id", auth(["admin"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("site_visit")
        .deleteOne({ visit_id: req.params.id })
        .then((result) => {
          if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Site visit not found" });
          }
          console.log("Site visit deleted!..");
          res.status(200).json({ message: "Deleted successfully" });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Site visit delete error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "RBD CRM backend is running",
    time: new Date().toISOString(),
  });
});


app.listen(PORT, () => {
  console.log(`server running http://127.0.0.1:${PORT}`);
});

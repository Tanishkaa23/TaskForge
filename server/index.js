
import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";

import taskQueue from "./src/queues/taskQueue.js";
import redisConn from "./src/config/redis.js";
import Job from "./src/models/job.model.js";
import connectDB from "./src/config/db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json({ limit: "100kb" }));

const jobLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many job submissions. Please try again later.",
  },
});

const isSameRequest = (existingJob, type, text) => {
  return (
    existingJob.type === type &&
    existingJob.payload?.text?.trim() === text
  );
};

app.post("/api/jobs", jobLimiter, async (req, res) => {
  try {
    const { type, payload } = req.body ?? {};
    const idempotencyKey = req.get("Idempotency-Key");

    // 1. Validate idempotency key
    if (
      idempotencyKey !== undefined &&
      (!idempotencyKey.trim() || idempotencyKey.length > 128)
    ) {
      return res.status(400).json({
        error: "Invalid Idempotency-Key",
      });
    }

    // 2. Validate job type
    if (type !== "summarize") {
      return res.status(400).json({
        error: "Unsupported job type",
      });
    }

    // 3. Validate payload
    if (
      !payload ||
      typeof payload.text !== "string" ||
      !payload.text.trim()
    ) {
      return res.status(400).json({
        error: "payload.text must be a non-empty string",
      });
    }

    const text = payload.text.trim();

    if (text.length > 10000) {
      return res.status(400).json({
        error: "Text must not exceed 10000 characters",
      });
    }

    // 4. Check for an existing request
    if (idempotencyKey) {
      const existingJob = await Job.findOne({ idempotencyKey });

      if (existingJob) {
        if (!isSameRequest(existingJob, type, text)) {
          return res.status(409).json({
            error:
              "Idempotency key already used with a different payload",
          });
        }

        return res.status(200).json({
          jobId: existingJob._id,
          queueJobId: existingJob.queueJobId,
          type: existingJob.type,
          status: existingJob.status,
          reused: true,
        });
      }
    }

    // 5. Create database record
    const jobRecord = await Job.create({
      type,
      payload: { text },
      status: "queued",
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    try {
      // 6. Add job to BullMQ
      const queueJob = await taskQueue.add(
        type,
        {
          type,
          text,
          dbJobId: jobRecord._id.toString(),
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 2000,
          },
        }
      );

      jobRecord.queueJobId = queueJob.id;
      await jobRecord.save();

      return res.status(202).json({
        jobId: jobRecord._id,
        queueJobId: queueJob.id,
        type,
        status: "queued",
      });
    } catch (queueError) {
      // The record exists, but queue submission failed.
      await Job.findByIdAndUpdate(jobRecord._id, {
        status: "failed",
        error: "Failed to enqueue job",
      });

      throw queueError;
    }
  } catch (error) {
    // 7. Handle concurrent requests using the same key
    if (error.code === 11000) {
      const idempotencyKey = req.get("Idempotency-Key");

      if (idempotencyKey) {
        try {
          const existingJob = await Job.findOne({ idempotencyKey });
          const { type, payload } = req.body ?? {};
          const text =
            typeof payload?.text === "string"
              ? payload.text.trim()
              : "";

          if (existingJob) {
            if (!isSameRequest(existingJob, type, text)) {
              return res.status(409).json({
                error:
                  "Idempotency key already used with a different payload",
              });
            }

            return res.status(200).json({
              jobId: existingJob._id,
              queueJobId: existingJob.queueJobId,
              type: existingJob.type,
              status: existingJob.status,
              reused: true,
            });
          }
        } catch (lookupError) {
          console.error(
            "Failed to retrieve existing idempotent job:",
            lookupError
          );
        }
      }
    }

    console.error("Failed to submit job:", error);

    return res.status(500).json({
      error: "Failed to submit job",
    });
  }
});

app.get("/api/jobs/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        error: "Invalid job ID",
      });
    }

    const job = await Job.findById(req.params.id).lean();

    if (!job) {
      return res.status(404).json({
        error: "Job not found",
      });
    }

    return res.json({
      jobId: job._id,
      queueJobId: job.queueJobId,
      type: job.type,
      status: job.status,
      payload: job.payload,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch (error) {
    console.error("Failed to fetch job:", error);

    return res.status(500).json({
      error: "Failed to fetch job",
    });
  }
});

app.get("/api/jobs", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number(req.query.limit) || 10)
    );

    const { status } = req.query;

    const allowedStatuses = [
      "queued",
      "processing",
      "completed",
      "failed",
    ];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status filter",
      });
    }

    const filter = status ? { status } : {};

    const [jobs, total] = await Promise.all([
      Job.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Job.countDocuments(filter),
    ]);

    return res.json({
      jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to list jobs:", error);

    return res.status(500).json({
      error: "Failed to fetch jobs",
    });
  }
});

let server;
let isShuttingDown = false;

const startServer = async () => {
  await connectDB();

  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

const shutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`${signal} received. Shutting down API...`);

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    await taskQueue.close();
    await redisConn.quit();
    await mongoose.disconnect();

    console.log("API shut down successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});

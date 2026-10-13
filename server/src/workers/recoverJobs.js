
import { Queue } from "bullmq";
import { config } from "dotenv";
import connectDB from "../config/db.js";
import redisConn from "../config/redis.js";
import Job from "../models/job.model.js";

config();

const queue = new Queue("task-queue", {
  connection: redisConn,
});

const recoverJobs = async () => {
  try {
    await connectDB();

    const stuckJobs = await Job.find({
      status: "queued",
      $or: [
        { queueJobId: { $exists: false } },
        { queueJobId: null },
      ],
    });

    for (const dbJob of stuckJobs) {
      const text = dbJob.payload?.text;

      if (dbJob.type !== "summarize" || !text) {
        await Job.findByIdAndUpdate(dbJob._id, {
          status: "failed",
          error: "Cannot recover job: invalid payload",
        });
        continue;
      }

      try {
        const queueJob = await queue.add(
          dbJob.type,
          {
            type: dbJob.type,
            text,
            dbJobId: dbJob._id.toString(),
          },
          {
            // Reuse the MongoDB ID as the BullMQ ID
            jobId: dbJob._id.toString(),
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 2000,
            },
          }
        );

        await Job.findByIdAndUpdate(dbJob._id, {
          queueJobId: queueJob.id,
          error: null,
        });

        console.log("Recovered job:", dbJob._id.toString());
      } catch (error) {
        console.error(
          "Failed to recover job:",
          dbJob._id.toString(),
          error.message
        );
      }
    }
  } finally {
    await queue.close();
    await redisConn.quit();
    await import("mongoose").then(({ default: mongoose }) =>
      mongoose.disconnect()
    );
  }
};

recoverJobs().catch((error) => {
  console.error("Job recovery failed:", error);
  process.exitCode = 1;
});

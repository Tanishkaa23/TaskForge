import { Worker, Queue } from "bullmq";
import redisConn from "../config/redis.js";
import Job from "../models/job.model.js";
import connectDB from "../config/db.js";
import { config } from "dotenv";
import { summarizeText } from "../services/ai.service.js";
import mongoose from "mongoose";

config()
await connectDB();


const recoveryQueue = new Queue("task-queue", {
  connection: redisConn,
});



const recoverJobs = async () => {
  try {
    const stuckJobs = await Job.find({
      status: "queued",
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
        const existingQueueJob = dbJob.queueJobId
          ? await recoveryQueue.getJob(dbJob.queueJobId)
          : null;

        if (existingQueueJob) {
          // A queue entry exists; let BullMQ handle it.
          continue;
        }

        const stableJobId = dbJob._id.toString();

        const queueJob = await recoveryQueue.add(
          dbJob.type,
          {
            type: dbJob.type,
            text,
            dbJobId: stableJobId,
          },
          {
            jobId: stableJobId,
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

        console.log("Recovered job:", stableJobId);
      } catch (error) {
        console.error(
          "Failed to recover job:",
          dbJob._id.toString(),
          error.message
        );
      }
    }
  } finally {
    await recoveryQueue.close();
  }
};


await recoverJobs();


const worker = new Worker(
  "task-queue",
  async (job) => {
    const { dbJobId, text } = job.data;

    await Job.findByIdAndUpdate(dbJobId, {
      status: "processing",
      error: null,
    });

    try {
      console.log("Processing job:", job.id);

      const summary = await summarizeText(text);

      const result = {
        success: true,
        summary,
      };

    await Job.findByIdAndUpdate(dbJobId, {
      status: "completed",
      result,
      error: null,
    });

    return result;
  } catch (error) {
    throw error;
  }
},
{
  connection: redisConn,
}
);



worker.on("completed", (job) => {
  console.log("Job completed:", job.id);
});

worker.on("failed", async (job, error) => {
  if (!job) return;

  const isFinalAttempt =
    job.attemptsMade >= (job.opts.attempts ?? 1);

  if (isFinalAttempt) {
    await Job.findByIdAndUpdate(job.data.dbJobId, {
      status: "failed",
      error: error.message,
    });
  } else {
    await Job.findByIdAndUpdate(job.data.dbJobId, {
      status: "queued",
      error: error.message,
    });
  }

  console.log(
    `Job ${job.id} failed. Final attempt: ${isFinalAttempt}`
  );
});

console.log("Worker is listening for jobs...");

const shutdown = async () => {
  console.log("Shutting down worker...");

  try {
    await worker.close();
    await redisConn.quit();
    await mongoose.disconnect();

    console.log("Worker shut down successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown); 
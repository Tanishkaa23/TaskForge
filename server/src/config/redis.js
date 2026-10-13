import IORedis from "ioredis";
import { config } from "dotenv";
config()

const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: null,
});

export default redisConnection;